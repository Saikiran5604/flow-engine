import type {
  Organization,
  OrgMember,
  Role,
  StepRun,
  UsageStats,
  User,
  Workflow,
  WorkflowRun,
  WorkflowStep,
  WorkflowTrigger,
} from "./types"

// ---------------------------------------------------------------------------
// In-memory data layer.
//
// This intentionally hides all persistence behind a small API so it can be
// replaced by Hasura/nhost GraphQL calls later without touching the engine or
// UI. State is stored on globalThis so it survives Next.js dev HMR reloads and
// is shared across all server requests within a running server instance.
// ---------------------------------------------------------------------------

export interface Artifact {
  id: string
  orgId: string
  runId: string
  stepId: string
  value: unknown
  createdAt: string
}

interface DB {
  users: User[]
  organizations: Organization[]
  orgMembers: OrgMember[]
  workflows: Workflow[]
  steps: WorkflowStep[]
  triggers: WorkflowTrigger[]
  runs: WorkflowRun[]
  stepRuns: StepRun[]
  artifacts: Artifact[]
}

const CURRENT_PERIOD = "2026-08"

function seed(): DB {
  const users: User[] = [
    { id: "u_alice", email: "alice@acme.test", name: "Alice (Acme Owner)" },
    { id: "u_evan", email: "evan@acme.test", name: "Evan (Acme Editor)" },
    { id: "u_vera", email: "vera@acme.test", name: "Vera (Acme Viewer)" },
    { id: "u_bob", email: "bob@globex.test", name: "Bob (Globex Owner)" },
    { id: "u_gwen", email: "gwen@globex.test", name: "Gwen (Globex Editor)" },
  ]

  const organizations: Organization[] = [
    { id: "org_acme", name: "Acme AI", quotaAllowed: 25, quotaUsed: 3, period: CURRENT_PERIOD },
    { id: "org_globex", name: "Globex Labs", quotaAllowed: 25, quotaUsed: 0, period: CURRENT_PERIOD },
  ]

  const orgMembers: OrgMember[] = [
    { userId: "u_alice", orgId: "org_acme", role: "owner" },
    { userId: "u_evan", orgId: "org_acme", role: "editor" },
    { userId: "u_vera", orgId: "org_acme", role: "viewer" },
    { userId: "u_bob", orgId: "org_globex", role: "owner" },
    { userId: "u_gwen", orgId: "org_globex", role: "editor" },
  ]

  const db: DB = {
    users,
    organizations,
    orgMembers,
    workflows: [],
    steps: [],
    triggers: [],
    runs: [],
    stepRuns: [],
    artifacts: [],
  }

  seedDemoWorkflow(db)
  return db
}

// A ready-made Acme workflow that satisfies the Final Task shape:
// llm_call -> conditional_branch -> approval_gate -> http_request -> notify,
// with both a manual and a webhook trigger.
function seedDemoWorkflow(db: DB) {
  const wfId = "wf_demo_acme"
  db.workflows.push({
    id: wfId,
    orgId: "org_acme",
    name: "Lead Triage Agent",
    createdBy: "u_alice",
    createdAt: new Date().toISOString(),
  })

  const steps: WorkflowStep[] = [
    {
      id: "st_llm",
      workflowId: wfId,
      order: 0,
      type: "llm_call",
      name: "Classify lead intent",
      config: {
        prompt:
          "Classify the following lead message as HOT or COLD. Reply with only one word.\n\nMessage: We have budget approved and want to buy 500 seats this quarter.",
        model: "llama-3.1-8b-instant",
      },
    },
    {
      id: "st_cond",
      workflowId: wfId,
      order: 1,
      type: "conditional_branch",
      name: "Route on intent",
      config: {
        // if previous output contains this substring, take the "true" path
        contains: "HOT",
        description: "If the LLM says HOT, require human approval before outreach.",
      },
    },
    {
      id: "st_approval",
      workflowId: wfId,
      order: 2,
      type: "approval_gate",
      name: "Approve hot-lead outreach",
      config: { note: "An owner or editor must approve before we contact the lead." },
    },
    {
      id: "st_http",
      workflowId: wfId,
      order: 3,
      type: "http_request",
      name: "Enrich via public API",
      config: { method: "GET", url: "https://httpbin.org/uuid" },
    },
    {
      id: "st_notify",
      workflowId: wfId,
      order: 4,
      type: "notify",
      name: "Alert sales channel",
      config: { channel: "#sales", message: "Hot lead approved and enriched." },
    },
  ]
  db.steps.push(...steps)

  db.triggers.push(
    { id: "tg_manual", workflowId: wfId, type: "manual", config: {} },
    { id: "tg_webhook", workflowId: wfId, type: "webhook", config: {}, token: "acme-demo-token" },
    // Fires automatically on an interval; the in-app heartbeat drives it in the
    // live demo, a Hasura cron trigger drives it in production.
    { id: "tg_sched", workflowId: wfId, type: "scheduled", config: { everySeconds: 90, enabled: true } },
  )
}

function getDB(): DB {
  const g = globalThis as unknown as { __WF_DB__?: DB }
  if (!g.__WF_DB__) {
    g.__WF_DB__ = seed()
  }
  return g.__WF_DB__
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

// --- raw accessors (unscoped) — engine/webhook use these deliberately ---------

export const raw = {
  db: getDB,
  users: () => getDB().users,
  user: (id: string) => getDB().users.find((u) => u.id === id),
  org: (id: string) => getDB().organizations.find((o) => o.id === id),
  workflow: (id: string) => getDB().workflows.find((w) => w.id === id),
  stepsFor: (workflowId: string) =>
    getDB()
      .steps.filter((s) => s.workflowId === workflowId)
      .sort((a, b) => a.order - b.order),
  triggersFor: (workflowId: string) => getDB().triggers.filter((t) => t.workflowId === workflowId),
  triggerByToken: (token: string) => getDB().triggers.find((t) => t.type === "webhook" && t.token === token),
  trigger: (id: string) => getDB().triggers.find((t) => t.id === id),
  triggersByType: (type: WorkflowTrigger["type"]) => getDB().triggers.filter((t) => t.type === type),
  run: (id: string) => getDB().runs.find((r) => r.id === id),
  stepRunsFor: (runId: string) =>
    getDB()
      .stepRuns.filter((sr) => sr.runId === runId)
      .sort((a, b) => a.order - b.order),
  stepRun: (id: string) => getDB().stepRuns.find((sr) => sr.id === id),
  latestRunFor: (workflowId: string) =>
    getDB()
      .runs.filter((r) => r.workflowId === workflowId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0],
}

// --- membership / Layer-1 helpers --------------------------------------------

export function membership(userId: string, orgId: string): OrgMember | undefined {
  return getDB().orgMembers.find((m) => m.userId === userId && m.orgId === orgId)
}

export function roleInOrg(userId: string, orgId: string): Role | undefined {
  return membership(userId, orgId)?.role
}

export function membersOf(orgId: string) {
  const db = getDB()
  return db.orgMembers
    .filter((m) => m.orgId === orgId)
    .map((m) => ({ ...m, user: db.users.find((u) => u.id === m.userId)! }))
}

// --- mutations ----------------------------------------------------------------

export function createWorkflow(input: { orgId: string; name: string; createdBy: string }): Workflow {
  const wf: Workflow = {
    id: uid("wf"),
    orgId: input.orgId,
    name: input.name,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  }
  getDB().workflows.push(wf)
  return wf
}

export function replaceSteps(workflowId: string, steps: Omit<WorkflowStep, "id" | "workflowId">[]) {
  const db = getDB()
  db.steps = db.steps.filter((s) => s.workflowId !== workflowId)
  steps
    .sort((a, b) => a.order - b.order)
    .forEach((s, i) => {
      db.steps.push({ ...s, order: i, id: uid("st"), workflowId })
    })
}

export function replaceTriggers(workflowId: string, triggers: Omit<WorkflowTrigger, "id" | "workflowId">[]) {
  const db = getDB()
  db.triggers = db.triggers.filter((t) => t.workflowId !== workflowId)
  triggers.forEach((t) => {
    db.triggers.push({
      ...t,
      id: uid("tg"),
      workflowId,
      token: t.type === "webhook" ? t.token || uid("tok") : undefined,
    })
  })
}

export function renameWorkflow(workflowId: string, name: string) {
  const wf = raw.workflow(workflowId)
  if (wf) wf.name = name
}

export function createRun(input: {
  workflowId: string
  orgId: string
  triggeredBy: string
  triggerType: WorkflowRun["triggerType"]
}): WorkflowRun {
  const run: WorkflowRun = {
    id: uid("run"),
    workflowId: input.workflowId,
    orgId: input.orgId,
    status: "pending",
    triggeredBy: input.triggeredBy,
    triggerType: input.triggerType,
    startedAt: new Date().toISOString(),
  }
  getDB().runs.push(run)
  return run
}

export function createStepRun(input: Omit<StepRun, "id">): StepRun {
  const sr: StepRun = { ...input, id: uid("sr") }
  getDB().stepRuns.push(sr)
  return sr
}

export function updateRun(id: string, patch: Partial<WorkflowRun>) {
  const run = raw.run(id)
  if (run) Object.assign(run, patch)
}

export function updateStepRun(id: string, patch: Partial<StepRun>) {
  const sr = raw.stepRun(id)
  if (sr) Object.assign(sr, patch)
}

export function incrementQuota(orgId: string, by = 1) {
  const org = raw.org(orgId)
  if (org) org.quotaUsed += by
}

export function writeArtifact(input: { orgId: string; runId: string; stepId: string; value: unknown }) {
  const a = {
    id: uid("art"),
    orgId: input.orgId,
    runId: input.runId,
    stepId: input.stepId,
    value: input.value,
    createdAt: new Date().toISOString(),
  }
  getDB().artifacts.push(a)
  return a
}

export function updateTrigger(id: string, patch: Partial<WorkflowTrigger>) {
  const t = raw.trigger(id)
  if (t) Object.assign(t, patch)
}

// Aggregation over an org's runs for the current period. Mirrors the
// org_usage_stats SQL view / GraphQL aggregate used in production.
export function usageStats(orgId: string): UsageStats {
  const db = getDB()
  const runs = db.runs.filter((r) => r.orgId === orgId && r.startedAt.slice(0, 7) === CURRENT_PERIOD)
  const completed = runs.filter((r) => r.status === "completed")
  const failed = runs.filter((r) => r.status === "failed")
  const paused = runs.filter((r) => r.status === "paused")

  const durations = completed
    .filter((r) => r.finishedAt)
    .map((r) => new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime())
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null

  return {
    period: CURRENT_PERIOD,
    totalRuns: runs.length,
    completedRuns: completed.length,
    failedRuns: failed.length,
    pausedRuns: paused.length,
    avgDurationMs,
  }
}

export const CURRENT_PERIOD_LABEL = CURRENT_PERIOD
