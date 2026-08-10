"use client"

import { useEffect } from "react"

// ---------------------------------------------------------------------------
// In-app heartbeat that drives scheduled triggers during the live demo. It
// pings the scheduler tick endpoint on an interval; the server decides which
// triggers are actually due. This exists only for the local live preview, where
// no external cron is configured. In the deployed nhost project a Hasura cron
// trigger calls the scheduled-tick function instead and this component is not needed.
// ---------------------------------------------------------------------------

export function SchedulerHeartbeat({ intervalMs = 15000 }: { intervalMs?: number }) {
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      fetch("/api/scheduler/tick", { method: "POST" }).catch(() => {})
    }
    // Fire once shortly after mount, then on the interval.
    const first = setTimeout(tick, 2000)
    const timer = setInterval(() => {
      if (!cancelled) tick()
    }, intervalMs)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [intervalMs])

  return null
}
