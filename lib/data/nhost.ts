import type {
  Organization,
  OrgMember,
  Role,
  StepRun,
  StepRunStatus,
  StepType,
  TriggerType,
  User,
  Workflow,
  WorkflowRun,
  WorkflowStep,
  WorkflowTrigger,
} from "../types"
import type { ArtifactRecord, DataLayer, LoginUser } from "./adapter"

// ---------------------------------------------------------------------------
// nhost / Hasura GraphQL DataLayer.
//
// A dependency-free GraphQL client (just fetch) that talks to Hasura with the
// admin secret. It is selected automatically by lib/data/index.ts when
// NHOST_GRAPHQL_URL + NHOST_ADMIN_SECRET are set, so activating a real backend
// is purely a matter of setting env vars — no application code changes.
//
// Authorization note: this adapter runs "as admin" on purpose. It is only ever
// called from server actions / the engine, which already applied Layer 1 (org
// scoping) and Layer 2 (capability + approval) ABOVE this seam. In the deployed
// nhost project, the SAME guarantees are enforced twice more, independently:
//   - Hasura row-level permissions on the `user` role (see nhost/metadata)
//   - the Action handler functions (see nhost/functions)
// so a direct GraphQL call from a browser with a user JWT still cannot cross
// org boundaries.
//
// Column mapping: Postgres is snake_case, the domain types are camelCase, and
// `order` is a reserved word so the column is `step_order`. All translation is
// contained in the row-mapping helpers below.
// ---------------------------------------------------------------------------

interface NhostConfig {
  graphqlUrl: string
  adminSecret: string
}

export function createNhostDataLayer(config: NhostConfig): DataLayer {
  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(config.graphqlUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hasura-admin-secret": config.adminSecret,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    })
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
    if (json.errors?.length) {
      throw new Error(`Hasura error: ${json.errors.map((e) => e.message).join("; ")}`)
    }
    return json.data as T
  }

  // --- row mappers ----------------------------------------------------------
  const mapUser = (r: any): User => ({ id: r.id, email: r.email, name: r.name })
  const mapOrg = (r: any): Organization => ({
    id: r.id,
    name: r.name,
    quotaAllowed: r.quota_allowed,
    quotaUsed: r.quota_used,
    period: r.period,
  })
  const mapMember = (r: any): OrgMember => ({ userId: r.user_id, orgId: r.org_id, role: r.role as Role })
  const mapWorkflow = (r: any): Workflow => ({
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    createdBy: r.created_by,
    createdAt: r.created_at,
  })
  const mapStep = (r: any): WorkflowStep => ({
    id: r.id,
    workflowId: r.workflow_id,
    order: r.step_order,
    type: r.type as StepType,
    name: r.name,
    config: r.config ?? {},
  })
  const mapTrigger = (r: any): WorkflowTrigger => ({
    id: r.id,
    workflowId: r.workflow_id,
    type: r.type as TriggerType,
    config: r.config ?? {},
    token: r.token ?? undefined,
    lastFiredAt: r.last_fired_at ?? undefined,
  })
  const mapRun = (r: any): WorkflowRun => ({
    id: r.id,
    workflowId: r.workflow_id,
    orgId: r.org_id,
    status: r.status,
    triggeredBy: r.triggered_by,
    triggerType: r.trigger_type as TriggerType,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    error: r.error ?? undefined,
  })
  const mapStepRun = (r: any): StepRun => ({
    id: r.id,
    runId: r.run_id,
    stepId: r.step_id,
    order: r.step_order,
    type: r.type as StepType,
    name: r.name,
    status: r.status as StepRunStatus,
    input: r.input ?? undefined,
    output: r.output ?? undefined,
    error: r.error ?? undefined,
    attempt: r.attempt,
    approvedBy: r.approved_by ?? undefined,
    approvedAt: r.approved_at ?? undefined,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
  })

  return {
    // --- users / auth -------------------------------------------------------
    async getUser(id) {
      const d = await gql<{ users_by_pk: any }>(
        `query ($id: String!) { users_by_pk(id: $id) { id email name } }`,
        { id },
      )
      return d.users_by_pk ? mapUser(d.users_by_pk) : undefined
    },
    async listLoginUsers(): Promise<LoginUser[]> {
      const d = await gql<{ org_members: any[] }>(
        `query { org_members { role user { id name email } organization { name } } }`,
      )
      return d.org_members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        org: m.organization.name,
        role: m.role as Role,
      }))
    },

    // --- orgs / membership --------------------------------------------------
    async getOrg(id) {
      const d = await gql<{ organizations_by_pk: any }>(
        `query ($id: String!) { organizations_by_pk(id: $id) { id name quota_allowed quota_used period } }`,
        { id },
      )
      return d.organizations_by_pk ? mapOrg(d.organizations_by_pk) : undefined
    },
    async getMembership(userId, orgId) {
      const d = await gql<{ org_members: any[] }>(
        `query ($u: String!, $o: String!) {
           org_members(where: {user_id: {_eq: $u}, org_id: {_eq: $o}}, limit: 1) { user_id org_id role }
         }`,
        { u: userId, o: orgId },
      )
      return d.org_members[0] ? mapMember(d.org_members[0]) : undefined
    },
    async getPrimaryMembership(userId) {
      const d = await gql<{ org_members: any[] }>(
        `query ($u: String!) { org_members(where: {user_id: {_eq: $u}}, limit: 1) { user_id org_id role } }`,
        { u: userId },
      )
      return d.org_members[0] ? mapMember(d.org_members[0]) : undefined
    },
    async roleInOrg(userId, orgId) {
      const m = await this.getMembership(userId, orgId)
      return m?.role
    },
    async listMembers(orgId) {
      const d = await gql<{ org_members: any[] }>(
        `query ($o: String!) {
           org_members(where: {org_id: {_eq: $o}}) { user_id org_id role user { id email name } }
         }`,
        { o: orgId },
      )
      return d.org_members.map((m) => ({ ...mapMember(m), user: mapUser(m.user) }))
    },

    // --- workflows ----------------------------------------------------------
    async getWorkflow(id) {
      const d = await gql<{ workflows_by_pk: any }>(
        `query ($id: String!) { workflows_by_pk(id: $id) { id org_id name created_by created_at } }`,
        { id },
      )
      return d.workflows_by_pk ? mapWorkflow(d.workflows_by_pk) : undefined
    },
    async listWorkflowsByOrg(orgId) {
      const d = await gql<{ workflows: any[] }>(
        `query ($o: String!) {
           workflows(where: {org_id: {_eq: $o}}, order_by: {created_at: asc}) {
             id org_id name created_by created_at
           }
         }`,
        { o: orgId },
      )
      return d.workflows.map(mapWorkflow)
    },
    async createWorkflow(input) {
      const d = await gql<{ insert_workflows_one: any }>(
        `mutation ($o: String!, $n: String!, $c: String!) {
           insert_workflows_one(object: {org_id: $o, name: $n, created_by: $c}) {
             id org_id name created_by created_at
           }
         }`,
        { o: input.orgId, n: input.name, c: input.createdBy },
      )
      return mapWorkflow(d.insert_workflows_one)
    },
    async renameWorkflow(workflowId, name) {
      await gql(
        `mutation ($id: String!, $n: String!) {
           update_workflows_by_pk(pk_columns: {id: $id}, _set: {name: $n}) { id }
         }`,
        { id: workflowId, n: name },
      )
    },

    // --- steps / triggers ---------------------------------------------------
    async getSteps(workflowId) {
      const d = await gql<{ workflow_steps: any[] }>(
        `query ($w: String!) {
           workflow_steps(where: {workflow_id: {_eq: $w}}, order_by: {step_order: asc}) {
             id workflow_id step_order type name config
           }
         }`,
        { w: workflowId },
      )
      return d.workflow_steps.map(mapStep)
    },
    async getTriggers(workflowId) {
      const d = await gql<{ workflow_triggers: any[] }>(
        `query ($w: String!) {
           workflow_triggers(where: {workflow_id: {_eq: $w}}) { id workflow_id type config token last_fired_at }
         }`,
        { w: workflowId },
      )
      return d.workflow_triggers.map(mapTrigger)
    },
    async getTriggerByToken(token) {
      const d = await gql<{ workflow_triggers: any[] }>(
        `query ($t: String!) {
           workflow_triggers(where: {type: {_eq: "webhook"}, token: {_eq: $t}}, limit: 1) {
             id workflow_id type config token last_fired_at
           }
         }`,
        { t: token },
      )
      return d.workflow_triggers[0] ? mapTrigger(d.workflow_triggers[0]) : undefined
    },
    async listTriggersByType(type) {
      const d = await gql<{ workflow_triggers: any[] }>(
        `query ($t: String!) {
           workflow_triggers(where: {type: {_eq: $t}}) { id workflow_id type config token last_fired_at }
         }`,
        { t: type },
      )
      return d.workflow_triggers.map(mapTrigger)
    },
    async updateTrigger(id, patch) {
      const set: Record<string, unknown> = {}
      if (patch.config !== undefined) set.config = patch.config
      if (patch.lastFiredAt !== undefined) set.last_fired_at = patch.lastFiredAt
      await gql(
        `mutation ($id: String!, $set: workflow_triggers_set_input!) {
           update_workflow_triggers_by_pk(pk_columns: {id: $id}, _set: $set) { id }
         }`,
        { id, set },
      )
    },
    async replaceSteps(workflowId, steps) {
      // Delete + re-insert atomically in one request.
      const objects = steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s, i) => ({
          workflow_id: workflowId,
          step_order: i,
          type: s.type,
          name: s.name,
          config: s.config,
        }))
      await gql(
        `mutation ($w: String!, $objects: [workflow_steps_insert_input!]!) {
           delete_workflow_steps(where: {workflow_id: {_eq: $w}}) { affected_rows }
           insert_workflow_steps(objects: $objects) { affected_rows }
         }`,
        { w: workflowId, objects },
      )
    },
    async replaceTriggers(workflowId, triggers) {
      const objects = triggers.map((t) => ({
        workflow_id: workflowId,
        type: t.type,
        config: t.config,
        token: t.type === "webhook" ? (t.token ?? cryptoToken()) : null,
      }))
      await gql(
        `mutation ($w: String!, $objects: [workflow_triggers_insert_input!]!) {
           delete_workflow_triggers(where: {workflow_id: {_eq: $w}}) { affected_rows }
           insert_workflow_triggers(objects: $objects) { affected_rows }
         }`,
        { w: workflowId, objects },
      )
    },

    // --- runs / step runs ---------------------------------------------------
    async getRun(id) {
      const d = await gql<{ workflow_runs_by_pk: any }>(
        `query ($id: String!) {
           workflow_runs_by_pk(id: $id) {
             id workflow_id org_id status triggered_by trigger_type started_at finished_at error
           }
         }`,
        { id },
      )
      return d.workflow_runs_by_pk ? mapRun(d.workflow_runs_by_pk) : undefined
    },
    async getLatestRun(workflowId) {
      const d = await gql<{ workflow_runs: any[] }>(
        `query ($w: String!) {
           workflow_runs(where: {workflow_id: {_eq: $w}}, order_by: {started_at: desc}, limit: 1) {
             id workflow_id org_id status triggered_by trigger_type started_at finished_at error
           }
         }`,
        { w: workflowId },
      )
      return d.workflow_runs[0] ? mapRun(d.workflow_runs[0]) : undefined
    },
    async listRuns(workflowId) {
      const d = await gql<{ workflow_runs: any[] }>(
        `query ($w: String!) {
           workflow_runs(where: {workflow_id: {_eq: $w}}, order_by: {started_at: desc}) {
             id workflow_id org_id status triggered_by trigger_type started_at finished_at error
           }
         }`,
        { w: workflowId },
      )
      return d.workflow_runs.map(mapRun)
    },
    async createRun(input) {
      const d = await gql<{ insert_workflow_runs_one: any }>(
        `mutation ($w: String!, $o: String!, $by: String!, $tt: String!) {
           insert_workflow_runs_one(object: {
             workflow_id: $w, org_id: $o, status: "pending", triggered_by: $by, trigger_type: $tt
           }) { id workflow_id org_id status triggered_by trigger_type started_at finished_at error }
         }`,
        { w: input.workflowId, o: input.orgId, by: input.triggeredBy, tt: input.triggerType },
      )
      return mapRun(d.insert_workflow_runs_one)
    },
    async updateRun(id, patch) {
      await gql(
        `mutation ($id: String!, $set: workflow_runs_set_input!) {
           update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
         }`,
        { id, set: runPatchToColumns(patch) },
      )
    },
    async getStepRun(id) {
      const d = await gql<{ step_runs_by_pk: any }>(
        `query ($id: String!) {
           step_runs_by_pk(id: $id) {
             id run_id step_id step_order type name status input output error attempt
             approved_by approved_at started_at finished_at
           }
         }`,
        { id },
      )
      return d.step_runs_by_pk ? mapStepRun(d.step_runs_by_pk) : undefined
    },
    async getStepRuns(runId) {
      const d = await gql<{ step_runs: any[] }>(
        `query ($r: String!) {
           step_runs(where: {run_id: {_eq: $r}}, order_by: {step_order: asc}) {
             id run_id step_id step_order type name status input output error attempt
             approved_by approved_at started_at finished_at
           }
         }`,
        { r: runId },
      )
      return d.step_runs.map(mapStepRun)
    },
    async createStepRun(input) {
      const d = await gql<{ insert_step_runs_one: any }>(
        `mutation ($obj: step_runs_insert_input!) {
           insert_step_runs_one(object: $obj) {
             id run_id step_id step_order type name status input output error attempt
             approved_by approved_at started_at finished_at
           }
         }`,
        {
          obj: {
            run_id: input.runId,
            step_id: input.stepId,
            step_order: input.order,
            type: input.type,
            name: input.name,
            status: input.status,
            attempt: input.attempt,
          },
        },
      )
      return mapStepRun(d.insert_step_runs_one)
    },
    async updateStepRun(id, patch) {
      await gql(
        `mutation ($id: String!, $set: step_runs_set_input!) {
           update_step_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
         }`,
        { id, set: stepRunPatchToColumns(patch) },
      )
    },

    // --- quota / artifacts --------------------------------------------------
    async incrementQuota(orgId, by = 1) {
      await gql(
        `mutation ($id: String!, $by: Int!) {
           update_organizations_by_pk(pk_columns: {id: $id}, _inc: {quota_used: $by}) { id }
         }`,
        { id: orgId, by },
      )
    },
    async writeArtifact(input): Promise<ArtifactRecord> {
      const d = await gql<{ insert_artifacts_one: any }>(
        `mutation ($obj: artifacts_insert_input!) {
           insert_artifacts_one(object: $obj) { id org_id run_id step_id value created_at }
         }`,
        {
          obj: {
            org_id: input.orgId,
            run_id: input.runId,
            step_id: input.stepId,
            value: input.value,
          },
        },
      )
      const r = d.insert_artifacts_one
      return { id: r.id, orgId: r.org_id, runId: r.run_id, stepId: r.step_id, value: r.value, createdAt: r.created_at }
    },

    // --- aggregation --------------------------------------------------------
    async getUsageStats(orgId) {
      // Reads the tracked SQL view org_usage_stats (see nhost/migrations).
      const d = await gql<{ org_usage_stats: any[] }>(
        `query ($o: String!) {
           org_usage_stats(where: {org_id: {_eq: $o}}, limit: 1) {
             period total_runs completed_runs failed_runs paused_runs avg_duration_ms
           }
         }`,
        { o: orgId },
      )
      const row = d.org_usage_stats[0]
      if (!row) {
        return { period: "", totalRuns: 0, completedRuns: 0, failedRuns: 0, pausedRuns: 0, avgDurationMs: null }
      }
      return {
        period: row.period,
        totalRuns: row.total_runs,
        completedRuns: row.completed_runs,
        failedRuns: row.failed_runs,
        pausedRuns: row.paused_runs,
        avgDurationMs: row.avg_duration_ms ?? null,
      }
    },
  }
}

// snake_case column translation for partial updates ---------------------------

function runPatchToColumns(patch: Partial<WorkflowRun>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.status !== undefined) out.status = patch.status
  if (patch.finishedAt !== undefined) out.finished_at = patch.finishedAt
  if (patch.error !== undefined) out.error = patch.error
  return out
}

function stepRunPatchToColumns(patch: Partial<StepRun>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.status !== undefined) out.status = patch.status
  if (patch.input !== undefined) out.input = patch.input
  if (patch.output !== undefined) out.output = patch.output
  if (patch.error !== undefined) out.error = patch.error
  if (patch.attempt !== undefined) out.attempt = patch.attempt
  if (patch.approvedBy !== undefined) out.approved_by = patch.approvedBy
  if (patch.approvedAt !== undefined) out.approved_at = patch.approvedAt
  if (patch.startedAt !== undefined) out.started_at = patch.startedAt
  if (patch.finishedAt !== undefined) out.finished_at = patch.finishedAt
  return out
}

function cryptoToken(): string {
  return `tok_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
}
