-- Keep a durable search history and allow only one worker at a time.
create table public.opportunity_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  scheduled boolean not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  error_message text
);
create index opportunity_discovery_runs_started_idx on public.opportunity_discovery_runs (started_at desc);
alter table public.opportunity_discovery_runs enable row level security;
revoke all on public.opportunity_discovery_runs from public, anon, authenticated;
grant select, insert, update on public.opportunity_discovery_runs to service_role;

create or replace function public.claim_opportunity_discovery_run(p_run_key text, p_scheduled boolean)
returns table (claimed boolean, run_id uuid, reason text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(82910, 25);
  if exists (select 1 from opportunity_discovery_runs
    where status = 'running' and started_at > now() - interval '6 minutes') then
    return query select false, null::uuid, 'already_running'::text;
    return;
  end if;
  update opportunity_discovery_runs set status = 'failed', finished_at = now(),
    error_message = 'The worker stopped before recording its result.'
    where status = 'running';
  if not p_scheduled and exists (select 1 from opportunity_discovery_runs
    where not scheduled and started_at > now() - interval '10 minutes') then
    return query select false, null::uuid, 'recent_manual_run'::text;
    return;
  end if;
  insert into opportunity_discovery_runs (run_key, scheduled)
  values (p_run_key, p_scheduled) on conflict (run_key) do nothing returning id into v_id;
  return query select v_id is not null, v_id,
    case when v_id is null then 'already_completed' else 'claimed' end::text;
end;
$$;
revoke all on function public.claim_opportunity_discovery_run(text, boolean) from public, anon, authenticated;
grant execute on function public.claim_opportunity_discovery_run(text, boolean) to service_role;

-- Stable identities allow different pages about the same event to share history.
alter table public.opportunity_discovery_candidates add column identity_key text;
alter table public.opportunity_discovery_candidates add column priority integer not null default 0;
create index opportunity_discovery_identity_idx on public.opportunity_discovery_candidates (identity_key);
create index opportunity_discovery_queue_idx on public.opportunity_discovery_candidates (status, priority desc, created_at);

-- Seed exact identities for the existing cards with the same normalization as the worker.
update public.opportunity_discovery_candidates set identity_key =
  btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(regexp_replace(split_part(split_part(name, '|', 1), '•', 1),
          '^(register( now)?( for)?|apply( now)?( for)?|get tickets?( for)?|buy (a )?pass( for)?|join|about us[[:space:]]*[-–—:]|about)[[:space:]]+', '', 'i')),
        '\m20[0-9]{2}\M', '', 'g'),
      '[^[:alnum:][:space:]]', ' ', 'g'),
    '[[:space:]]+', ' ', 'g')) || '|' ||
  coalesce(to_char(coalesce(event_at, deadline_at) at time zone 'UTC', 'YYYY-MM-DD'), '');
