-- refynr — shared cleaning-recipe library
-- Run in the Supabase SQL editor (or `supabase db push`) after 0001.
--
-- Model:
--   cloud_recipes   a user's saved recipes, synced across devices, optionally
--                   shared with everyone signed into this refynr instance
--                   (a team/org library). Recipes are pure config — NO cell
--                   data — so storing them server-side leaks nothing.
--
-- Unlike the insight-metering tables, recipe CRUD is safe to do directly from
-- the browser client under row-level security: every row is owned by a user,
-- and the policies below let you write only your own and read your own + shared.

create table if not exists public.cloud_recipes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  recipe     jsonb not null,
  visibility text not null default 'private'
             check (visibility in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One recipe per name per user — the upsert target when re-pushing a recipe.
create unique index if not exists cloud_recipes_user_name_idx
  on public.cloud_recipes (user_id, name);

create index if not exists cloud_recipes_shared_idx
  on public.cloud_recipes (visibility) where visibility = 'shared';

-- Keep updated_at honest on every write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cloud_recipes_touch on public.cloud_recipes;
create trigger cloud_recipes_touch
  before update on public.cloud_recipes
  for each row execute function public.touch_updated_at();

-- ── row-level security ──────────────────────────────────────────────────────
alter table public.cloud_recipes enable row level security;

-- Read: your own recipes, plus any shared with the instance.
drop policy if exists "read own or shared" on public.cloud_recipes;
create policy "read own or shared" on public.cloud_recipes
  for select using (auth.uid() = user_id or visibility = 'shared');

-- Write: only your own rows, and only as yourself.
drop policy if exists "insert own" on public.cloud_recipes;
create policy "insert own" on public.cloud_recipes
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own" on public.cloud_recipes;
create policy "update own" on public.cloud_recipes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own" on public.cloud_recipes;
create policy "delete own" on public.cloud_recipes
  for delete using (auth.uid() = user_id);
