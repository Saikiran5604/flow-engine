import type { UsageStats } from "@/lib/types"

function formatDuration(ms: number | null): string {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function UsageCard({ stats }: { stats: UsageStats }) {
  const rows: Array<{ label: string; value: string; tone?: "success" | "warning" | "destructive" }> = [
    { label: "Total runs", value: String(stats.totalRuns) },
    { label: "Completed", value: String(stats.completedRuns), tone: "success" },
    { label: "Paused", value: String(stats.pausedRuns), tone: "warning" },
    { label: "Failed", value: String(stats.failedRuns), tone: "destructive" },
    { label: "Avg duration", value: formatDuration(stats.avgDurationMs) },
  ]

  const toneClass = (tone?: string) =>
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground"

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Usage this month</h2>
        <span className="font-mono text-[10px] text-muted-foreground">{stats.period || "—"}</span>
      </div>
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <dt className="text-sm text-muted-foreground">{r.label}</dt>
            <dd className={`font-mono text-sm tabular-nums ${toneClass(r.tone)}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
        Aggregated from an org-scoped view (<span className="font-mono">org_usage_stats</span>).
      </p>
    </div>
  )
}
