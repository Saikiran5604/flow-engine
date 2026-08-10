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
} from "../types"

// ---------------------------------------------------------------------------
// DataLayer — the single persistence seam for the whole app.
//
// Both the engine and the server actions talk ONLY to this interface, never to
// a concrete store. That is what makes the backend swappable:
//
//   - `memory`  (lib/data/memory.ts) — in-process arrays; powers the live
//     demo and tests. Selected when no nhost env vars are present.
//   - `nhost`   (lib/data/nhost.ts)  — Hasura GraphQL over the wire; selected
//     automatically when NHOST_GRAPHQL_URL + NHOST_ADMIN_SECRET are set.
//
// Everything is async so a network-backed implementation is a drop-in. The
// in-memory implementation simply resolves immediately.
//
// IMPORTANT: this interface is deliberately "admin-level" — it does no
// authorization. Layer 1 (org scoping) and Layer 2 (capability/approval) are
// enforced ABOVE this seam, in lib/actions.ts and lib/engine.ts, exactly as
// they will be enforced by Hasura permissions + the Action handler in prod.
// The nhost adapter therefore connects with the admin secret; per-user scoping
// is applied by the caller, mirroring how the serverless functions run.
// ---------------------------------------------------------------------------

export interface ArtifactRecord {
  id: string
  orgId: string
  runId: string
  stepId: string
  value: unknown
  createdAt: string
}

export interface LoginUser {
  id: string
  name: string
  email: string
  org: string
  role: Role
}

export interface DataLayer {
  // --- users / auth ---------------------------------------------------------
  getUser(id: string): Promise<User | undefined>
  listLoginUsers(): Promise<LoginUser[]>

  // --- orgs / membership (Layer 1 inputs) -----------------------------------
  getOrg(id: string): Promise<Organization | undefined>
  getMembership(userId: string, orgId: string): Promise<OrgMember | undefined>
  // The caller's single org membership — the mock-auth equivalent of reading
  // org id + role out of a Hasura JWT's session claims.
  getPrimaryMembership(userId: string): Promise<OrgMember | undefined>
  roleInOrg(userId: string, orgId: string): Promise<Role | undefined>
  listMembers(orgId: string): Promise<Array<OrgMember & { user: User }>>

  // --- workflows ------------------------------------------------------------
  getWorkflow(id: string): Promise<Workflow | undefined>
  listWorkflowsByOrg(orgId: string): Promise<Workflow[]>
  createWorkflow(input: { orgId: string; name: string; createdBy: string }): Promise<Workflow>
  renameWorkflow(workflowId: string, name: string): Promise<void>

  // --- steps / triggers -----------------------------------------------------
  getSteps(workflowId: string): Promise<WorkflowStep[]>
  getTriggers(workflowId: string): Promise<WorkflowTrigger[]>
  getTriggerByToken(token: string): Promise<WorkflowTrigger | undefined>
  listTriggersByType(type: WorkflowTrigger["type"]): Promise<WorkflowTrigger[]>
  updateTrigger(id: string, patch: Partial<WorkflowTrigger>): Promise<void>
  replaceSteps(workflowId: string, steps: Omit<WorkflowStep, "id" | "workflowId">[]): Promise<void>
  replaceTriggers(workflowId: string, triggers: Omit<WorkflowTrigger, "id" | "workflowId">[]): Promise<void>

  // --- runs / step runs -----------------------------------------------------
  getRun(id: string): Promise<WorkflowRun | undefined>
  getLatestRun(workflowId: string): Promise<WorkflowRun | undefined>
  listRuns(workflowId: string): Promise<WorkflowRun[]>
  createRun(input: {
    workflowId: string
    orgId: string
    triggeredBy: string
    triggerType: WorkflowRun["triggerType"]
  }): Promise<WorkflowRun>
  updateRun(id: string, patch: Partial<WorkflowRun>): Promise<void>

  getStepRun(id: string): Promise<StepRun | undefined>
  getStepRuns(runId: string): Promise<StepRun[]>
  createStepRun(input: Omit<StepRun, "id">): Promise<StepRun>
  updateStepRun(id: string, patch: Partial<StepRun>): Promise<void>

  // --- quota / artifacts ----------------------------------------------------
  incrementQuota(orgId: string, by?: number): Promise<void>
  writeArtifact(input: { orgId: string; runId: string; stepId: string; value: unknown }): Promise<ArtifactRecord>

  // --- aggregation ----------------------------------------------------------
  getUsageStats(orgId: string): Promise<UsageStats>
}
