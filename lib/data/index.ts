import type { DataLayer } from "./adapter"
import { memoryDataLayer } from "./memory"

// ---------------------------------------------------------------------------
// Adapter selector.
//
// The app talks to whichever DataLayer this returns. Selection is by
// environment, so switching from the in-memory demo to a real Hasura/nhost
// backend is a deploy-time concern — no application code changes:
//
//   NHOST_GRAPHQL_URL   e.g. https://<subdomain>.hasura.<region>.nhost.run/v1/graphql
//   NHOST_ADMIN_SECRET  the Hasura admin secret (server-only)
//
// When both are present we use the GraphQL adapter; otherwise we fall back to
// the in-memory store that powers the live preview. The nhost module is loaded
// lazily so the demo never needs the GraphQL client on its path.
// ---------------------------------------------------------------------------

export function isNhostConfigured(): boolean {
  return Boolean(process.env.NHOST_GRAPHQL_URL && process.env.NHOST_ADMIN_SECRET)
}

let cached: DataLayer | null = null

export async function getDataLayer(): Promise<DataLayer> {
  if (cached) return cached

  let layer: DataLayer
  if (isNhostConfigured()) {
    const { createNhostDataLayer } = await import("./nhost")
    layer = createNhostDataLayer({
      graphqlUrl: process.env.NHOST_GRAPHQL_URL!,
      adminSecret: process.env.NHOST_ADMIN_SECRET!,
    })
  } else {
    layer = memoryDataLayer
  }

  cached = layer
  return layer
}

export function activeBackend(): "nhost" | "memory" {
  return isNhostConfigured() ? "nhost" : "memory"
}
