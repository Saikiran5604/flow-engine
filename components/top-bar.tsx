"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { logoutAction } from "@/lib/actions"
import { RoleBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { QuotaMeter } from "@/components/quota-meter"

interface TopBarProps {
  orgName: string
  userName: string
  role: string
  quota: { used: number; allowed: number; period: string }
}

export function TopBar({ orgName, userName, role, quota }: TopBarProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function logout() {
    startTransition(async () => {
      await logoutAction()
      router.push("/login")
      router.refresh()
    })
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
              F
            </span>
            <span className="font-semibold tracking-tight">Flowgent</span>
          </Link>
          <span className="hidden h-4 w-px bg-border sm:block" />
          <span className="hidden font-mono text-sm text-muted-foreground sm:inline">{orgName}</span>
        </div>

        <div className="flex items-center gap-3">
          <QuotaMeter used={quota.used} allowed={quota.allowed} period={quota.period} />
          <span className="hidden h-6 w-px bg-border md:block" />
          <div className="hidden items-center gap-2 md:flex">
            <span className="text-sm text-muted-foreground">{userName}</span>
            <RoleBadge role={role} />
          </div>
          <Button variant="outline" size="sm" onClick={logout} disabled={pending}>
            {pending ? "…" : "Switch user"}
          </Button>
        </div>
      </div>
    </header>
  )
}
