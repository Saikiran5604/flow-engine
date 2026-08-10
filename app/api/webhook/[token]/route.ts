import { NextResponse } from "next/server"
import { getDataLayer } from "@/lib/data"
import { startRun } from "@/lib/engine"

// ---------------------------------------------------------------------------
// Inbound webhook trigger. Stands in for a Hasura Action used as a webhook
// endpoint: an external system POSTs here with a per-trigger token to start a
// run WITHOUT anyone clicking Run. Authorization is by possession of the token
// (the webhook secret) rather than an interactive session; the engine still
// enforces the org quota.
// ---------------------------------------------------------------------------

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const dl = await getDataLayer()
  const trigger = await dl.getTriggerByToken(token)
  if (!trigger) {
    return NextResponse.json({ ok: false, error: "Invalid webhook token" }, { status: 404 })
  }

  const wf = await dl.getWorkflow(trigger.workflowId)
  if (!wf) {
    return NextResponse.json({ ok: false, error: "Workflow not found" }, { status: 404 })
  }

  const result = await startRun({
    workflowId: wf.id,
    triggeredBy: "webhook",
    triggerType: "webhook",
  })

  if (!result.ok) {
    const status = result.code === "quota" ? 429 : 400
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }

  return NextResponse.json({ ok: true, runId: result.runId, workflowId: wf.id })
}

// Allow a browser GET for easy demoing of the webhook trigger from the UI.
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return POST(req, ctx)
}
