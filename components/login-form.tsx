"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { loginAction } from "@/lib/actions"
import { RoleBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface LoginUser {
  id: string
  name: string
  email: string
  org: string
  role: string
}

export function LoginForm({ users }: { users: LoginUser[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<string | null>(null)

  // Group users by org so the two-organization setup is obvious.
  const orgs = Array.from(new Set(users.map((u) => u.org)))

  function login(userId: string) {
    setSelected(userId)
    startTransition(async () => {
      await loginAction(userId)
      router.push("/")
      router.refresh()
    })
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" />
          demo authentication
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          Choose an identity to sign in
        </h1>
        <p className="mt-2 max-w-lg text-pretty leading-relaxed text-muted-foreground">
          Two organizations, each with their own users and roles. Sign in as an Acme owner to build and
          run a workflow, then sign in as a Globex user to prove cross-org isolation.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {orgs.map((org) => (
          <div key={org} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-sm font-medium text-foreground">{org}</h2>
              <span className="font-mono text-xs text-muted-foreground">
                {users.filter((u) => u.org === org).length} members
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {users
                .filter((u) => u.org === org)
                .map((u) => (
                  <button
                    key={u.id}
                    onClick={() => login(u.id)}
                    disabled={pending}
                    className={cn(
                      "group flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 disabled:opacity-60",
                      selected === u.id && pending && "border-primary/60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    <RoleBadge role={u.role} />
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled className="pointer-events-none opacity-70">
          {pending ? "Signing in…" : "Pick any identity above"}
        </Button>
      </div>
    </div>
  )
}
