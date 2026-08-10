import Link from "next/link"
import { StatusBadge } from "@/components/status-badge"
import type { WorkflowSummary } from "@/lib/actions"
import { TRIGGER_META } from "@/lib/step-meta"

export function WorkflowList({ workflows }: { workflows: WorkflowSummary[] }) {
  if (workflows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
        <p className="text-sm text-muted-foreground">No workflows yet in this organization.</p>
        <Link
          href="/workflows/new"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Build your first workflow →
        </Link>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {workflows.map((w) => (
        <Link
          key={w.id}
          href={`/workflows/${w.id}`}
          className="group flex flex-col justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-medium">{w.name}</h3>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {w.stepCount} step{w.stepCount === 1 ? "" : "s"}
              </p>
            </div>
            {w.latestRunStatus ? (
              <StatusBadge status={w.latestRunStatus} />
            ) : (
              <span className="font-mono text-xs text-muted-foreground">never run</span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {w.triggerTypes.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground"
              >
                {TRIGGER_META[t].label}
              </span>
            ))}
          </div>
        </Link>
      ))}
    </div>
  )
}
