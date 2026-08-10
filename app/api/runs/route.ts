import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { raw } from "@/lib/store"

// Org-scoped run list for a workflow. Used by the detail page to poll for new
// runs and status changes (subscription simulation).
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ runs: [] }, { status: 401 })

  const workflowId = req.nextUrl.searchParams.get("workflow")
  if (!workflowId) return NextResponse.json({ runs: [] })

  const wf = raw.workflow(workflowId)
  // Layer 1: cross-org lookups return nothing.
  if (!wf || wf.orgId !== session.orgId) return NextResponse.json({ runs: [] })

  const runs = raw
    .db()
    .runs.filter((r) => r.workflowId === workflowId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .map((r) => ({
      id: r.id,
      status: r.status,
      triggerType: r.triggerType,
      startedAt: r.startedAt,
    }))

  return NextResponse.json({ runs })
}
