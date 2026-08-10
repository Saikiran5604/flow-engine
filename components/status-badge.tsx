import { cn } from "@/lib/utils"

const STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  running: "bg-primary/15 text-primary border-primary/30 animate-pulse",
  paused: "bg-warning/15 text-warning border-warning/40",
  completed: "bg-success/15 text-success border-success/40",
  failed: "bg-destructive/15 text-destructive border-destructive/40",
  skipped: "bg-muted/60 text-muted-foreground border-border line-through",
}

const LABELS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  paused: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.7rem] font-medium tracking-wide uppercase",
        STYLES[status] ?? STYLES.pending,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {LABELS[status] ?? status}
    </span>
  )
}

const ROLE_STYLES: Record<string, string> = {
  owner: "bg-primary/15 text-primary border-primary/30",
  editor: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  viewer: "bg-muted text-muted-foreground border-border",
}

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[0.7rem] font-medium uppercase tracking-wide",
        ROLE_STYLES[role] ?? ROLE_STYLES.viewer,
        className,
      )}
    >
      {role}
    </span>
  )
}
