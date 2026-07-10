-- refynr — auth + AI-insights metering
-- Run this in the Supabase SQL editor (or `supabase db push`) once per project.
--
-- Model:
--   profiles      1:1 with auth.users, holds the billing `plan`
--   usage_daily   one row per user per UTC day, counts insights calls
--   consume_insight()  atomic check-and-increment: enforces the per-user
--                      quota AND a global daily cap in one transaction, so
--                      concurrent requests can't both slip past the limit.
--   refund_insight()   decrement when the downstream AI call fails.
--
-- Quotas are NOT stored here — they live in apps/web/lib/plans.ts and are
-- passed in per call, so tuning the free tier / paywall is a code change.

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── usage_daily ─────────────────────────────────────────────────────────────
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);
create index if not exists usage_daily_day_idx on public.usage_daily (day);

-- ── row-level security ──────────────────────────────────────────────────────
-- Clients may READ their own rows (to show "X insights left today"). All
-- WRITES happen server-side via the SECURITY DEFINER functions below, called
-- with the service-role key — never trusted from the browser.
alter table public.profiles     enable row level security;
alter table public.usage_daily  enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own usage read" on public.usage_daily;
create policy "own usage read" on public.usage_daily
  for select using (auth.uid() = user_id);

-- ── metering functions ──────────────────────────────────────────────────────
-- Returns jsonb: { allowed, reason?, used, limit }
--   reason = 'global_cap' | 'quota' when allowed = false
create or replace function public.consume_insight(
  p_user_id   uuid,
  p_quota     int,
  p_global_cap int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    date := (now() at time zone 'utc')::date;
  v_user   int;
  v_global int;
begin
  -- Global wallet backstop first (soft ceiling across all users today).
  select coalesce(sum(count), 0) into v_global
  from public.usage_daily where day = v_day;
  if v_global >= p_global_cap then
    return jsonb_build_object('allowed', false, 'reason', 'global_cap');
  end if;

  -- Ensure a row exists, then lock it so the read+increment is atomic.
  insert into public.usage_daily (user_id, day, count)
  values (p_user_id, v_day, 0)
  on conflict (user_id, day) do nothing;

  select count into v_user
  from public.usage_daily
  where user_id = p_user_id and day = v_day
  for update;

  if v_user >= p_quota then
    return jsonb_build_object(
      'allowed', false, 'reason', 'quota', 'used', v_user, 'limit', p_quota);
  end if;

  update public.usage_daily set count = count + 1
  where user_id = p_user_id and day = v_day;

  return jsonb_build_object('allowed', true, 'used', v_user + 1, 'limit', p_quota);
end;
$$;

-- Give back a reserved call when the AI request itself fails.
create or replace function public.refund_insight(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  update public.usage_daily set count = greatest(count - 1, 0)
  where user_id = p_user_id and day = v_day;
end;
$$;

-- These run as the definer (postgres) and must never be reachable from the
-- browser — only the server's service-role client may call them.
revoke execute on function public.consume_insight(uuid, int, int) from public, anon, authenticated;
revoke execute on function public.refund_insight(uuid)            from public, anon, authenticated;
grant  execute on function public.consume_insight(uuid, int, int) to service_role;
grant  execute on function public.refund_insight(uuid)            to service_role;
