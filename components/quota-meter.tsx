import { cn } from "@/lib/utils"

export function QuotaMeter({
  used,
  allowed,
  period,
  className,
}: {
  used: number
  allowed: number
  period: string
  className?: string
}) {
  const pct = allowed > 0 ? Math.min(100, Math.round((used / allowed) * 100)) : 0
  const exhausted = used >= allowed
  const near = pct >= 80

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex flex-col items-end">
        <span className="font-mono text-xs text-muted-foreground">quota · {period}</span>
        <span
          className={cn(
            "font-mono text-xs font-medium",
            exhausted ? "text-destructive" : near ? "text-warning" : "text-foreground",
          )}
        >
          {used}/{allowed} runs
        </span>
      </div>
      <div className="h-8 w-20 overflow-hidden rounded-md border border-border bg-muted">
        <div
          className={cn(
            "h-full transition-all",
            exhausted ? "bg-destructive" : near ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
          aria-label={`Quota ${used} of ${allowed} used`}
        />
      </div>
    </div>
  )
}
