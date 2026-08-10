import { NextResponse } from "next/server"
import { getDataLayer } from "@/lib/data"
import { startRun } from "@/lib/engine"

// ---------------------------------------------------------------------------
// Scheduler tick. Finds scheduled triggers that are due and starts a run for
// each, recording last_fired_at so it won't re-fire until the interval elapses.
//
// In the live demo this is driven by an in-app heartbeat (components/
// scheduler-heartbeat.tsx) so scheduled runs appear automatically while you
// watch. In the deployed nhost project the SAME work is driven by a Hasura
// cron trigger hitting nhost/functions/scheduled-tick.ts — this route is the
// local equivalent of that serverless handler.
//
// It intentionally runs without a user session: scheduled execution is a system
// actor, exactly like the webhook endpoint.
// ---------------------------------------------------------------------------

export async function POST() {
  const dl = await getDataLayer()
  const triggers = await dl.listTriggersByType("scheduled")
  const now = Date.now()
  const fired: string[] = []

  for (const t of triggers) {
    if (t.config?.enabled === false) continue
    const everySeconds = Number(t.config?.everySeconds ?? 90)
    const last = t.lastFiredAt ? new Date(t.lastFiredAt).getTime() : 0
    if (now - last < everySeconds * 1000) continue

    const wf = await dl.getWorkflow(t.workflowId)
    if (!wf) continue

    // Mark fired first so a slow run can't cause a double-fire on the next tick.
    await dl.updateTrigger(t.id, { lastFiredAt: new Date(now).toISOString() })

    const res = await startRun({
      workflowId: t.workflowId,
      triggeredBy: "scheduler",
      triggerType: "scheduled",
    })
    if (res.ok) fired.push(res.runId)
  }

  return NextResponse.json({ ok: true, fired })
}
