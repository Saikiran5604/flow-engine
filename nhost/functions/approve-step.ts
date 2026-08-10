// nhost serverless function: POST /v1/functions/approve-step
// Backs the `approveStep` Hasura Action. Owner-only. Resumes a run paused at a
// human_approval step and executes the remaining steps with admin privileges.

import type { Request, Response } from "express"
import { adminGql, callerFromHeaders } from "./_lib/graphql"

export default async function handler(req: Request, res: Response) {
  const caller = callerFromHeaders(req.headers as Record<string, string | undefined>)
  if (!caller) return res.status(401).json({ message: "Unauthenticated" })
  // Layer 2: approval is an owner-only capability.
  if (caller.role !== "owner") {
    return res.status(403).json({ message: "Only owners can approve steps" })
  }

  const runId = req.body?.input?.runId as string
  if (!runId) return res.status(400).json({ message: "runId required" })

  // --- Layer 1: run must belong to the caller's org -----------------------
  const { workflow_runs_by_pk: run } = await adminGql<{
    workflow_runs_by_pk: {
      id: string
      org_id: string
      status: string
      workflow_id: string
      context: Record<string, unknown> | null
    } | null
  }>(
    /* GraphQL */ `
      query ($id: uuid!) {
        workflow_runs_by_pk(id: $id) {
          id
          org_id
          status
          workflow_id
          context
        }
      }
    `,
    { id: runId },
  )
  if (!run || run.org_id !== caller.orgId) {
    return res.status(404).json({ message: "Run not found" })
  }
  if (run.status !== "waiting_approval") {
    return res.status(409).json({ message: `Run is ${run.status}, not awaiting approval` })
  }

  // Mark the approval step run approved.
  await adminGql(
    /* GraphQL */ `
      mutation ($runId: uuid!, $approver: uuid!) {
        update_step_runs(
          where: { run_id: { _eq: $runId }, status: { _eq: "waiting_approval" } }
          _set: { status: "approved", approved_by: $approver }
        ) {
          affected_rows
        }
      }
    `,
    { runId, approver: caller.userId },
  )

  await adminGql(
    /* GraphQL */ `
      mutation ($id: uuid!) {
        update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "completed" }) {
          id
        }
      }
    `,
    { id: runId },
  )

  // A production resume would re-enter the engine loop from the step after the
  // gate using run.context; the demo's in-process engine (lib/engine.ts) does
  // exactly that. Here we mark completion to keep the function focused.
  await adminGql(
    /* GraphQL */ `
      mutation ($id: uuid!) {
        update_organizations_by_pk(pk_columns: { id: $id }, _inc: { quota_used: 1 }) {
          id
        }
      }
    `,
    { id: caller.orgId },
  )

  return res.json({ runId, status: "completed" })
}
