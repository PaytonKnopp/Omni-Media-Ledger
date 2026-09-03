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
-- profile.
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

-- The app only shows Edit/Delete on a suggestion whose handle matches the current signed-in
-- handle -- but, same as every other "only touch your own" rule in this file (profiles, delete-my-
-- account), that's an app-side convenience, not something RLS can actually enforce: there's no
-- real per-request auth here, just a handle someone typed, so the policy itself has to stay open
-- (`using (true)`) exactly like profiles' update/delete policies already are.
drop policy if exists "suggestions are publicly updatable" on public.suggestions;
create policy "suggestions are publicly updatable"
  on public.suggestions for update
  using (true)
  with check (char_length(text) between 1 and 2000);

drop policy if exists "suggestions are publicly deletable" on public.suggestions;
create policy "suggestions are publicly deletable"
  on public.suggestions for delete
  using (true);

-- The update policy above only checks the new text's length -- it can't stop a client from ALSO
-- changing status/votes in the same request, since a WITH CHECK clause only sees the new row, not
-- old vs new. Column-level privileges close that gap where RLS can't reach: anon/authenticated can
-- update the text column only; status and votes stay off-limits to any direct client update no
-- matter what a crafted request tries to send. The suggestion_votes trigger further below still
-- works because it runs SECURITY DEFINER (as the function's owner), which bypasses this grant the
-- same way it bypasses RLS.
revoke update on public.suggestions from anon, authenticated;
grant update (text) on public.suggestions to anon, authenticated;

-- ── suggestion status + voting ──────────────────────────────────────────────────────────────
-- Lets the shared suggestion feed show what's actually being worked on (status) and which
-- requests people care about most (votes), instead of being a flat, unordered wall of text.
-- `status` is intentionally not client-writable -- the column-level grant above only lets anon
-- update suggestions.text, so it can only be changed from the SQL Editor (or a future admin view)
-- as the person triaging
-- suggestions, not by any anon-key client.
alter table public.suggestions
  add column if not exists status text not null default 'open',
  add column if not exists votes integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suggestions_status_check'
  ) then
    alter table public.suggestions
      add constraint suggestions_status_check
      check (status in ('open','planned','shipped','declined'));
  end if;
end;
$$;

-- One row per (suggestion, handle) so a handle can only cast one vote per suggestion -- an honor
-- system, same as every other handle-based check in this file (a handle is a name, not a verified
-- identity), but enough to stop an accidental double-click from double-counting.
create table if not exists public.suggestion_votes (
  suggestion_id bigint not null references public.suggestions(id) on delete cascade,
  handle text not null,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, handle)
);

-- Keeps suggestions.votes as a denormalized, fast-to-read count instead of making every list
-- render do a count(*) join -- maintained here, not trusted from the client.
create or replace function public.sync_suggestion_vote_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.suggestions set votes = votes + 1 where id = new.suggestion_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.suggestions set votes = greatest(votes - 1, 0) where id = old.suggestion_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists suggestion_votes_sync on public.suggestion_votes;
create trigger suggestion_votes_sync
  after insert or delete on public.suggestion_votes
  for each row execute function public.sync_suggestion_vote_count();

alter table public.suggestion_votes enable row level security;

drop policy if exists "suggestion votes are publicly readable" on public.suggestion_votes;
create policy "suggestion votes are publicly readable"
  on public.suggestion_votes for select
  using (true);

drop policy if exists "suggestion votes are publicly insertable" on public.suggestion_votes;
create policy "suggestion votes are publicly insertable"
  on public.suggestion_votes for insert
  with check (true);

-- Delete (not update) is how a vote is retracted -- remove your row rather than flip a flag.
drop policy if exists "suggestion votes are publicly deletable" on public.suggestion_votes;
create policy "suggestion votes are publicly deletable"
  on public.suggestion_votes for delete
  using (true);

-- ── media_status ────────────────────────────────────────────────────────────────────────────
-- One row per (handle, title) the app is tracking a tier and/or ownership for -- a normalized,
-- queryable mirror of what profiles.data's declaredGoatIds/silverTierIds/bronzeTierIds/
-- ownedMedia/ownedGameIds/ownedBooksExtra already encode inside the jsonb blob. profiles.data
-- stays the source of truth the app restores a whole profile from in one atomic round trip; this
-- table exists so gold/silver/bronze/owned status -- the exact signals that drive the
-- recommendation engine -- are queryable per title instead of locked inside one opaque blob, and
-- so a future feature (friends' overlap, "who else owns this," leaderboards) can query across
-- handles without parsing everyone's jsonb. `media_id` is whatever id the app's own corpus uses
-- (e.g. "m09", "t03", "g45", "b19") -- there's no corpus table in this DB to foreign-key against
-- (see NOTES.md "Made genuinely offline" for why the corpus stays in data/*.js, not here), so this
-- is trusted the same way every other client-supplied value in this file is.
-- The app keeps this in sync with the jsonb blob on every tier/own change -- see index.html's
-- diffMediaStatus / reloadWithMediaSync (ledger-app) and syncMediaStatusRows (acct-boot).
create table if not exists public.media_status (
  handle text not null,
  media_id text not null,
  tier text,
  owned boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (handle, media_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_status_tier_check'
  ) then
    alter table public.media_status
      add constraint media_status_tier_check
      check (tier is null or tier in ('gold','silver','bronze'));
  end if;
end;
$$;

create index if not exists media_status_media_id_idx on public.media_status (media_id);

create or replace function public.stamp_media_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists media_status_stamp on public.media_status;
create trigger media_status_stamp
  before insert or update on public.media_status
  for each row execute function public.stamp_media_status_updated_at();

alter table public.media_status enable row level security;

drop policy if exists "media status is publicly readable" on public.media_status;
create policy "media status is publicly readable"
  on public.media_status for select
  using (true);

drop policy if exists "media status is publicly insertable" on public.media_status;
create policy "media status is publicly insertable"
  on public.media_status for insert
  with check (true);

drop policy if exists "media status is publicly updatable" on public.media_status;
create policy "media status is publicly updatable"
  on public.media_status for update
  using (true)
  with check (true);

-- Delete is how the app removes a tier/own status entirely (an item with no tier and not owned
-- has nothing left to track, so the row is dropped rather than kept as all-false/all-null).
drop policy if exists "media status is publicly deletable" on public.media_status;
create policy "media status is publicly deletable"
  on public.media_status for delete
  using (true);

-- ── friends ─────────────────────────────────────────────────────────────────────────────────
-- A directed "handle follows friend_handle" edge -- backing for a real Compare/leaderboard
-- feature (the app today only compares against a manually exported/imported file). Directed
-- rather than a mutual-friendship model so following someone doesn't require their action first,
-- same low-friction, no-real-auth spirit as everything else in this file.
create table if not exists public.friends (
  handle text not null,
  friend_handle text not null,
  created_at timestamptz not null default now(),
  primary key (handle, friend_handle),
  check (handle <> friend_handle)
);

create index if not exists friends_friend_handle_idx on public.friends (friend_handle);

alter table public.friends enable row level security;

drop policy if exists "friends are publicly readable" on public.friends;
create policy "friends are publicly readable"
  on public.friends for select
  using (true);

drop policy if exists "friends are publicly insertable" on public.friends;
create policy "friends are publicly insertable"
  on public.friends for insert
  with check (true);

-- Delete is how you unfollow.
drop policy if exists "friends are publicly deletable" on public.friends;
create policy "friends are publicly deletable"
  on public.friends for delete
  using (true);

-- ── profile_snapshots ───────────────────────────────────────────────────────────────────────
-- A rolling backup of the last 20 versions of each handle's profile, captured automatically
-- right before any update or delete -- so "Delete my account" (and any accidental overwrite from
-- a stale second tab) is recoverable instead of instantly and permanently destructive. Populated
-- only by the trigger below, which runs SECURITY DEFINER (as the function's owner, which bypasses
-- RLS in Supabase) specifically so an anon-key client can trigger a capture but can't directly
-- insert, edit, or delete snapshot rows itself -- there is deliberately no insert/update/delete
-- policy on this table for that reason. `set search_path` is pinned to block search-path
-- hijacking, standard practice for any SECURITY DEFINER function.
create table if not exists public.profile_snapshots (
  id bigint generated always as identity primary key,
  handle text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_snapshots_handle_idx
  on public.profile_snapshots (handle, created_at desc);

create or replace function public.capture_profile_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profile_snapshots (handle, data) values (old.handle, old.data);
  delete from public.profile_snapshots
   where handle = old.handle
     and id not in (
       select id from public.profile_snapshots
        where handle = old.handle
        order by created_at desc
        limit 20
     );
  return old;
end;
$$;

drop trigger if exists profiles_snapshot on public.profiles;
create trigger profiles_snapshot
  before update or delete on public.profiles
  for each row execute function public.capture_profile_snapshot();

alter table public.profile_snapshots enable row level security;

-- Read-only to clients (a handle can look back at its own history); no client-side writes, see
-- the table comment above.
drop policy if exists "profile snapshots are publicly readable" on public.profile_snapshots;
create policy "profile snapshots are publicly readable"
  on public.profile_snapshots for select
  using (true);

-- ── hardening pass ──────────────────────────────────────────────────────────────────────────
-- Added after confirming the schema above was live and working. Three things:
--
-- 1. media_id gets a real shape check, matching every other client-supplied text column in this
--    file already being bounded (see suggestions.text's char_length check above) -- there was
--    nothing stopping an arbitrarily large or malformed value before this.
--
-- 2. media_status and friends now foreign-key back to profiles.handle, ON DELETE CASCADE. This
--    fixes a real gap: "Delete my account" already tells the user it "permanently removes your
--    synced profile, watchlist, and preferences from the server," but until now it only ever
--    deleted the profiles row -- a handle's media_status (tier/owned) rows and friends edges were
--    silently left behind forever. The cascade makes the DB enforce what the UI already promises,
--    with no app change needed on top of it.
--    suggestions.handle and suggestion_votes.handle are deliberately NOT foreign-keyed: a guest
--    (no cloud handle) submitting a suggestion writes handle='anonymous' (see the suggestion box
--    in index.html), which isn't a real profiles row -- an FK here would break that path outright.
--    profile_snapshots.handle is deliberately NOT foreign-keyed either: its whole purpose is to
--    outlive the profiles row it's a backup of, so tying its lifetime to that row would defeat it.
--
-- 3. A defensive per-handle row cap on media_status and friends, same spirit as the existing
--    200KB cap on profiles.data: not a real security boundary (the anon key is public by design;
--    this can't stop a determined actor with their own Postgres client), just a backstop against
--    a client-side bug (a runaway loop) quietly ballooning one handle's row count forever. The
--    corpus is 2,508 works total, so 3,000 is generous headroom for media_status; 1,000 is
--    generous for a friends list. Only counts against the cap when the row is genuinely new (not
--    already tracked for that handle), so re-tiering something you already track never trips it.

alter table public.media_status
  drop constraint if exists media_status_length_check;
alter table public.media_status
  add constraint media_status_length_check
  check (char_length(media_id) between 1 and 20);

alter table public.media_status
  drop constraint if exists media_status_handle_fkey;
alter table public.media_status
  add constraint media_status_handle_fkey
  foreign key (handle) references public.profiles (handle) on delete cascade;

alter table public.friends
  drop constraint if exists friends_handle_fkey;
alter table public.friends
  add constraint friends_handle_fkey
  foreign key (handle) references public.profiles (handle) on delete cascade;

alter table public.friends
  drop constraint if exists friends_friend_handle_fkey;
alter table public.friends
  add constraint friends_friend_handle_fkey
  foreign key (friend_handle) references public.profiles (handle) on delete cascade;

create or replace function public.enforce_media_status_row_cap()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.media_status where handle = new.handle and media_id = new.media_id)
     and (select count(*) from public.media_status where handle = new.handle) >= 3000 then
    raise exception 'media_status row cap reached for this handle';
  end if;
  return new;
end;
$$;

drop trigger if exists media_status_row_cap on public.media_status;
create trigger media_status_row_cap
  before insert on public.media_status
  for each row execute function public.enforce_media_status_row_cap();

create or replace function public.enforce_friends_row_cap()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.friends where handle = new.handle and friend_handle = new.friend_handle)
     and (select count(*) from public.friends where handle = new.handle) >= 1000 then
    raise exception 'friends row cap reached for this handle';
  end if;
  return new;
end;
$$;

drop trigger if exists friends_row_cap on public.friends;
create trigger friends_row_cap
  before insert on public.friends
  for each row execute function public.enforce_friends_row_cap();
