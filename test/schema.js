#!/usr/bin/env node
/*
 * Checks on supabase/schema.sql.
 *
 * These exist because of a bug the browser suite structurally could not catch: it runs against a
 * mocked Supabase, so no amount of front-end testing can see what real Postgres does with a
 * trigger. The bug was capture_profile_snapshot() -- a BEFORE UPDATE trigger ending in
 * `return old;`. The return value of a BEFORE trigger becomes the row that gets written, so every
 * update to an existing profile silently stored the previous version and discarded the new one,
 * while reporting success and bumping updated_at. Brand-new accounts (INSERT, no OLD row) saved
 * perfectly; every established account discarded every change forever.
 *
 * Two layers here:
 *   1. Static checks that always run, encoding the specific traps already hit.
 *   2. Live checks against a real database when OMNI_TEST_DATABASE_URL is set (skipped otherwise,
 *      so `npm test` still works on a machine with no Postgres).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = path.join(ROOT, 'supabase', 'schema.sql');
let failures = 0;

function check(label, ok, detail) {
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' - ' + label);
  if (!ok) { failures++; if (detail) console.log('       ' + detail); }
}

const sql = fs.readFileSync(SCHEMA, 'utf8');

console.log('\n=== supabase/schema.sql - static checks ===');

// 1. The BEFORE-trigger return-value trap.
const fnBodies = {};
for (const m of sql.matchAll(/create or replace function public\.(\w+)\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)) {
  fnBodies[m[1]] = m[2];
}
const beforeUpdateTriggers = [];
for (const m of sql.matchAll(/create trigger (\w+)\s+([\s\S]*?)execute function public\.(\w+)\(\)/g)) {
  const [, name, clause, fn] = m;
  if (/before/i.test(clause) && /update/i.test(clause)) beforeUpdateTriggers.push({ name, fn });
}
check('found at least one BEFORE UPDATE trigger to check', beforeUpdateTriggers.length > 0);
for (const t of beforeUpdateTriggers) {
  const body = fnBodies[t.fn];
  if (!body) { check(t.name + ': its function is defined in this file', false); continue; }
  // A BEFORE UPDATE trigger must be able to return NEW. Returning only OLD silently discards the
  // caller's write; that is the exact bug this file exists to prevent recurring.
  const canReturnNew = /return\s+new\s*;/i.test(body);
  check(t.name + ' (' + t.fn + ') can return NEW, so an UPDATE keeps the new row',
    canReturnNew,
    'a BEFORE UPDATE trigger that only ever returns OLD makes every update silently store the old row');
  if (/return\s+old\s*;/i.test(body)) {
    check(t.name + ' guards its `return old` behind a DELETE check',
      /tg_op\s*=\s*'DELETE'/i.test(body),
      'returning OLD is only correct for DELETE');
  }
}

// 2. A column must exist before it is granted -- the Supabase SQL Editor runs a pasted script as
//    one transaction, so a single failing statement rolls the whole file back and the person sees
//    no effect from "re-running the schema".
const grantCols = [...sql.matchAll(/grant\s+update\s*\(([^)]*)\)\s*on\s+public\.(\w+)/gi)];
for (const g of grantCols) {
  const cols = g[1].split(',').map(s => s.trim());
  const table = g[2];
  const grantAt = g.index;
  for (const col of cols) {
    const addRe = new RegExp('alter table public\\.' + table + '[\\s\\S]*?add column if not exists\\s+' + col + '\\b', 'i');
    const add = sql.match(addRe);
    const declaredInCreate = new RegExp('create table if not exists public\\.' + table + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i').exec(sql);
    const inCreate = declaredInCreate && new RegExp('\\b' + col + '\\b').test(declaredInCreate[1]);
    const ok = inCreate || (add && add.index < grantAt);
    check('grant update(' + col + ') on ' + table + ' comes after that column exists', !!ok,
      'the SQL Editor runs the file as one transaction, so this error would roll back everything');
  }
}

// 3. profiles must keep all four policies, or writes fail in ways that are hard to read.
for (const cmd of ['select', 'insert', 'update', 'delete']) {
  check('profiles has a ' + cmd.toUpperCase() + ' policy',
    new RegExp('on public\\.profiles for ' + cmd, 'i').test(sql));
}

// ---------------------------------------------------------------------------------------------
const url = process.env.OMNI_TEST_DATABASE_URL;
if (!url) {
  console.log('\n=== live database checks - SKIPPED ===');
  console.log('  set OMNI_TEST_DATABASE_URL to a throwaway Postgres to run these');
} else {
  console.log('\n=== live database checks ===');
  const psql = (args, input) => execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', ...args],
    { input, encoding: 'utf8' });
  // Run a statement as a specific role. PGOPTIONS sets it on the connection rather than prefixing
  // `set role anon;` to the SQL: chaining two statements in one -c makes psql print the SET's
  // command tag and the INSERT's row count around the value you actually wanted, so the result is
  // "SET\ndbg\nINSERT 0 1" and every comparison against it fails for a reason that has nothing to
  // do with the database.
  const psqlAs = (role, sqlText) => execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sqlText],
    { encoding: 'utf8', env: Object.assign({}, process.env, { PGOPTIONS: '-c role=' + role }) });
  try {
    psql(['-c', 'drop schema public cascade; create schema public;']);
    // `anon` and `authenticated` are roles Supabase creates for every project; a bare Postgres has
    // neither, and schema.sql revokes/grants against both. Without them the very first grant fails
    // with `role "anon" does not exist` and nothing else in these checks ever runs.
    //
    // This belongs here rather than in schema.sql: on a real Supabase project those roles already
    // exist, so a `create role` in the schema would be wrong (and, run as the SQL Editor's user,
    // would likely fail outright). It is test scaffolding standing in for what the platform
    // provides -- which means these checks verify the schema, not Supabase.
    psql(['-c', `do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;`]);
    // Supabase also grants those roles usage on `public` and table privileges by default, via
    // ALTER DEFAULT PRIVILEGES -- which is why an app using the anon key can touch a table the
    // schema file never explicitly grants. Reproducing it the same way matters: setting the
    // default BEFORE schema.sql runs means the tables it creates inherit these grants, while its
    // own explicit `revoke update on suggestions` still runs afterwards and wins. Granting
    // blanket privileges after the fact instead would silently undo that revoke and hide it.
    psql(['-c', `grant usage on schema public to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;`]);
    psql(['-f', SCHEMA]);
    check('schema applies cleanly to an empty database', true);
    psql(['-f', SCHEMA]);
    check('schema is idempotent (applies twice)', true);

    // The actual bug: an UPDATE to an existing profile must keep what was sent.
    psql(['-c', `insert into public.profiles(handle,data) values ('t','{"omniLedgerTheme":""}'::jsonb);`]);
    psql(['-c', `insert into public.profiles(handle,data) values ('t', jsonb_build_object('omniLedgerProfile', repeat('x',6248),'omniLedgerTheme','johnny-cash')) on conflict (handle) do update set data = excluded.data;`]);
    const chars = psql(['-c', `select coalesce(length(data->>'omniLedgerProfile'),0) from public.profiles where handle='t';`]).trim();
    check('updating an existing profile stores the new data, not the old row', chars === '6248',
      'stored ' + chars + ' chars of omniLedgerProfile, expected 6248');
    const theme = psql(['-c', `select data->>'omniLedgerTheme' from public.profiles where handle='t';`]).trim();
    check('updating an existing profile stores the new theme', theme === 'johnny-cash', 'got: ' + theme);

    const snaps = psql(['-c', `select count(*) from public.profile_snapshots where handle='t';`]).trim();
    check('the previous version is still snapshotted on update', Number(snaps) >= 1);

    psql(['-c', `delete from public.profiles where handle='t';`]);
    const left = psql(['-c', `select count(*) from public.profiles where handle='t';`]).trim();
    check('deleting a profile still works', left === '0');

    // Everything above runs as the superuser, which bypasses RLS entirely -- so it proves the
    // triggers and constraints are right while saying nothing about the policies. The policies are
    // the half that actually lost someone's data: Postgres applies an UPDATE policy's USING clause
    // to `INSERT ... ON CONFLICT DO UPDATE` as a silent FILTER, so a refused write returns 2xx with
    // zero rows and no error. The app now defends against that by reading back what it wrote
    // (pushSnapshot in index.html); these checks confirm the database side is right in the first
    // place, from the same role the browser actually uses.
    // psql prints the command tag ("INSERT 0 1") on its own line after the RETURNING row even
    // under -t -A, so take the first line: the value, not the tag.
    //
    // A refused write is returned, not thrown. Depending on the statement shape Postgres either
    // filters the row out silently (empty result) or raises -- and both are the SAME defect from
    // the app's side. Letting the raise escape would abort the whole live block and report the
    // generic "live database checks ran", three checks away from the policy that actually broke.
    const asAnon = (sqlText) => {
      try { return psqlAs('anon', sqlText).trim().split('\n')[0].trim(); }
      catch (e) {
        const line = String(e.stderr || e.message || e).split('\n').find(l => /ERROR/.test(l));
        return '<refused: ' + (line || 'no rows').trim() + '>';
      }
    };

    const anonInsert = asAnon(`insert into public.profiles(handle,data)
      values ('rls','{"omniLedgerProfile":"first"}'::jsonb) returning handle;`).trim();
    check('the anon role can create a profile (INSERT policy admits it)', anonInsert === 'rls');

    // The exact shape the app sends. Returning zero rows here is the silent refusal.
    const anonUpsert = asAnon(`insert into public.profiles(handle,data)
      values ('rls','{"omniLedgerProfile":"second"}'::jsonb)
      on conflict (handle) do update set data = excluded.data returning handle;`).trim();
    check('an anon upsert over an existing profile writes a row, not silently zero', anonUpsert === 'rls',
      'zero rows back means an RLS policy is filtering the write -- 2xx, no error, nothing saved');
    const anonStored = psql(['-c', `select data->>'omniLedgerProfile' from public.profiles where handle='rls';`]).trim();
    check('...and the upserted value is what actually landed', anonStored === 'second', 'got: ' + anonStored);

    const anonMedia = asAnon(`insert into public.media_status(handle,media_id,tier,owned)
      values ('rls','m09','gold',false)
      on conflict (handle,media_id) do update set tier = excluded.tier returning media_id;`).trim();
    check('the anon role can upsert a media_status row', anonMedia === 'm09');

    // The one guard that is meant to fail loudly rather than quietly edit someone's data.
    let capRaised = false;
    try {
      psql(['-c', `insert into public.profiles(handle,data)
        values ('big', jsonb_build_object('omniLedgerProfile', repeat('x', 250000)));`]);
    } catch (e) { capRaised = /too large/i.test(String(e.stderr || e.message || e)); }
    check('an oversized profile is rejected with a clear error, not silently truncated', capRaised);

    psql(['-c', `delete from public.profiles where handle in ('rls','big');`]);
    const cascaded = psql(['-c', `select count(*) from public.media_status where handle='rls';`]).trim();
    check('deleting a profile cascades away its media_status rows', cascaded === '0',
      'the account-delete UI promises this; the FK is what makes it true');
  } catch (e) {
    check('live database checks ran', false, String(e.message || e).split('\n').slice(0, 4).join(' | '));
  }
}

console.log('\n' + (failures === 0 ? 'Schema checks passed.' : failures + ' schema check(s) failed.'));
process.exit(failures === 0 ? 0 : 1);
