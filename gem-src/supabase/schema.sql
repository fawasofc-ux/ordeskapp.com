-- ============================================================
--  Gem Business Dashboard — database schema
--  Run once in the Supabase SQL Editor (safe to re-run).
-- ============================================================
--
--  Notes on deliberate choices:
--
--  * Tables are prefixed gem_ so this project can host other apps later
--    (the Ordesk app is unrelated and must not collide).
--
--  * Primary keys are TEXT, not uuid, so the ids already in the browser
--    migrate across unchanged — no remapping, no broken references.
--
--  * date columns are TEXT on purpose. The existing ledgers contain empty
--    dates and mixed formats; storing them as text preserves the data
--    exactly as entered instead of failing the import. Ordering is still
--    correct because the app writes ISO (YYYY-MM-DD).
--
--  * Money is numeric (exact decimal), never float — no rounding drift.
--
--  * Every row carries an owner and RLS is enabled on every table, so a
--    row is only ever visible to the account that created it.
-- ============================================================

-- ---------- tables ----------

create table if not exists public.gem_trips (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  status     text not null default 'Open',
  updated_at timestamptz not null default now()
);

create table if not exists public.gem_sales (
  id             text primary key,
  owner          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date           text,
  gem_code       text,
  description    text,
  customer       text,
  trip_id        text,
  status         text not null default 'Pending',
  commission_pct numeric not null default 0,
  qty            numeric,
  amount         numeric not null default 0,
  returned       boolean not null default false,
  return_date    text,
  updated_at     timestamptz not null default now()
);

create table if not exists public.gem_purchases (
  id             text primary key,
  owner          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date           text,
  trip_id        text,
  pieces         numeric,
  funding_source text,
  description    text,
  amount         numeric not null default 0,
  updated_at     timestamptz not null default now()
);

create table if not exists public.gem_expenses (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        text,
  description text,
  category    text,
  trip_id     text,
  amount      numeric not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.gem_draws (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        text,
  description text,
  partner     text,
  trip_id     text,
  amount      numeric not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.gem_capital (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        text,
  description text,
  amount      numeric not null default 0,
  updated_at  timestamptz not null default now()
);

-- Settings are a single row per owner: profit shares, partners, categories,
-- and the two manual figures (inventory estimate, actual bank balance).
create table if not exists public.gem_settings (
  owner      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- indexes ----------

create index if not exists gem_sales_owner_idx     on public.gem_sales (owner);
create index if not exists gem_purchases_owner_idx on public.gem_purchases (owner);
create index if not exists gem_expenses_owner_idx  on public.gem_expenses (owner);
create index if not exists gem_draws_owner_idx     on public.gem_draws (owner);
create index if not exists gem_capital_owner_idx   on public.gem_capital (owner);
create index if not exists gem_trips_owner_idx     on public.gem_trips (owner);

-- ---------- row level security ----------
-- Without this, the public anon key could read every row. With it, the
-- database itself refuses to return rows that are not yours.

do $$
declare t text;
begin
  foreach t in array array[
    'gem_trips','gem_sales','gem_purchases','gem_expenses',
    'gem_draws','gem_capital','gem_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format(
      'create policy "owner_all" on public.%I for all to authenticated
         using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;

-- ---------- keep updated_at honest ----------

create or replace function public.gem_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'gem_trips','gem_sales','gem_purchases','gem_expenses',
    'gem_draws','gem_capital','gem_settings'
  ]
  loop
    execute format('drop trigger if exists gem_touch on public.%I', t);
    execute format(
      'create trigger gem_touch before update on public.%I
         for each row execute function public.gem_touch_updated_at()', t);
  end loop;
end $$;

-- ---------- live updates across devices ----------

do $$
declare t text;
begin
  foreach t in array array[
    'gem_trips','gem_sales','gem_purchases','gem_expenses',
    'gem_draws','gem_capital','gem_settings'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
