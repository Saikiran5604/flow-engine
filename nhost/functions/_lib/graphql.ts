// Shared admin-scoped GraphQL client for nhost serverless functions.
// Functions run server-side with NHOST_ADMIN_SECRET, so they bypass Hasura
// row permissions — the handler itself is responsible for re-deriving the
// caller's org + role from the forwarded session and enforcing Layer 1/2.

const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL as string
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET as string

export async function adminGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "))
  return json.data as T
}

// Re-derive the caller from the forwarded Hasura session claims. The Action is
// configured with forward_client_headers, so Hasura passes the verified JWT
// claims — we trust these, never a userId in the request body.
export interface Caller {
  userId: string
  orgId: string
  role: "owner" | "editor" | "viewer"
}

export function callerFromHeaders(headers: Record<string, string | undefined>): Caller | null {
  // Hasura forwards session variables as x-hasura-* headers on the action call.
  const userId = headers["x-hasura-user-id"]
  const orgId = headers["x-hasura-org-id"]
  const role = headers["x-hasura-role"] as Caller["role"] | undefined
  if (!userId || !orgId || !role) return null
  return { userId, orgId, role }
}
