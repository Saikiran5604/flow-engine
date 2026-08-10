import { cookies } from "next/headers"
import { getDataLayer } from "./data"
import type { SessionUser } from "./types"

// ---------------------------------------------------------------------------
// Mock auth layer. Stands in for nhost Auth: it produces a SessionUser carrying
// { user, orgId, role } which every server action uses for Layer-1 scoping.
// Swapping to nhost means replacing getSession() with a JWT/claims read (org id
// and role come straight from the Hasura session claims); the rest of the app
// keeps consuming SessionUser unchanged.
// ---------------------------------------------------------------------------

const COOKIE = "wf_session"

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const userId = store.get(COOKIE)?.value
  if (!userId) return null

  const dl = await getDataLayer()
  const user = await dl.getUser(userId)
  if (!user) return null

  // A user belongs to exactly one org in this demo; find their membership.
  const m = await dl.getPrimaryMembership(userId)
  if (!m) return null

  const org = await dl.getOrg(m.orgId)
  if (!org) return null

  return { user, orgId: org.id, orgName: org.name, role: m.role }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession()
  if (!s) throw new Error("Not authenticated")
  return s
}

export async function setSession(userId: string) {
  const store = await cookies()
  store.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearSession() {
  const store = await cookies()
  store.delete(COOKIE)
}
