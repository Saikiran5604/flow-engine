import Link from "next/link"
import { redirect } from "next/navigation"
import { TopBar } from "@/components/top-bar"
import { WorkflowBuilder } from "@/components/workflow-builder"
import { getQuota } from "@/lib/actions"
import { getSession } from "@/lib/auth"

export default async function NewWorkflowPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  if (session.role === "viewer") redirect("/")

  const quota = await getQuota()

  return (
    <div className="min-h-svh">
      <TopBar
        orgName={session.orgName}
        userName={session.user.name}
        role={session.role}
        quota={quota ?? { used: 0, allowed: 0, period: "" }}
      />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Workflows
        </Link>
        <h1 className="mt-3 mb-6 text-2xl font-semibold tracking-tight">New workflow</h1>
        <WorkflowBuilder role={session.role} />
      </main>
    </div>
  )
}
