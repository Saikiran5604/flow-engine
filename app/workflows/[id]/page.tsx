import { notFound, redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { getQuota, getWorkflowDetail } from "@/lib/actions"
import { getDataLayer } from "@/lib/data"
import { TopBar } from "@/components/top-bar"
import { WorkflowDetail } from "@/components/workflow-detail"

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect("/login")

  const [detail, quota] = await Promise.all([getWorkflowDetail(id), getQuota()])
  // Layer 1: a workflow in another org is indistinguishable from not-found.
  if ("error" in detail) notFound()

  const { workflow } = detail

  // Layer 1 already enforced by getWorkflowDetail above. Only select a run
  // that still exists in the current data layer; this avoids rendering a stale
  // paused run after a demo restart, which otherwise causes "Step not found"
  // when its old step-run id is submitted for approval.
  const dl = await getDataLayer()
  const runs = (await dl.listRuns(workflow.id)).map((r) => ({
    id: r.id,
    status: r.status,
    triggerType: r.triggerType,
    startedAt: r.startedAt,
  }))
  const latestRunId = workflow.latestRunId && runs.some((r) => r.id === workflow.latestRunId)
    ? workflow.latestRunId
    : null

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        orgName={session.orgName}
        userName={session.user.name}
        role={session.role}
        quota={quota ?? { used: 0, allowed: 0, period: "" }}
      />
      <WorkflowDetail
        role={session.role}
        workflow={{
          id: workflow.id,
          name: workflow.name,
          steps: workflow.steps,
          triggers: workflow.triggers,
        }}
        runs={runs}
        initialRunId={latestRunId}
      />
    </div>
  )
}
