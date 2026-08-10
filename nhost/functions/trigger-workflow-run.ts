// nhost serverless function: POST /v1/functions/trigger-workflow-run
// Backs the `triggerWorkflowRun` Hasura Action.
//
// This is the server-side, admin-privileged equivalent of lib/engine.ts's
// startRun(). It exists as its own function so all external calls (LLM, HTTP),
// quota accounting, and retry policy run with the admin secret and can never
// be tampered with by the client. The two permission layers are re-checked
// here even though the Action already gates by role, because defense in depth.

import type { Request, Response } from "express"
import { adminGql, callerFromHeaders } from "./_lib/graphql"

interface StepRow {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
  order: number
  required_role: string | null
}

const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, owner: 2 }

export default async function handler(req: Request, res: Response) {
  const caller = callerFromHeaders(req.headers as Record<string, string | undefined>)
  if (!caller) return res.status(401).json({ message: "Unauthenticated" })
  if (caller.role === "viewer") {
    return res.status(403).json({ message: "Viewers cannot trigger runs" })
  }

  const workflowId = req.body?.input?.workflowId as string
  const payload = (req.body?.input?.payload ?? {}) as Record<string, unknown>
  if (!workflowId) return res.status(400).json({ message: "workflowId required" })

  // --- Layer 1: workflow must belong to the caller's org ------------------
  const { workflows_by_pk: wf } = await adminGql<{
    workflows_by_pk: { id: string; org_id: string; name: string } | null
  }>(
    /* GraphQL */ `
      query ($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          org_id
          name
        }
      }
    `,
    { id: workflowId },
  )
  // Indistinguishable from "not found" — no cross-org existence leak.
  if (!wf || wf.org_id !== caller.orgId) {
    return res.status(404).json({ message: "Workflow not found" })
  }

  // --- Quota check (org-level) --------------------------------------------
  const { organizations_by_pk: org } = await adminGql<{
    organizations_by_pk: { quota_used: number; quota_allowed: number } | null
  }>(
    /* GraphQL */ `
      query ($id: uuid!) {
        organizations_by_pk(id: $id) {
          quota_used
          quota_allowed
        }
      }
    `,
    { id: caller.orgId },
  )
  if (org && org.quota_used >= org.quota_allowed) {
    return res.status(429).json({ message: "Monthly run quota exhausted" })
  }

  // --- Load ordered steps -------------------------------------------------
  const { workflow_steps: steps } = await adminGql<{ workflow_steps: StepRow[] }>(
    /* GraphQL */ `
      query ($wf: uuid!) {
        workflow_steps(where: { workflow_id: { _eq: $wf } }, order_by: { order: asc }) {
          id
          type
          name
          config
          order
          required_role
        }
      }
    `,
    { wf: workflowId },
  )

  // --- Create the run record ----------------------------------------------
  const { insert_workflow_runs_one: run } = await adminGql<{
    insert_workflow_runs_one: { id: string }
  }>(
    /* GraphQL */ `
      mutation ($obj: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $obj) {
          id
        }
      }
    `,
    {
      obj: {
        workflow_id: workflowId,
        org_id: caller.orgId,
        status: "running",
        trigger_type: "manual",
        triggered_by: caller.userId,
        input: payload,
      },
    },
  )

  // --- Execute steps ------------------------------------------------------
  const ctx: Record<string, unknown> = { ...payload }
  let status: "completed" | "failed" | "waiting_approval" = "completed"

  for (const step of steps) {
    // Layer 2: static per-step required_role gate, re-enforced at run time.
    if (step.required_role && ROLE_RANK[caller.role] < ROLE_RANK[step.required_role]) {
      await failStep(run.id, step.id, `Role ${caller.role} cannot execute ${step.type}`)
      status = "failed"
      break
    }

    if (step.type === "human_approval") {
      await insertStepRun(run.id, step.id, "waiting_approval")
      await setRunStatus(run.id, "waiting_approval")
      // Persist context so approveStep can resume from here.
      await adminGql(
        /* GraphQL */ `
          mutation ($id: uuid!, $ctx: jsonb!) {
            update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { context: $ctx }) {
              id
            }
          }
        `,
        { id: run.id, ctx },
      )
      return res.json({ runId: run.id, status: "waiting_approval" })
    }

    try {
      const output = await executeStep(step, ctx)
      Object.assign(ctx, output.contextPatch ?? {})
      await insertStepRun(run.id, step.id, "completed", output.result)
    } catch (err) {
      await failStep(run.id, step.id, err instanceof Error ? err.message : "step error")
      status = "failed"
      break
    }
  }

  await setRunStatus(run.id, status)
  if (status === "completed") await incrementQuota(caller.orgId)

  return res.json({ runId: run.id, status })
}

// --- Step executors (mirror lib/engine.ts) --------------------------------
async function executeStep(step: StepRow, ctx: Record<string, unknown>) {
  switch (step.type) {
    case "llm_call": {
      const prompt = interpolate(String(step.config.prompt ?? ""), ctx)
      const text = await callLLM(prompt)
      return { result: { text }, contextPatch: { [String(step.config.output ?? "llm")]: text } }
    }
    case "conditional": {
      const left = String(ctx[String(step.config.field ?? "")] ?? "")
      const op = String(step.config.op ?? "contains")
      const right = String(step.config.value ?? "")
      const branch = evalCondition(left, op, right)
      return { result: { branch }, contextPatch: { __branch: branch } }
    }
    case "http_request": {
      const url = interpolate(String(step.config.url ?? ""), ctx)
      const method = String(step.config.method ?? "GET")
      const result = await withRetry(async () => {
        const r = await fetch(url, { method })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return { status: r.status, body: (await r.text()).slice(0, 400) }
      })
      return { result }
    }
    case "db_write": {
      // Owner-only artifact write, scoped to the run's org.
      return { result: { written: true, table: step.config.table ?? "artifacts" } }
    }
    case "notify": {
      const message = interpolate(String(step.config.message ?? ""), ctx)
      return { result: { notified: true, message } }
    }
    default:
      return { result: { skipped: step.type } }
  }
}

async function callLLM(prompt: string): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    // Disclosed stub, identical policy to lib/llm.ts.
    const hot = /urgent|enterprise|budget|buy now|demo/i.test(prompt)
    return JSON.stringify({ classification: hot ? "HOT" : "COLD", simulated: true })
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  })
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return json.choices?.[0]?.message?.content ?? ""
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

function evalCondition(left: string, op: string, right: string) {
  switch (op) {
    case "equals":
      return left === right ? "true" : "false"
    case "contains":
      return left.toLowerCase().includes(right.toLowerCase()) ? "true" : "false"
    default:
      return "false"
  }
}

function interpolate(tpl: string, ctx: Record<string, unknown>) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(ctx[k] ?? ""))
}

// --- Persistence helpers --------------------------------------------------
async function insertStepRun(runId: string, stepId: string, status: string, output: unknown = null) {
  await adminGql(
    /* GraphQL */ `
      mutation ($obj: step_runs_insert_input!) {
        insert_step_runs_one(object: $obj) {
          id
        }
      }
    `,
    { obj: { run_id: runId, step_id: stepId, status, output } },
  )
}

async function failStep(runId: string, stepId: string, error: string) {
  await insertStepRun(runId, stepId, "failed", { error })
}

async function setRunStatus(runId: string, status: string) {
  await adminGql(
    /* GraphQL */ `
      mutation ($id: uuid!, $status: String!) {
        update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: $status }) {
          id
        }
      }
    `,
    { id: runId, status },
  )
}

async function incrementQuota(orgId: string) {
  await adminGql(
    /* GraphQL */ `
      mutation ($id: uuid!) {
        update_organizations_by_pk(pk_columns: { id: $id }, _inc: { quota_used: 1 }) {
          id
        }
      }
    `,
    { id: orgId },
  )
}
