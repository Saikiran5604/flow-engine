import { NextResponse } from "next/server"
import { getRunState } from "@/lib/actions"

// Polling endpoint backing the live "subscription" on step_runs. In a Hasura
// deployment this would be a GraphQL subscription over websockets filtered by
// workflow_run_id; here SWR polls this org-scoped route. Cross-org run ids
// resolve to 404 so a Globex user cannot observe an Acme run by guessing.
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params
  const state = await getRunState(runId)

  if ("error" in state) {
    const status = state.error === "unauthenticated" ? 401 : 404
    return NextResponse.json({ error: state.error }, { status })
  }

  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  })
}
