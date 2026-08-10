import { cookies } from "next/headers"
import { membership, raw } from "./store"
import type { SessionUser } from "./types"

// ---------------------------------------------------------------------------
// Mock auth layer. Stands in for nhost Auth: it produces a SessionUser carrying
// { user, orgId, role } which every server action uses for Layer-1 scoping.
// Swapping to nhost means replacing getSession() with a JWT/claims read; the
// rest of the app keeps consuming SessionUser unchanged.
// ---------------------------------------------------------------------------

const COOKIE = "wf_session"

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const userId = store.get(COOKIE)?.value
  if (!userId) return null

  const user = raw.user(userId)
  if (!user) return null

  // A user belongs to exactly one org in this demo; find their membership.
  const db = raw.db()
  const m = db.orgMembers.find((mm) => mm.userId === userId)
  if (!m) return null

  const org = raw.org(m.orgId)
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

// Re-export for convenience where only a membership check is needed.
export { membership }
