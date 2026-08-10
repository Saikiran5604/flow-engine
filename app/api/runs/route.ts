import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getDataLayer } from "@/lib/data"

// Org-scoped run list for a workflow. Used by the detail page to poll for new
// runs and status changes (subscription simulation).
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ runs: [] }, { status: 401 })

  const workflowId = req.nextUrl.searchParams.get("workflow")
  if (!workflowId) return NextResponse.json({ runs: [] })

  const dl = await getDataLayer()
  const wf = await dl.getWorkflow(workflowId)
  // Layer 1: cross-org lookups return nothing.
  if (!wf || wf.orgId !== session.orgId) return NextResponse.json({ runs: [] })

  const runs = (await dl.listRuns(workflowId))
    .map((r) => ({
      id: r.id,
      status: r.status,
      triggerType: r.triggerType,
      startedAt: r.startedAt,
    }))

  return NextResponse.json({ runs })
}
