"use client"

import { Check, ChevronDown, ChevronRight } from "lucide-react"
import { useState, useTransition } from "react"
import useSWR from "swr"
import { approveStepAction } from "@/lib/actions"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { STEP_META } from "@/lib/step-meta"
import type { RunStatus, StepRun, StepRunStatus, StepType } from "@/lib/types"
import { cn } from "@/lib/utils"

interface RunPayload {
  run: {
    id: string
    status: RunStatus
    triggerType: string
    triggeredBy: string
    startedAt: string
    finishedAt?: string
    error?: string
  }
  steps: StepRun[]
  canApprove: boolean
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })

const ACTIVE_STATES: RunStatus[] = ["pending", "running", "paused"]

export function RunView({ runId, canApprove }: { runId: string; canApprove: boolean }) {
  // Poll the org-scoped run endpoint. This simulates a GraphQL subscription on
  // step_runs filtered by workflow_run_id; it stops polling once the run is
  // terminal to avoid needless requests.
  const { data, mutate } = useSWR<RunPayload>(`/api/runs/${runId}`, fetcher, {
    refreshInterval: (latest) => (latest && !ACTIVE_STATES.includes(latest.run.status) ? 0 : 700),
    revalidateOnFocus: false,
  })

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Connecting to live run…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={data.run.status} />
          <span className="font-mono text-xs text-muted-foreground">
            via {data.run.triggerType} · by {data.run.triggeredBy}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">run {runId.slice(0, 12)}</span>
      </div>

      {data.run.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {data.run.error}
        </div>
      )}

      <ol className="space-y-2">
        {data.steps.map((s, i) => (
          <StepRunRow
            key={s.id}
            step={s}
            index={i}
            canApprove={canApprove}
            onApproved={mutate}
          />
        ))}
      </ol>
    </div>
  )
}

function StepRunRow({
  step,
  index,
  canApprove,
  onApproved,
}: {
  step: StepRun
  index: number
  canApprove: boolean
  onApproved: () => Promise<RunPayload | undefined>
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const meta = STEP_META[step.type as StepType]

  function approve() {
    setError(null)
    startTransition(async () => {
      const res = await approveStepAction(step.id)
      if (!res.ok) {
        setError(res.error)
        await onApproved()
        return
      }
      await onApproved()
    })
  }

  const hasDetail = step.output != null || step.input != null || step.error

  return (
    <li
      className={cn(
        "rounded-xl border bg-card transition-colors",
        step.status === "running" && "border-primary/50",
        step.status === "paused" && "border-warning/50",
        step.status === "failed" && "border-destructive/40",
        !["running", "paused", "failed"].includes(step.status) && "border-border",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
          {index + 1}
        </span>
        <span className={cn("shrink-0 font-mono text-[0.7rem] font-semibold", meta.accent)}>
          {meta.short}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{step.name}</div>
          {step.attempt > 1 && (
            <div className="font-mono text-[0.7rem] text-warning">retried · attempt {step.attempt}</div>
          )}
          {step.approvedBy && (
            <div className="font-mono text-[0.7rem] text-success">approved by {step.approvedBy}</div>
          )}
        </div>

        <StatusBadge status={step.status} />

        {hasDetail && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Toggle details"
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        )}
      </div>

      {step.status === "paused" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm text-warning">
            Run paused — awaiting approval from an owner or editor.
          </p>
          {canApprove ? (
            <Button size="sm" onClick={approve} disabled={pending}>
              <Check className="size-3.5" />
              {pending ? "Approving…" : "Approve & resume"}
            </Button>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              your role cannot approve
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {open && hasDetail && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {step.input != null && (
            <Detail label="input" value={step.input} />
          )}
          {step.output != null && <Detail label="output" value={step.output} />}
          {step.error && <Detail label="error" value={step.error} />}
        </div>
      )}
    </li>
  )
}

function Detail({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return (
    <div>
      <div className="mb-1 font-mono text-[0.7rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground">
        {text}
      </pre>
    </div>
  )
}
