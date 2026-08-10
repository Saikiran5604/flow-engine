import type { StepType, TriggerType } from "./types"

export interface StepMeta {
  label: string
  short: string
  description: string
  ownerOnly: boolean
  accent: string // tailwind text color class for the node accent
}

export const STEP_META: Record<StepType, StepMeta> = {
  llm_call: {
    label: "LLM Call",
    short: "LLM",
    description: "Call a real LLM and use its output downstream.",
    ownerOnly: false,
    accent: "text-chart-1",
  },
  http_request: {
    label: "HTTP Request",
    short: "HTTP",
    description: "Call any external API. Retries once on failure.",
    ownerOnly: false,
    accent: "text-chart-5",
  },
  conditional_branch: {
    label: "Conditional Branch",
    short: "IF",
    description: "Branch on the previous step's output.",
    ownerOnly: false,
    accent: "text-chart-3",
  },
  approval_gate: {
    label: "Approval Gate",
    short: "GATE",
    description: "Pause the run until an owner/editor approves.",
    ownerOnly: false,
    accent: "text-warning",
  },
  db_write: {
    label: "DB Write",
    short: "DB",
    description: "Persist a result to your own tables. Owner only.",
    ownerOnly: true,
    accent: "text-chart-2",
  },
  notify: {
    label: "Notify",
    short: "NOTIFY",
    description: "Send an alert (Slack/email) via event trigger. Owner only.",
    ownerOnly: true,
    accent: "text-chart-2",
  },
}

export const STEP_ORDER: StepType[] = [
  "llm_call",
  "http_request",
  "conditional_branch",
  "approval_gate",
  "db_write",
  "notify",
]

export interface TriggerMeta {
  label: string
  description: string
  ownerOnly: boolean
}

export const TRIGGER_META: Record<TriggerType, TriggerMeta> = {
  manual: { label: "Manual", description: "A user clicks Run.", ownerOnly: false },
  webhook: {
    label: "Webhook",
    description: "External systems POST to an inbound endpoint. Owner only.",
    ownerOnly: true,
  },
  scheduled: { label: "Scheduled", description: "Cron-based trigger.", ownerOnly: false },
  database_event: { label: "Database Event", description: "A watched row change starts a run.", ownerOnly: false },
}

export function defaultConfigFor(type: StepType): Record<string, unknown> {
  switch (type) {
    case "llm_call":
      return { prompt: "Summarize this in one sentence: ...", model: "llama-3.1-8b-instant" }
    case "http_request":
      return { method: "GET", url: "https://httpbin.org/uuid" }
    case "conditional_branch":
      return { contains: "HOT", skipCount: 1 }
    case "approval_gate":
      return { note: "Requires owner/editor approval." }
    case "db_write":
      return {}
    case "notify":
      return { channel: "#general", message: "Workflow finished." }
  }
}
