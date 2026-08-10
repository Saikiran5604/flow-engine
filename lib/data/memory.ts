import {
  createRun,
  createStepRun,
  createWorkflow,
  incrementQuota,
  membersOf,
  membership,
  raw,
  renameWorkflow,
  replaceSteps,
  replaceTriggers,
  roleInOrg,
  updateRun,
  updateStepRun,
  writeArtifact,
} from "../store"
import type { DataLayer } from "./adapter"

// ---------------------------------------------------------------------------
// In-memory DataLayer. Thin async wrappers over the existing globalThis store
// (lib/store.ts). This is what powers the live v0 demo and keeps behaviour
// identical to the pre-adapter version — every call resolves synchronously.
// ---------------------------------------------------------------------------

export const memoryDataLayer: DataLayer = {
  async getUser(id) {
    return raw.user(id)
  },
  async listLoginUsers() {
    const db = raw.db()
    return db.orgMembers.map((m) => {
      const u = raw.user(m.userId)!
      const o = raw.org(m.orgId)!
      return { id: u.id, name: u.name, email: u.email, org: o.name, role: m.role }
    })
  },

  async getOrg(id) {
    return raw.org(id)
  },
  async getMembership(userId, orgId) {
    return membership(userId, orgId)
  },
  async getPrimaryMembership(userId) {
    return raw.db().orgMembers.find((m) => m.userId === userId)
  },
  async roleInOrg(userId, orgId) {
    return roleInOrg(userId, orgId)
  },
  async listMembers(orgId) {
    return membersOf(orgId)
  },

  async getWorkflow(id) {
    return raw.workflow(id)
  },
  async listWorkflowsByOrg(orgId) {
    return raw.db().workflows.filter((w) => w.orgId === orgId)
  },
  async createWorkflow(input) {
    return createWorkflow(input)
  },
  async renameWorkflow(workflowId, name) {
    renameWorkflow(workflowId, name)
  },

  async getSteps(workflowId) {
    return raw.stepsFor(workflowId)
  },
  async getTriggers(workflowId) {
    return raw.triggersFor(workflowId)
  },
  async getTriggerByToken(token) {
    return raw.triggerByToken(token)
  },
  async replaceSteps(workflowId, steps) {
    replaceSteps(workflowId, steps)
  },
  async replaceTriggers(workflowId, triggers) {
    replaceTriggers(workflowId, triggers)
  },

  async getRun(id) {
    return raw.run(id)
  },
  async getLatestRun(workflowId) {
    return raw.latestRunFor(workflowId)
  },
  async listRuns(workflowId) {
    return raw
      .db()
      .runs.filter((r) => r.workflowId === workflowId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  },
  async createRun(input) {
    return createRun(input)
  },
  async updateRun(id, patch) {
    updateRun(id, patch)
  },

  async getStepRun(id) {
    return raw.stepRun(id)
  },
  async getStepRuns(runId) {
    return raw.stepRunsFor(runId)
  },
  async createStepRun(input) {
    return createStepRun(input)
  },
  async updateStepRun(id, patch) {
    updateStepRun(id, patch)
  },

  async incrementQuota(orgId, by = 1) {
    incrementQuota(orgId, by)
  },
  async writeArtifact(input) {
    return writeArtifact(input)
  },
}
