-- 1. Create the domain_update_jobs table
create table if not exists public.domain_update_jobs (
  domain text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued', -- queued | in_progress | complete | failed
  last_attempt_at timestamptz,
  last_updated_at timestamptz,
  attempts int not null default 0,
  inserted_at timestamptz not null default now()
);

-- 2. Add index for efficient job lookup
create index if not exists idx_update_jobs_status_attempted_at
  on public.domain_update_jobs (status, last_attempt_at);

-- 3. Enable Row Level Security
alter table public.domain_update_jobs enable row level security;

-- 4. Allow only service role to access this table
create policy "Service can manage jobs"
  on public.domain_update_jobs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 5. Create RPC to enqueue stale domains
create or replace function public.enqueue_stale_domain_jobs()
returns void
language sql
security definer
as $$
  insert into public.domain_update_jobs (domain, user_id)
  select domain_name, user_id
  from public.domains
  where updated_at < now() - interval '24 hours'
  on conflict (domain) do nothing;
$$;

-- 6. Cron job to enqueue domains once per day
select cron.schedule(
  'enqueue-domain-jobs',
  '0 1 * * *',
  $$
    select public.enqueue_stale_domain_jobs();
  $$
);

-- 7. Cron job to run the worker every 2 minutes
select cron.schedule(
  'process-domain-jobs',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/domain-update-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_key'),
        'X-Cron-Run', 'true'
      )
    );
  $$
);
