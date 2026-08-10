-- Demo tenants, users and the Lead Triage Agent workflow — the same fixture
-- the in-memory store seeds, so a fresh nhost project matches the live demo.

insert into public.users (id, email, name) values
  ('u_alice', 'alice@acme.test', 'Alice (Acme Owner)'),
  ('u_evan',  'evan@acme.test',  'Evan (Acme Editor)'),
  ('u_vera',  'vera@acme.test',  'Vera (Acme Viewer)'),
  ('u_bob',   'bob@globex.test', 'Bob (Globex Owner)'),
  ('u_gwen',  'gwen@globex.test','Gwen (Globex Editor)')
on conflict (id) do nothing;

insert into public.organizations (id, name, quota_allowed, quota_used, period) values
  ('org_acme',   'Acme AI',     25, 3, '2026-08'),
  ('org_globex', 'Globex Labs', 25, 0, '2026-08')
on conflict (id) do nothing;

insert into public.org_members (user_id, org_id, role) values
  ('u_alice', 'org_acme',   'owner'),
  ('u_evan',  'org_acme',   'editor'),
  ('u_vera',  'org_acme',   'viewer'),
  ('u_bob',   'org_globex', 'owner'),
  ('u_gwen',  'org_globex', 'editor')
on conflict (user_id, org_id) do nothing;

insert into public.workflows (id, org_id, name, created_by) values
  ('wf_demo_acme', 'org_acme', 'Lead Triage Agent', 'u_alice')
on conflict (id) do nothing;

insert into public.workflow_steps (id, workflow_id, step_order, type, name, config) values
  ('st_llm', 'wf_demo_acme', 0, 'llm_call', 'Classify lead intent',
    '{"prompt":"Classify the following lead message as HOT or COLD. Reply with only one word.\n\nMessage: We have budget approved and want to buy 500 seats this quarter.","model":"llama-3.1-8b-instant"}'),
  ('st_cond', 'wf_demo_acme', 1, 'conditional_branch', 'Route on intent',
    '{"contains":"HOT","description":"If the LLM says HOT, require human approval before outreach."}'),
  ('st_approval', 'wf_demo_acme', 2, 'approval_gate', 'Approve hot-lead outreach',
    '{"note":"An owner or editor must approve before we contact the lead."}'),
  ('st_http', 'wf_demo_acme', 3, 'http_request', 'Enrich via public API',
    '{"method":"GET","url":"https://httpbin.org/uuid"}'),
  ('st_notify', 'wf_demo_acme', 4, 'notify', 'Alert sales channel',
    '{"channel":"#sales","message":"Hot lead approved and enriched."}')
on conflict (id) do nothing;

insert into public.workflow_triggers (id, workflow_id, type, config, token) values
  ('tg_manual',  'wf_demo_acme', 'manual',  '{}', null),
  ('tg_webhook', 'wf_demo_acme', 'webhook', '{}', 'acme-demo-token')
on conflict (id) do nothing;
