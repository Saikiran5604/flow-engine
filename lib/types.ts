// ---------------------------------------------------------------------------
// Domain types. These mirror the Postgres tables the assignment asks for so the
// in-memory store can be swapped for Hasura/nhost later with minimal churn:
//   organizations -> org_members -> workflows -> steps/triggers
//   workflows -> workflow_runs -> step_runs
// ---------------------------------------------------------------------------

export type Role = "owner" | "editor" | "viewer"

export type StepType =
  | "llm_call"
  | "http_request"
  | "db_write"
  | "notify"
  | "conditional_branch"
  | "approval_gate"

export type TriggerType = "manual" | "webhook" | "scheduled" | "database_event"

export type RunStatus = "pending" | "running" | "paused" | "completed" | "failed"

export type StepRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"

// Step types that reach outside the sandbox and are restricted to owners only
// (Layer 2, static portion). approval_gate clearance is enforced dynamically in
// the Action handler, not here.
export const OWNER_ONLY_STEP_TYPES: StepType[] = ["db_write", "notify"]
export const OWNER_ONLY_TRIGGER_TYPES: TriggerType[] = ["webhook"]

export interface User {
  id: string
  email: string
  name: string
}

export interface Organization {
  id: string
  name: string
  quotaAllowed: number // calls allowed per period
  quotaUsed: number // calls used this period
  period: string // e.g. "2026-08"
}

export interface OrgMember {
  userId: string
  orgId: string
  role: Role
}

export interface WorkflowStep {
  id: string
  workflowId: string
  order: number
  type: StepType
  name: string
  config: Record<string, unknown>
}

export interface WorkflowTrigger {
  id: string
  workflowId: string
  type: TriggerType
  config: Record<string, unknown>
  // webhook token used to build an inbound URL; only present for webhook triggers
  token?: string
}

export interface Workflow {
  id: string
  orgId: string
  name: string
  createdBy: string
  createdAt: string
}

export interface WorkflowRun {
  id: string
  workflowId: string
  orgId: string
  status: RunStatus
  triggeredBy: string // userId or trigger label
  triggerType: TriggerType
  startedAt: string
  finishedAt?: string
  error?: string
}

export interface StepRun {
  id: string
  runId: string
  stepId: string
  order: number
  type: StepType
  name: string
  status: StepRunStatus
  input?: unknown
  output?: unknown
  error?: string
  attempt: number
  approvedBy?: string
  approvedAt?: string
  startedAt?: string
  finishedAt?: string
}

export interface SessionUser {
  user: User
  orgId: string
  orgName: string
  role: Role
}
