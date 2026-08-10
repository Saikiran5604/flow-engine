"use client"

import { useState } from "react"
import { Check, Clock, Copy, Hand, Send, Webhook } from "lucide-react"
import type { WorkflowTrigger } from "@/lib/types"

interface Props {
  triggers: WorkflowTrigger[]
  onFired?: () => void
}

export function TriggersPanel({ triggers, onFired }: Props) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Triggers</h2>
      <ul className="space-y-2">
        {triggers.length === 0 && <li className="text-sm text-muted-foreground">No triggers configured.</li>}
        {triggers.map((t) => (
          <li key={t.id} className="rounded-md border border-border bg-card p-3">
            {t.type === "manual" && <ManualRow />}
            {t.type === "webhook" && <WebhookRow token={t.token} onFired={onFired} />}
            {t.type === "scheduled" && <ScheduledRow trigger={t} />}
            {t.type === "database_event" && <DatabaseEventRow />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RowHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-mono text-xs font-medium">{label}</span>
    </div>
  )
}

function ManualRow() {
  return (
    <>
      <RowHead icon={<Hand className="h-3.5 w-3.5" />} label="manual" />
      <p className="mt-1.5 text-xs text-muted-foreground">Use the “Run now” button above.</p>
    </>
  )
}

function WebhookRow({ token, onFired }: { token?: string; onFired?: () => void }) {
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const url = typeof window !== "undefined" && token ? `${window.location.origin}/api/webhook/${token}` : ""

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function sendTest() {
    if (!url) return
    setSending(true)
    setSent(null)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "test-event", at: new Date().toISOString() }),
      })
      const json = await res.json()
      setSent(json.ok ? "Run started" : json.error || "Failed")
      if (json.ok) onFired?.()
    } catch {
      setSent("Request failed")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <RowHead icon={<Webhook className="h-3.5 w-3.5" />} label="webhook" />
      <div className="mt-2 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {url || "…"}
        </code>
        <button
          onClick={copy}
          aria-label="Copy webhook URL"
          className="grid size-7 shrink-0 place-items-center rounded border border-border text-muted-foreground transition-colors hover:bg-secondary"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <button
        onClick={sendTest}
        disabled={sending}
        className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        <Send className="h-3 w-3" />
        {sending ? "Sending…" : "Send test event"}
      </button>
      {sent && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{sent}</span>}
    </>
  )
}

function ScheduledRow({ trigger }: { trigger: WorkflowTrigger }) {
  const every = Number(trigger.config?.everySeconds ?? 90)
  const enabled = trigger.config?.enabled !== false
  const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt) : null
  return (
    <>
      <RowHead icon={<Clock className="h-3.5 w-3.5" />} label="scheduled" />
      <p className="mt-1.5 text-xs text-muted-foreground">
        Fires every <span className="font-mono text-foreground">{every}s</span> · {enabled ? "enabled" : "disabled"}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        last fired: {last ? last.toLocaleTimeString() : "not yet"}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Auto-fires in the background — watch Run history populate on its own.
      </p>
    </>
  )
}

function DatabaseEventRow() {
  return (
    <>
      <RowHead icon={<Webhook className="h-3.5 w-3.5" />} label="database_event" />
      <p className="mt-1.5 text-xs text-muted-foreground">Fires on a Hasura Event Trigger in production.</p>
    </>
  )
}
