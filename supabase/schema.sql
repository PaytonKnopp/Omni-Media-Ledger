-- Omni-Media Ledger — cloud accounts + suggestion box schema.
--
-- Run this once, in full, in your Supabase project's SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste this whole file -> Run). It's idempotent (safe to re-run) via IF NOT EXISTS /
-- OR REPLACE / DROP POLICY IF EXISTS guards.
--
-- See NOTES.md -> "Cloud accounts (Supabase)" for the full write-up of the trust model this
-- mirrors: handles are just names, not verified identities (no password, no email) -- this is a
-- friend-group convenience, not a real security boundary. What the policies below DO provide is
-- confining the anon (publishable) key -- which ships inside index.html and is visible to anyone
-- who views source -- to exactly the shape this app actually uses, so a leaked/scraped key can't
-- be used to read or write arbitrary unrelated data in the project.

-- ── profiles ────────────────────────────────────────────────────────────────────────────────
-- One row per handle. `data` holds the same 6 localStorage keys the old Firestore doc held,
-- nested as a single jsonb object rather than 6 top-level fields -- Postgres has no equivalent of
-- Firestore's flat-document-of-fields shape, and one jsonb column is the natural fit.
create table if not exists public.profiles (
  handle text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Validates data's keys instead of trusting the client, and stamps updated_at server-side
-- (a client clock is never trustworthy) -- both regardless of what the anon key is used to send.
create or replace function public.validate_omni_profile_data()
returns trigger
language plpgsql
as $$
declare
  allowed text[] := array[
    'omniLedgerProfile','omniLedgerWatchlist','omniLedgerTheme',
    'omniLedgerDensity','omniLedgerOnboarded','omniLedgerTipsDismissed'
  ];
begin
  if not (array(select jsonb_object_keys(new.data)) <@ allowed) then
    raise exception 'profiles.data contains an unexpected key';
  end if;
  if pg_column_size(new.data) > 200000 then
    raise exception 'profiles.data is too large (limit ~200KB)';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_validate on public.profiles;
create trigger profiles_validate
  before insert or update on public.profiles
  for each row execute function public.validate_omni_profile_data();

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "profiles are publicly writable" on public.profiles;
create policy "profiles are publicly writable"
  on public.profiles for insert
  with check (true);

drop policy if exists "profiles are publicly updatable" on public.profiles;
create policy "profiles are publicly updatable"
  on public.profiles for update
  using (true)
  with check (true);

-- The app's "Delete my account" (header -> Account menu, only shown when signed into a real
-- handle) deletes its own profile row by handle. Same trust model as select/insert/update: a
-- handle is a name, not a verified identity, so this can't confirm "the real you" any more than
-- overwriting already couldn't -- it's gated behind an explicit confirm() in the UI, not here.
drop policy if exists "profiles are publicly deletable" on public.profiles;
create policy "profiles are publicly deletable"
  on public.profiles for delete
  using (true);

-- ── suggestions ─────────────────────────────────────────────────────────────────────────────
-- A flat, shared feed everyone using the app reads and writes to -- not nested under any one
-- profile. Only ever inserted into and read from; nothing in the app updates or deletes a row.
create table if not exists public.suggestions (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 1 and 2000),
  handle text,
  created_at timestamptz not null default now()
);

alter table public.suggestions enable row level security;

drop policy if exists "suggestions are publicly readable" on public.suggestions;
create policy "suggestions are publicly readable"
  on public.suggestions for select
  using (true);

drop policy if exists "suggestions are publicly insertable" on public.suggestions;
create policy "suggestions are publicly insertable"
  on public.suggestions for insert
  with check (char_length(text) between 1 and 2000);

-- No update/delete policy on suggestions either, for the same reason as above.
