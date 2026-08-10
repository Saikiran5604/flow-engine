# Flowgent — Multi-tenant AI Agent Workflow Builder

A small multi-tenant SaaS where organizations build and run **AI agent workflows**
(ordered pipelines of typed steps: LLM call, HTTP request, conditional branch,
approval gate, DB write, notify). It demonstrates two distinct permission layers
and a server-side action handler that executes runs with quotas, retries, and
human-in-the-loop approval.

---

## ⚠️ Stack note (read this first)

The original brief named **nhost + Hasura**. This submission does two things at
once:

1. **Runs live end-to-end today** on a zero-setup in-memory data layer, so every
   scenario (tenant isolation, role gating, quota, retries, approval pause/resume)
   is demonstrable in the preview with no external services.
2. **Ships the real Hasura/nhost layer** as deployable artifacts in
   [`nhost/`](#deploying-the-real-hasuranhost-layer) — SQL migrations, Hasura
   metadata with row-level permissions, and the serverless Action handlers. The
   app selects between the two **at runtime via env vars** with no code changes.

This is possible because all data access goes through a single async **adapter
seam** (`lib/data/`):

- **`lib/data/adapter.ts`** — the `DataLayer` interface every consumer depends
  on. Nothing in the app talks to a store directly.
- **`lib/data/memory.ts`** — in-memory implementation (the live demo). Backed by
  `lib/store.ts` with the exact table shapes (`organizations`, `org_members`,
  `workflows`, `workflow_steps`, `workflow_triggers`, `workflow_runs`,
  `step_runs`, `artifacts`).
- **`lib/data/nhost.ts`** — Hasura GraphQL implementation (dependency-free
  `fetch` client). Maps snake_case columns ↔ domain types.
- **`lib/data/index.ts`** — `getDataLayer()` returns the nhost adapter when
  `NHOST_GRAPHQL_URL` + `NHOST_ADMIN_SECRET` are set, otherwise the in-memory
  one. **This is the only switch.**

The **action handler** `lib/engine.ts` is the in-process form of the Hasura
Action the brief calls `triggerWorkflowRun`; its server-side, admin-privileged
twin lives at `nhost/functions/trigger-workflow-run.ts`. The live run view polls
an org-scoped endpoint (`/api/runs/[runId]`); swapping the SWR fetcher for a
Hasura subscription on `step_runs` is a one-line change with an identical
component contract.

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

## Schema reasoning & data model

The relational schema follows a strict multi-tenant hierarchy:

```
organizations → org_members → workflows → steps / triggers → runs → step_runs
```

Design decisions (see `nhost/migrations/default/1700000000000_init/up.sql`):

- **UUID primary keys everywhere.** Non-sequential ids remove predictable
  ID-guessing attacks and allow client/distributed id generation. Cross-org
  access is denied *and* the id space isn't enumerable.
- **JSONB config columns.** `workflow_steps.config` and
  `workflow_triggers.config` are `jsonb`, so each step type carries its own
  parameters (LLM prompt, HTTP headers, branch condition) without a rigid,
  frequently-migrated column per node type. New step types need **zero** schema
  changes.
- **Cascading integrity.** Foreign keys use `ON DELETE CASCADE` anchored to
  `organizations` and `workflows`, so deleting a tenant or workflow cleanly
  purges orphaned runs, step-runs, and artifacts — no dangling execution
  history.
- **Denormalized `org_id` on execution tables.** `workflow_runs` and
  `step_runs` carry `org_id` directly (not only via `workflow_id`) so Hasura
  row permissions can scope them with a single, index-backed predicate instead
  of a multi-hop relationship walk on every subscription tick.

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

## Deploying the real Hasura/nhost layer

The `nhost/` directory is a complete, deployable nhost project. It is **not**
mocked — it contains the migrations, permission metadata, and serverless
handlers described in the roadmap.

```
nhost/
  nhost.toml                                   # project + JWT-claims config
  migrations/default/1700000000000_init/       # up.sql / down.sql — full schema
  seeds/default/1700000000001_demo.sql         # the two-org demo dataset
  metadata/
    databases/.../tables/tables.yaml           # relationships + Layer-1 row permissions
    actions.yaml / actions.graphql             # triggerWorkflowRun, approveStep actions
    databases/default/event_triggers.yaml      # run/step notification Event Triggers
  functions/
    _lib/graphql.ts                            # admin GraphQL client + claim parsing
    trigger-workflow-run.ts                    # Layer-1/2 re-checks, quota, retries, LLM
    approve-step.ts                            # owner-only approval + resume
    scheduled-workflow-tick.ts                 # cron-driven scheduled triggers
    notify-workflow-run.ts / notify-workflow-step.ts # Event Trigger handlers
```

Deploy in three steps (matches the roadmap exactly):

1. **Migrations & metadata** — `nhost up` (local) or `nhost deploy` (cloud)
   pushes the schema and applies the Hasura permission metadata that enforces
   **Layer 1** at the GraphQL boundary.
2. **Serverless handlers** — the two functions deploy automatically with the
   project; the actions in `metadata/actions.yaml` point at them and gate them
   by role (viewers can't even call `triggerWorkflowRun`).
3. **Point the app at it** — set `NHOST_GRAPHQL_URL` and `NHOST_ADMIN_SECRET`
   in project env vars. `getDataLayer()` picks up the nhost adapter on next
   request. No app code changes.

### How each concern maps

| This submission                          | Real Hasura / nhost (shipped in `nhost/`)                        |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `lib/data/memory.ts` + `lib/store.ts`    | Postgres tables (`migrations/…/up.sql`) via `lib/data/nhost.ts`  |
| `orgId` filter on every query (Layer 1)  | Hasura **row-level permissions** on `x-hasura-org-id` (`tables.yaml`) |
| role capability checks                   | Hasura **role permissions** (`owner`/`editor`/`viewer`)          |
| `lib/engine.ts` (`startRun`)             | Action `triggerWorkflowRun` → `functions/trigger-workflow-run.ts` |
| `approveStep` runtime role re-check      | `functions/approve-step.ts` (owner-only, can't be a static rule) |
| owner-only step/trigger validation       | Action permission preset + handler re-check                     |
| `/api/runs/[runId]` polling              | Hasura **subscription** on `step_runs`                           |
| signed-cookie mock auth                  | **nhost Auth** JWT → `x-hasura-user-id` / `-org-id` / `-role`    |
| `http_request` fetch + retry             | serverless fetch; `db_write`/`notify` via handler / Event Triggers |

Note the security posture: the serverless handlers run with the **admin
secret**, so they bypass Hasura row permissions — which is exactly why they
**re-derive the caller's org and role from the forwarded JWT claims and
re-enforce both layers** rather than trusting anything in the request body.

### Why the live preview uses Actions + polling

The preview intentionally keeps its zero-setup path on Next.js Server Actions
and SWR polling so it remains runnable without an Nhost project. When the Nhost
variables are present, reads and writes use the GraphQL adapter, the
aggregation reads the tracked `org_usage_stats` view, and deployed Nhost
Action handlers own execution. A production UI can replace the polling
fetcher with a Hasura subscription on `workflow_runs` / `step_runs`; the same
org and role predicates remain enforced at the Hasura boundary and inside
handlers.

---

## Project structure

```
lib/
  data/
    adapter.ts    # DataLayer interface — the single seam every consumer uses
    memory.ts     # in-memory implementation (live demo)
    nhost.ts      # Hasura GraphQL implementation (fetch client)
    index.ts      # getDataLayer() — picks adapter from env vars
  types.ts        # schema types + owner-only capability sets
  store.ts        # in-memory tables + org-scoped accessors + seed
  auth.ts         # mock session via the seam (swap for nhost Auth)
  engine.ts       # workflow engine = the triggerWorkflowRun action handler
  actions.ts      # server actions; enforce Layer 1 on every call
  llm.ts          # real Groq call with disclosed stub fallback
  step-meta.ts    # step/trigger metadata + owner-only flags
nhost/            # deployable Hasura/nhost project (see deploy section)
app/
  login/          # identity picker (mock auth)
  page.tsx        # org-scoped dashboard + quota + members
  workflows/new   # builder
  workflows/[id]  # detail + live run view (not-found on cross-org)
  api/runs/*      # org-scoped run state (subscription simulation)
  api/webhook/*   # inbound webhook trigger (owner-only trigger type)
  api/scheduler/tick # live preview heartbeat for scheduled triggers
components/
  triggers-panel.tsx       # copyable webhook URL + test event + schedule status
  scheduler-heartbeat.tsx  # invokes scheduled trigger tick in preview
  usage-card.tsx           # org_usage_stats dashboard aggregation
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
