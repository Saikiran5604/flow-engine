// ---------------------------------------------------------------------------
// Real LLM call for llm_call steps, via Groq's OpenAI-compatible endpoint.
//
// If GROQ_API_KEY is not set, we fall back to a DISCLOSED stub with an
// artificial delay (the assignment explicitly allows this). The stub still
// produces a deterministic HOT/COLD-style answer so the conditional_branch
// demo behaves realistically without a key.
// ---------------------------------------------------------------------------

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

export interface LlmResult {
  text: string
  stubbed: boolean
  model: string
}

export async function callLLM(prompt: string, model = "llama-3.1-8b-instant"): Promise<LlmResult> {
  const key = process.env.GROQ_API_KEY

  if (!key) {
    // Disclosed stub with artificial latency.
    await sleep(900)
    return { text: stubAnswer(prompt), stubbed: true, model: `${model} (stub)` }
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 256,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LLM API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  return { text, stubbed: false, model }
}

function stubAnswer(prompt: string): string {
  const p = prompt.toLowerCase()
  const hotSignals = ["budget", "buy", "purchase", "seats", "urgent", "approved", "asap"]
  const isHot = hotSignals.some((s) => p.includes(s))
  return isHot ? "HOT" : "COLD"
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
