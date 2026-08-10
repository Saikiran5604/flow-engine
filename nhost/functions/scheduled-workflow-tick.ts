import type { Request, Response } from "express"
import { gql } from "./_lib/graphql"

/**
 * Hasura cron handler. Configure a cron trigger at the Nhost level to POST
 * here every minute. It claims due scheduled triggers and starts runs with a
 * server-side service identity; per-org workflow ownership is resolved by the
 * query, not by request input.
 */
export async function handler(req: Request, res: Response) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" })

  const now = new Date()
  const { workflow_triggers: triggers } = await gql<{ workflow_triggers: Array<{
    id: string
    workflow_id: string
    config: Record<string, unknown>
    last_fired_at: string | null
    workflow: { id: string; org_id: string; enabled: boolean }
  }> }>(
    `query DueScheduledTriggers {
       workflow_triggers(
         where: {
           type: {_eq: "scheduled"}
           workflow: {enabled: {_eq: true}}
         }
       ) {
         id workflow_id config last_fired_at
         workflow { id org_id enabled }
       }
     }`,
    {},
  )

  const fired: string[] = []
  for (const trigger of triggers) {
    const everySeconds = Math.max(15, Number(trigger.config.everySeconds ?? 60))
    const last = trigger.last_fired_at ? new Date(trigger.last_fired_at).getTime() : 0
    if (now.getTime() - last < everySeconds * 1000) continue

    // Mark before dispatch for idempotency. A retry-safe production version can
    // use a Postgres advisory lock around this update.
    await gql(
      `mutation MarkScheduledTrigger($id: String!, $at: timestamptz!) {
         update_workflow_triggers_by_pk(pk_columns: {id: $id}, _set: {last_fired_at: $at}) { id }
       }`,
      { id: trigger.id, at: now.toISOString() },
    )
    await gql(
      `mutation StartScheduledRun($input: TriggerWorkflowRunInput!) {
         triggerWorkflowRun(input: $input) { runId status }
       }`,
      { input: { workflowId: trigger.workflow_id, triggerType: "scheduled", triggeredBy: "system:scheduler" } },
    )
    fired.push(trigger.workflow_id)
  }

  return res.json({ ok: true, fired, checkedAt: now.toISOString() })
}
