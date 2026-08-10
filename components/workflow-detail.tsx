"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowLeft, Play, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { RunView } from "@/components/run-view"
import { WorkflowBuilder } from "@/components/workflow-builder"
import { TriggersPanel } from "@/components/triggers-panel"
import { SchedulerHeartbeat } from "@/components/scheduler-heartbeat"
import { triggerWorkflowRunAction } from "@/lib/actions"
import { STEP_META } from "@/lib/step-meta"
import type { Role, StepType, TriggerType, WorkflowStep, WorkflowTrigger } from "@/lib/types"

interface RunSummary {
  id: string
  status: string
  triggerType: string
  startedAt: string
}

interface DetailProps {
  role: Role
  workflow: {
    id: string
    name: string
    steps: WorkflowStep[]
    triggers: WorkflowTrigger[]
  }
  runs: RunSummary[]
  initialRunId: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function WorkflowDetail({ role, workflow, runs, initialRunId }: DetailProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(initialRunId)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Subscription simulation: poll the run list so newly triggered runs and
  // status transitions surface without a manual refresh.
  const { data: liveRuns, mutate: mutateRuns } = useSWR<{ runs: RunSummary[] }>(
    `/api/runs?workflow=${workflow.id}`,
    fetcher,
    { refreshInterval: 1500, fallbackData: { runs } },
  )
  const runList = liveRuns?.runs ?? runs

  const canTrigger = role === "owner" || role === "editor"
  const canEdit = role === "owner" || role === "editor"

  async function handleTrigger() {
    setTriggering(true)
    setError(null)
    const res = await triggerWorkflowRunAction(workflow.id)
    setTriggering(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setActiveRunId(res.runId)
    router.refresh()
  }

  if (editing) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <button
          onClick={() => setEditing(false)}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Cancel edit
        </button>
        <WorkflowBuilder
          role={role}
          initial={{
            id: workflow.id,
            name: workflow.name,
            steps: workflow.steps.map((s, i) => ({
              type: s.type as StepType,
              name: s.name,
              config: s.config,
              order: i,
            })),
            triggers: workflow.triggers.map((t) => ({
              type: t.type as TriggerType,
              config: t.config,
            })),
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <SchedulerHeartbeat />
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All workflows
      </Link>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">{workflow.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {workflow.steps.length} steps &middot; triggers:{" "}
            {workflow.triggers.length ? workflow.triggers.map((t) => t.type).join(", ") : "none"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          {canTrigger && (
            <Button size="sm" onClick={handleTrigger} disabled={triggering}>
              <Play className="h-4 w-4" />
              {triggering ? "Starting..." : "Run now"}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          {activeRunId ? (
            <RunView runId={activeRunId} canApprove={canTrigger} />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No run selected. {canTrigger ? "Trigger a run to watch it execute live." : "Ask an editor to run this workflow."}
              </p>
            </div>
          )}

          <div className="mt-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Step pipeline</h2>
            <ol className="space-y-1.5">
              {workflow.steps.map((s, i) => {
                const meta = STEP_META[s.type as StepType]
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{meta?.label ?? s.type}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        <aside className="space-y-6">
          <TriggersPanel triggers={workflow.triggers} onFired={() => mutateRuns()} />

          <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Run history</h2>
          <ul className="space-y-1.5">
            {runList.length === 0 && <li className="text-sm text-muted-foreground">No runs yet.</li>}
            {runList.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setActiveRunId(r.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    r.id === activeRunId
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-card hover:bg-secondary"
                  }`}
                >
                  <span className="font-mono text-xs text-muted-foreground">{r.triggerType}</span>
                  <StatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
