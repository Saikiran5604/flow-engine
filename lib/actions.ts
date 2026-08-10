"use server"

import { revalidatePath } from "next/cache"
import { clearSession, getSession, setSession } from "./auth"
import { getDataLayer } from "./data"
import { approveStep as engineApprove, startRun } from "./engine"
import {
  OWNER_ONLY_STEP_TYPES,
  OWNER_ONLY_TRIGGER_TYPES,
  type Role,
  type SessionUser,
  type StepType,
  type TriggerType,
} from "./types"

// ===========================================================================
// Server actions. Every action that touches org data re-derives the session on
// the server and scopes to the caller's org (Layer 1). A resource in another
// org is treated as not-found, so direct ID guessing reveals nothing.
//
// All persistence goes through the DataLayer seam (lib/data), so these exact
// checks run unchanged whether the backend is the in-memory store or Hasura.
// ===========================================================================

function can(role: Role, action: "manage_members" | "edit" | "trigger" | "view"): boolean {
  switch (action) {
    case "view":
      return true
    case "manage_members":
      return role === "owner"
    case "edit":
      return role === "owner" || role === "editor"
    case "trigger":
      return role === "owner" || role === "editor"
  }
}

// --- auth --------------------------------------------------------------------

export async function loginAction(userId: string) {
  const dl = await getDataLayer()
  const user = await dl.getUser(userId)
  if (!user) return { ok: false, error: "Unknown user" }
  await setSession(userId)
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function logoutAction() {
  await clearSession()
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function listLoginUsers() {
  // Public helper for the login screen only.
  const dl = await getDataLayer()
  return dl.listLoginUsers()
}

// --- reads (org-scoped) ------------------------------------------------------

export interface WorkflowSummary {
  id: string
  name: string
  stepCount: number
  triggerTypes: TriggerType[]
  latestRunStatus: string | null
  latestRunId: string | null
}

export async function getWorkflows(): Promise<{ session: SessionUser | null; workflows: WorkflowSummary[] }> {
  const session = await getSession()
  if (!session) return { session: null, workflows: [] }

  const dl = await getDataLayer()
  const owned = await dl.listWorkflowsByOrg(session.orgId) // Layer 1
  const workflows = await Promise.all(
    owned.map(async (w) => {
      const [steps, triggers, latest] = await Promise.all([
        dl.getSteps(w.id),
        dl.getTriggers(w.id),
        dl.getLatestRun(w.id),
      ])
      return {
        id: w.id,
        name: w.name,
        stepCount: steps.length,
        triggerTypes: triggers.map((t) => t.type),
        latestRunStatus: latest?.status ?? null,
        latestRunId: latest?.id ?? null,
      }
    }),
  )

  return { session, workflows }
}

export async function getWorkflowDetail(workflowId: string) {
  const session = await getSession()
  if (!session) return { error: "unauthenticated" as const }

  const dl = await getDataLayer()
  const wf = await dl.getWorkflow(workflowId)
  // Layer 1: cross-org access is indistinguishable from not-found.
  if (!wf || wf.orgId !== session.orgId) return { error: "not_found" as const }

  const [steps, triggers, latest] = await Promise.all([
    dl.getSteps(wf.id),
    dl.getTriggers(wf.id),
    dl.getLatestRun(workflowId),
  ])
  return {
    session,
    workflow: {
      id: wf.id,
      name: wf.name,
      orgId: wf.orgId,
      steps,
      triggers,
      latestRunId: latest?.id ?? null,
    },
  }
}

export async function getRunState(runId: string) {
  const session = await getSession()
  if (!session) return { error: "unauthenticated" as const }

  const dl = await getDataLayer()
  const run = await dl.getRun(runId)
  // Layer 1: a run in another org is not found for this caller.
  if (!run || run.orgId !== session.orgId) return { error: "not_found" as const }

  return {
    run,
    steps: await dl.getStepRuns(runId),
    canApprove: can(session.role, "trigger"),
  }
}

export async function getQuota() {
  const session = await getSession()
  if (!session) return null
  const dl = await getDataLayer()
  const org = (await dl.getOrg(session.orgId))!
  return { used: org.quotaUsed, allowed: org.quotaAllowed, period: org.period, orgName: org.name }
}

export async function getUsageStats() {
  const session = await getSession()
  if (!session) return null
  const dl = await getDataLayer()
  return dl.getUsageStats(session.orgId) // Layer 1: scoped to caller's org
}

export async function getOrgMembers() {
  const session = await getSession()
  if (!session) return []
  const dl = await getDataLayer()
  const members = await dl.listMembers(session.orgId)
  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    role: m.role,
  }))
}

// --- writes ------------------------------------------------------------------

export interface StepInput {
  order: number
  type: StepType
  name: string
  config: Record<string, unknown>
}
export interface TriggerInput {
  type: TriggerType
  config: Record<string, unknown>
}

// Create or edit a workflow, its steps and triggers in one mutation.
export async function saveWorkflow(input: {
  workflowId?: string
  name: string
  steps: StepInput[]
  triggers: TriggerInput[]
}) {
  const session = await getSession()
  if (!session) return { ok: false as const, error: "Not authenticated" }
  if (!can(session.role, "edit")) return { ok: false as const, error: "Viewers cannot edit workflows" }

  // Layer 2 (static): only owners may add outward-reaching steps/triggers.
  if (session.role !== "owner") {
    const badStep = input.steps.find((s) => OWNER_ONLY_STEP_TYPES.includes(s.type))
    if (badStep) {
      return {
        ok: false as const,
        error: `Only an owner can add a "${badStep.type}" step`,
      }
    }
    const badTrigger = input.triggers.find((t) => OWNER_ONLY_TRIGGER_TYPES.includes(t.type))
    if (badTrigger) {
      return { ok: false as const, error: `Only an owner can add a "${badTrigger.type}" trigger` }
    }
  }

  const dl = await getDataLayer()
  let workflowId = input.workflowId
  if (workflowId) {
    const wf = await dl.getWorkflow(workflowId)
    if (!wf || wf.orgId !== session.orgId) return { ok: false as const, error: "Workflow not found" }
    await dl.renameWorkflow(workflowId, input.name)
  } else {
    const wf = await dl.createWorkflow({ orgId: session.orgId, name: input.name, createdBy: session.user.id })
    workflowId = wf.id
  }

  await dl.replaceSteps(
    workflowId,
    input.steps.map((s, i) => ({ ...s, order: i })),
  )
  await dl.replaceTriggers(workflowId, input.triggers)

  revalidatePath("/")
  return { ok: true as const, workflowId }
}

// --- run + approve -----------------------------------------------------------

export async function triggerWorkflowRunAction(workflowId: string) {
  const session = await getSession()
  if (!session) return { ok: false as const, error: "Not authenticated" }

  const dl = await getDataLayer()
  const wf = await dl.getWorkflow(workflowId)
  // Layer 1: cross-org trigger attempts fail as not-found.
  if (!wf || wf.orgId !== session.orgId) return { ok: false as const, error: "Workflow not found" }

  // Layer 1 (role): viewers cannot trigger.
  if (!can(session.role, "trigger")) {
    return { ok: false as const, error: "Viewers cannot trigger runs" }
  }

  const result = await startRun({
    workflowId,
    triggeredBy: session.user.id,
    triggerType: "manual",
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, runId: result.runId }
}

export async function approveStepAction(stepRunId: string) {
  const session = await getSession()
  if (!session) return { ok: false as const, error: "Not authenticated" }

  const dl = await getDataLayer()
  // Cross-org guard before the engine's role check.
  const sr = await dl.getStepRun(stepRunId)
  if (!sr) return { ok: false as const, error: "Step not found" }
  const run = await dl.getRun(sr.runId)
  if (!run || run.orgId !== session.orgId) return { ok: false as const, error: "Step not found" }

  // Layer 2 (dynamic): engine verifies approver role mid-execution.
  const result = await engineApprove({ stepRunId, approverId: session.user.id })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const }
}
