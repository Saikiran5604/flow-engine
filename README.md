# Flowgent — Multi-tenant AI Agent Workflow Builder

A small multi-tenant SaaS where organizations build and run **AI agent workflows**
(ordered pipelines of typed steps: LLM call, HTTP request, conditional branch,
approval gate, DB write, notify). It demonstrates two distinct permission layers
and a server-side action handler that executes runs with quotas, retries, and
human-in-the-loop approval.

---

## ⚠️ Stack note (read this first)

The original brief named **nhost + Hasura**. Per the agreed direction, this
submission builds the **full frontend + workflow-engine logic now against a
swappable, Hasura-shaped data layer**, so it runs and demos **live** end-to-end.
Every boundary that would be a Hasura concern is isolated so it can be swapped
for real Hasura/nhost without touching the UI. See
[**"Mapping to Hasura/nhost"**](#mapping-to-hasuranhost) below — this is
deliberate, not an oversight.

- **Data layer** — `lib/store.ts` is an in-memory store with the exact table
  shapes (`organizations`, `org_members`, `workflows`, `workflow_steps`,
  `workflow_triggers`, `workflow_runs`, `step_runs`, `artifacts`). Replace its
  bodies with Hasura GraphQL calls; the callers don't change.
- **Action handler** — `lib/engine.ts` is the stand-in for the Hasura Action
  that the brief calls `triggerWorkflowRun`.
- **Subscriptions** — the live run view polls an org-scoped endpoint
  (`/api/runs/[runId]`). Swap the SWR fetcher for a Hasura GraphQL subscription
  on `step_runs`; the component contract is identical.

---

## Running it

```bash
pnpm install
pnpm dev
```

Open the app and pick an identity on the login screen. No password — this is a
mock auth layer (a signed cookie holds the user id); it stands in for nhost Auth.

### Seeded tenants & users

| Org         | User  | Role   |
| ----------- | ----- | ------ |
| Acme AI     | Alice | owner  |
| Acme AI     | Evan  | editor |
| Acme AI     | Vera  | viewer |
| Globex Labs | Bob   | owner  |
| Globex Labs | Gwen  | editor |

Acme ships with a seeded demo workflow, **Lead Triage Agent**, that exercises
every step type and pauses at an approval gate.

### LLM calls

The `llm_call` step makes a **real** call to Groq if `GROQ_API_KEY` is set
(`llama-3.1-8b-instant` by default). Without a key it uses a **clearly
disclosed stub** — the step output includes `"stubbed": true` — so the demo
always runs. Set the key in project env vars to see live completions.

Outbound `http_request` steps are attempted for real (with one retry); if the
runtime has no outbound network, the step falls back to a **disclosed simulated
response** (`"simulated": true`) so the pipeline can finish.

---

## The two permission layers

The brief's central question: *why isn't one permission system enough?* Because
the two layers answer different questions at different times.

### Layer 1 — static, identity/role/tenant scoping (the "who are you" layer)

Enforced on **every** read and write. This is what Hasura's row-level
permissions + role claims would do.

- **Tenant isolation.** Every query is filtered by the caller's `orgId`, derived
  server-side from the session — never from client input. A resource in another
  org is treated as **not-found**, so guessing an ID (`/workflows/wf_demo_globex`
  while signed into Acme) leaks nothing and is indistinguishable from a
  nonexistent id. Verified live.
- **Role capability.** `owner` / `editor` / `viewer`. Viewers can't create,
  edit, or trigger; the UI hides the controls **and** the server actions reject
  the calls (`lib/actions.ts`).

Layer 1 is necessary but **not sufficient**: it's coarse and static. It can say
"editors may edit workflows," but it can't express "…except this particular
step, which reaches outside the tenant" or "…this specific paused run may be
resumed only by whoever has approval authority *right now*."

### Layer 2 — capability + runtime gating (the "should this action happen" layer)

Two parts:

1. **Static capability gate (per step/trigger type).** Some step types reach
   *outside* the tenant boundary — `db_write`, `notify`, and the `webhook`
   trigger — so they're **owner-only**, a finer grain than the role check.
   Enforced in the builder UI (disabled with an "owner" tag) **and**
   re-validated in `saveWorkflow` server-side, so a crafted request can't add a
   `notify` step as an editor.
2. **Dynamic, mid-execution gate (approval).** When a run hits an
   `approval_gate`, the engine **pauses** the whole run and stores state. It
   resumes only when someone calls `approveStep`, and the engine re-checks the
   approver's role **at approval time** against the run's org (`lib/engine.ts →
   approveStep`). This is a decision the row-permission system fundamentally
   can't make in advance: it depends on runtime state (the run is paused) and on
   who acts, when — not on a static row/role rule.

**In one line:** Layer 1 decides *what rows you can touch*; Layer 2 decides
*whether a specific privileged or stateful action is allowed to proceed*.
Collapsing them means either over-granting (editors get outward-reaching steps)
or you can't express runtime approvals at all.

---

## The action handler (`triggerWorkflowRun`)

`lib/engine.ts` mirrors the brief's server-side handler:

1. Resolve the workflow and its org; reject cross-org callers (Layer 1).
2. **Quota check** — refuse if the org's `quotaUsed >= quotaAllowed` for the
   period. Quota is billed per run on completion.
3. Create the `workflow_run` and pre-create all `step_runs` as `pending` so the
   live view shows the full plan immediately.
4. Execute steps in order, updating `step_runs` throughout for subscriptions:
   - `llm_call` / `http_request` make **real external calls with ≥ 1 retry**.
   - `conditional_branch` inspects the previous output and can **skip**
     downstream steps (e.g. skip the approval gate for COLD leads).
   - `approval_gate` sets the run to `paused` and **stops**; `approveStep`
     resumes from the next step after re-checking the approver.
   - `db_write` persists an artifact; `notify` records a delivery payload.
5. Failures mark the step `failed`, fail the run, and stop.

Execution is detached from the request so the client streams progress.

---

## The Final Task scenario (verified live)

The seeded **Lead Triage Agent**:

1. `llm_call` — classify a lead message as HOT/COLD.
2. `conditional_branch` — if HOT, continue to approval; if COLD, skip the gate.
3. `approval_gate` — **run pauses**; an owner/editor must approve.
4. `http_request` — enrich the lead via an external API (retries once).
5. `notify` — alert the sales channel.

Trigger it as Alice (owner): the LLM returns **HOT**, the run **pauses** at
step 3, quota increments, and **Approve & resume** finishes the pipeline —
`step 3` records `approved by u_alice`. As **Vera (viewer)** the run controls
are hidden; as **Evan (editor)** the `db_write` / `notify` / `webhook` options
are disabled.

---

## Mapping to Hasura/nhost

| This submission                          | Real Hasura / nhost                                             |
| ---------------------------------------- | --------------------------------------------------------------- |
| `lib/store.ts` (in-memory tables)        | Postgres tables + Hasura GraphQL                                |
| `orgId` filter on every query (Layer 1)  | Hasura **row-level permissions** keyed on the `x-hasura-org-id` session var |
| role capability checks                   | Hasura **role permissions** (`owner`/`editor`/`viewer`)         |
| `lib/engine.ts` (`startRun`)             | Hasura **Action** `triggerWorkflowRun` → nhost serverless fn    |
| `approveStep` runtime role re-check      | Action handler logic (can't be a static permission)             |
| owner-only step/trigger validation       | Action handler + permission preset                              |
| `/api/runs/[runId]` polling              | Hasura **subscription** on `step_runs`                          |
| signed-cookie mock auth                  | **nhost Auth** (JWT with Hasura claims)                         |
| `http_request` fetch + retry             | serverless fetch; `db_write`/`notify` via **Event Triggers**    |

---

## Project structure

```
lib/
  types.ts        # schema types + owner-only capability sets
  store.ts        # Hasura-shaped data layer + org-scoped accessors + seed
  auth.ts         # mock session (swap for nhost Auth)
  engine.ts       # workflow engine = the triggerWorkflowRun action handler
  actions.ts      # server actions; enforce Layer 1 on every call
  llm.ts          # real Groq call with disclosed stub fallback
  step-meta.ts    # step/trigger metadata + owner-only flags
app/
  login/          # identity picker (mock auth)
  page.tsx        # org-scoped dashboard + quota + members
  workflows/new   # builder
  workflows/[id]  # detail + live run view (not-found on cross-org)
  api/runs/*      # org-scoped run state (subscription simulation)
  api/webhook/*   # inbound webhook trigger (owner-only trigger type)
components/
  workflow-builder.tsx   # typed steps, drag-reorder, capability gating
  run-view.tsx           # live step-by-step run with approve UI
  ...
```

## Known trade-offs

- **In-memory data** resets on server restart. Intentional for a live,
  zero-setup demo; the swap points are documented above.
- **Polling instead of websockets** for run updates — a faithful stand-in for a
  Hasura subscription with a one-line fetcher swap.
- **Mock auth** — no real credentials; identities are picked, not
  authenticated.
