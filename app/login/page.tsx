import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { getSession } from "@/lib/auth"
import { listLoginUsers } from "@/lib/actions"

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect("/")

  const users = await listLoginUsers()

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <LoginForm users={users} />
    </main>
  )
}
