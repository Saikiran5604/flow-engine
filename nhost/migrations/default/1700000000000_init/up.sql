-- ===========================================================================
-- Flowgent schema — mirrors lib/types.ts and the column names the nhost
-- DataLayer (lib/data/nhost.ts) expects. Note `order` is a SQL reserved word,
-- so step ordering uses the column `step_order`.
--
-- Multi-tenancy: every tenant-owned row carries org_id. Cross-org isolation
-- (Layer 1) is enforced by Hasura row permissions on the `user` role (see
-- ../../metadata/databases/default/tables), keyed off the org_members relation
-- and the JWT's X-Hasura-User-Id claim.
-- ===========================================================================

create extension if not exists pgcrypto;

-- --- identity ---------------------------------------------------------------
create table public.users (
  id    text primary key default ('u_' || substr(gen_random_uuid()::text, 1, 8)),
  email text not null unique,
  name  text not null
);

create table public.organizations (
  id             text primary key default ('org_' || substr(gen_random_uuid()::text, 1, 8)),
  name           text not null,
  quota_allowed  integer not null default 25,
  quota_used     integer not null default 0,
  period         text not null
);

create table public.org_members (
  user_id text not null references public.users(id) on delete cascade,
  org_id  text not null references public.organizations(id) on delete cascade,
  role    text not null check (role in ('owner','editor','viewer')),
  primary key (user_id, org_id)
);
create index org_members_org_idx on public.org_members(org_id);
create index org_members_user_idx on public.org_members(user_id);

-- --- workflows --------------------------------------------------------------
create table public.workflows (
  id         text primary key default ('wf_' || substr(gen_random_uuid()::text, 1, 8)),
  org_id     text not null references public.organizations(id) on delete cascade,
  name       text not null,
  created_by text not null references public.users(id),
  created_at timestamptz not null default now()
);
create index workflows_org_idx on public.workflows(org_id);

create table public.workflow_steps (
  id          text primary key default ('st_' || substr(gen_random_uuid()::text, 1, 8)),
  workflow_id text not null references public.workflows(id) on delete cascade,
  step_order  integer not null,
  type        text not null check (type in (
                'llm_call','http_request','db_write','notify','conditional_branch','approval_gate')),
  name        text not null,
  config      jsonb not null default '{}'::jsonb
);
create index workflow_steps_wf_idx on public.workflow_steps(workflow_id);

create table public.workflow_triggers (
  id          text primary key default ('tg_' || substr(gen_random_uuid()::text, 1, 8)),
  workflow_id text not null references public.workflows(id) on delete cascade,
  type        text not null check (type in ('manual','webhook','scheduled','database_event')),
  config      jsonb not null default '{}'::jsonb,
  token         text unique,
  last_fired_at timestamptz
);
create index workflow_triggers_wf_idx on public.workflow_triggers(workflow_id);

-- --- runs -------------------------------------------------------------------
create table public.workflow_runs (
  id           text primary key default ('run_' || substr(gen_random_uuid()::text, 1, 8)),
  workflow_id  text not null references public.workflows(id) on delete cascade,
  org_id       text not null references public.organizations(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending','running','paused','completed','failed')),
  triggered_by text not null,
  trigger_type text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text
);
create index workflow_runs_wf_idx on public.workflow_runs(workflow_id);
create index workflow_runs_org_idx on public.workflow_runs(org_id);

create table public.step_runs (
  id          text primary key default ('sr_' || substr(gen_random_uuid()::text, 1, 8)),
  run_id      text not null references public.workflow_runs(id) on delete cascade,
  step_id     text not null,
  step_order  integer not null,
  type        text not null,
  name        text not null,
  status      text not null default 'pending'
                check (status in ('pending','running','paused','completed','failed','skipped')),
  input       jsonb,
  output      jsonb,
  error       text,
  attempt     integer not null default 0,
  approved_by text,
  approved_at timestamptz,
  started_at  timestamptz,
  finished_at timestamptz
);
create index step_runs_run_idx on public.step_runs(run_id);

create table public.artifacts (
  id         text primary key default ('art_' || substr(gen_random_uuid()::text, 1, 8)),
  org_id     text not null references public.organizations(id) on delete cascade,
  run_id     text not null references public.workflow_runs(id) on delete cascade,
  step_id    text not null,
  value      jsonb,
  created_at timestamptz not null default now()
);
create index artifacts_org_idx on public.artifacts(org_id);
