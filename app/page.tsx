import Link from "next/link"
import { redirect } from "next/navigation"
import { TopBar } from "@/components/top-bar"
import { WorkflowList } from "@/components/workflow-list"
import { RoleBadge } from "@/components/status-badge"
import { UsageCard } from "@/components/usage-card"
import { SchedulerHeartbeat } from "@/components/scheduler-heartbeat"
import { getSession } from "@/lib/auth"
import { getOrgMembers, getQuota, getUsageStats, getWorkflows } from "@/lib/actions"

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const [{ workflows }, quota, members, usage] = await Promise.all([
    getWorkflows(),
    getQuota(),
    getOrgMembers(),
    getUsageStats(),
  ])

  const canCreate = session.role === "owner" || session.role === "editor"

  return (
    <div className="min-h-svh">
      <SchedulerHeartbeat />
      <TopBar
        orgName={session.orgName}
        userName={session.user.name}
        role={session.role}
        quota={quota ?? { used: 0, allowed: 0, period: "" }}
      />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
          <section>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {session.orgName} · scoped to your organization
                </p>
              </div>
              {canCreate ? (
                <Link
                  href="/workflows/new"
                  className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  New workflow
                </Link>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">viewers cannot create</span>
              )}
            </div>

            <WorkflowList workflows={workflows} />
          </section>

          <aside className="space-y-6">
            {usage && <UsageCard stats={usage} />}

            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Organization members
              </h2>
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{m.name}</span>
                    <RoleBadge role={m.role} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Permission model
              </h2>
              <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <li>
                  <span className="text-foreground">Layer 1</span> — every query and action is scoped
                  to your org via membership. Other orgs are invisible, even by ID.
                </li>
                <li>
                  <span className="text-foreground">Layer 2</span> — owner-only step types
                  (db_write, notify, webhook) and mid-run approval checks in the engine.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
