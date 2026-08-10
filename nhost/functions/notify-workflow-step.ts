import type { Request, Response } from "express"

export async function handler(req: Request, res: Response) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" })
  const event = req.body?.event
  console.info("[nhost] workflow step notification", {
    stepRunId: event?.data?.new?.id,
    status: event?.data?.new?.status,
  })
  return res.json({ ok: true })
}
