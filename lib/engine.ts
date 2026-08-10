import { callLLM } from "./llm"
import {
  createRun,
  createStepRun,
  incrementQuota,
  raw,
  roleInOrg,
  updateRun,
  updateStepRun,
  writeArtifact,
} from "./store"
import type { StepRun, WorkflowRun, WorkflowStep, TriggerType } from "./types"

// ---------------------------------------------------------------------------
// Workflow engine — the mock stand-in for the Hasura Action handler.
//
// Responsibilities mirror the assignment's `triggerWorkflowRun`:
//   1. Verify caller is owner/editor in the workflow's org (done by caller for
//      manual runs; webhook/event runs pass a system principal).
//   2. Check the org quota isn't exhausted.
//   3. Create the run, execute steps in order.
//   4. llm_call / http_request make real external calls with >= 1 retry.
//   5. approval_gate -> set run paused and STOP; approveStep resumes.
//   6. Update step_runs / run status throughout for live subscriptions.
//   7. Increment org quota usage on completion.
//
// Execution runs detached from the request so the client can stream progress.
// ---------------------------------------------------------------------------

const STEP_DELAY_MS = 700 // visible pacing for the live subscription demo
const MAX_ATTEMPTS = 2 // initial try + 1 retry

export type TriggerResult =
  | { ok: true; runId: string }
  | { ok: false; error: string; code: "quota" | "forbidden" | "not_found" | "config" }

interface RunContext {
  lastOutput: unknown
  billableCalls: number
}

const contexts = new Map<string, RunContext>()

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Entry point for a manual/webhook/event run. Authorization for manual runs is
// checked in the server action before calling this; system-triggered runs pass
// systemPrincipal=true to represent an automated caller (webhook/cron/event).
export function startRun(input: {
  workflowId: string
  triggeredBy: string
  triggerType: TriggerType
}): TriggerResult {
  const wf = raw.workflow(input.workflowId)
  if (!wf) return { ok: false, error: "Workflow not found", code: "not_found" }

  const org = raw.org(wf.orgId)
  if (!org) return { ok: false, error: "Org not found", code: "not_found" }

  // Quota check (Action handler responsibility).
  if (org.quotaUsed >= org.quotaAllowed) {
    return { ok: false, error: "Organization quota exhausted for this period", code: "quota" }
  }

  const steps = raw.stepsFor(input.workflowId)
  if (steps.length === 0) return { ok: false, error: "Workflow has no steps", code: "config" }

  const run = createRun({
    workflowId: input.workflowId,
    orgId: wf.orgId,
    triggeredBy: input.triggeredBy,
    triggerType: input.triggerType,
  })

  // Pre-create step_runs as pending so the subscription shows the full plan.
  steps.forEach((s) =>
    createStepRun({
      runId: run.id,
      stepId: s.id,
      order: s.order,
      type: s.type,
      name: s.name,
      status: "pending",
      attempt: 0,
    }),
  )

  contexts.set(run.id, { lastOutput: undefined, billableCalls: 0 })

  // Detach execution so the request returns immediately and the client streams.
  void execute(run.id, 0)

  return { ok: true, runId: run.id }
}

// Resume a paused run after an approval_gate clears. Called by approveStep once
// the approver's role has been verified.
export function resumeRun(runId: string, fromOrder: number) {
  updateRun(runId, { status: "running" })
  void execute(runId, fromOrder)
}

async function execute(runId: string, fromOrder: number) {
  const run = raw.run(runId)
  if (!run) return
  const steps = raw.stepsFor(run.workflowId)
  const ctx = contexts.get(runId) ?? { lastOutput: undefined, billableCalls: 0 }
  contexts.set(runId, ctx)

  updateRun(runId, { status: "running" })

  for (const step of steps) {
    if (step.order < fromOrder) continue

    const sr = raw.stepRunsFor(runId).find((x) => x.stepId === step.id)
    if (!sr) continue
    if (sr.status === "completed" || sr.status === "skipped") continue

    await sleep(STEP_DELAY_MS)

    // approval_gate: pause the whole run and stop. Resume happens via approveStep.
    if (step.type === "approval_gate") {
      updateStepRun(sr.id, { status: "paused", startedAt: nowIfEmpty(sr) })
      updateRun(runId, { status: "paused" })
      return
    }

    updateStepRun(sr.id, { status: "running", startedAt: new Date().toISOString(), input: ctx.lastOutput })

    try {
      const output = await runStep(step, run, ctx)

      // conditional_branch may signal that subsequent steps should be skipped.
      if (step.type === "conditional_branch") {
        const { branchTaken, skipCount } = output as { branchTaken: string; skipCount: number }
        updateStepRun(sr.id, {
          status: "completed",
          output,
          finishedAt: new Date().toISOString(),
          attempt: Math.max(sr.attempt, 1),
        })
        if (skipCount > 0) {
          skipNext(runId, step.order, skipCount)
        }
        ctx.lastOutput = branchTaken
        continue
      }

      updateStepRun(sr.id, {
        status: "completed",
        output,
        finishedAt: new Date().toISOString(),
        attempt: Math.max(sr.attempt, 1),
      })
      ctx.lastOutput = extractLast(step, output)
    } catch (err) {
      updateStepRun(sr.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date().toISOString(),
      })
      updateRun(runId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: `Step "${step.name}" failed`,
      })
      return
    }
  }

  // Completed all steps -> bill quota once for the run's billable calls.
  const billed = Math.max(1, ctx.billableCalls)
  incrementQuota(run.orgId, billed)
  updateRun(runId, { status: "completed", finishedAt: new Date().toISOString() })
  contexts.delete(runId)
}

function nowIfEmpty(sr: StepRun) {
  return sr.startedAt ?? new Date().toISOString()
}

function skipNext(runId: string, afterOrder: number, count: number) {
  const srs = raw
    .stepRunsFor(runId)
    .filter((x) => x.order > afterOrder && x.status === "pending")
    .slice(0, count)
  srs.forEach((x) =>
    updateStepRun(x.id, {
      status: "skipped",
      finishedAt: new Date().toISOString(),
      output: { skipped: true, reason: "conditional_branch" },
    }),
  )
}

function extractLast(step: WorkflowStep, output: unknown): unknown {
  if (step.type === "llm_call") return (output as { text: string }).text
  return output
}

// --- individual step executors with retry for external calls ----------------

async function runStep(step: WorkflowStep, run: WorkflowRun, ctx: RunContext): Promise<unknown> {
  switch (step.type) {
    case "llm_call": {
      const prompt = String(step.config.prompt ?? "")
      const model = step.config.model ? String(step.config.model) : undefined
      const result = await withRetry(step.id, () => callLLM(prompt, model))
      ctx.billableCalls += 1
      return { text: result.text, model: result.model, stubbed: result.stubbed }
    }
    case "http_request": {
      const url = String(step.config.url ?? "")
      const method = String(step.config.method ?? "GET")
      if (!url) throw new Error("http_request step missing url")
      const result = await withRetry(step.id, async () => {
        const res = await fetch(url, { method })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.text()
        return { status: res.status, body: body.slice(0, 400) }
      })
      ctx.billableCalls += 1
      return result
    }
    case "db_write": {
      const value = { savedFrom: step.name, previous: ctx.lastOutput, at: new Date().toISOString() }
      const art = writeArtifact({ orgId: run.orgId, runId: run.id, stepId: step.id, value })
      return { artifactId: art.id, written: true, value }
    }
    case "notify": {
      // In a real Hasura setup this fires via an Event Trigger on an inserted
      // row. Here we record the notification payload synchronously.
      return {
        channel: step.config.channel ?? "#general",
        message: step.config.message ?? "",
        delivered: true,
        deliveredAt: new Date().toISOString(),
      }
    }
    case "conditional_branch": {
      const needle = String(step.config.contains ?? "")
      const skipCount = Number(step.config.skipCount ?? 1)
      const prev = String(ctx.lastOutput ?? "")
      const matched = needle.length > 0 && prev.toUpperCase().includes(needle.toUpperCase())
      return {
        matched,
        needle,
        against: prev,
        branchTaken: matched ? "true" : "false",
        // When the condition is false, skip the next `skipCount` steps
        // (e.g. skip the approval gate for COLD leads).
        skipCount: matched ? 0 : skipCount,
      }
    }
    default:
      throw new Error(`Unknown step type: ${step.type}`)
  }
}

async function withRetry<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const out = await fn()
      // Reflect the successful attempt number on the step run if it exists.
      return out
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        await sleep(400)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

// --- approval (Layer-2 dynamic gate) -----------------------------------------

export type ApproveResult =
  | { ok: true }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "state" }

// Verifies the approver's role IN THE RUN'S ORG before resuming — this is the
// mid-execution decision the assignment says cannot be a static DB permission.
export function approveStep(input: { stepRunId: string; approverId: string }): ApproveResult {
  const sr = raw.stepRun(input.stepRunId)
  if (!sr) return { ok: false, error: "Step run not found", code: "not_found" }
  if (sr.status !== "paused") return { ok: false, error: "Step is not awaiting approval", code: "state" }

  const run = raw.run(sr.runId)
  if (!run) return { ok: false, error: "Run not found", code: "not_found" }

  const role = roleInOrg(input.approverId, run.orgId)
  if (role !== "owner" && role !== "editor") {
    return { ok: false, error: "Only an owner or editor in this org can approve", code: "forbidden" }
  }

  updateStepRun(sr.id, {
    status: "completed",
    approvedBy: input.approverId,
    approvedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    output: { approved: true, by: input.approverId },
  })

  // Resume from the next step after the gate.
  resumeRun(run.id, sr.order + 1)
  return { ok: true }
}
