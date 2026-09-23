# Working agreement: testing during a session

CI (`.github/workflows/test.yml`) already runs the full suite once, only on
pull requests. Don't duplicate that work locally on every small edit — it
wastes time and, if `test/regression.js` (Playwright-driven) is flaky, means
paying the flake tax twice.

Rules for Claude when making changes in this repo:

1. **While iterating on a change within a session**, don't run `npm test`
   (the full suite) after every edit. Run only the check(s) relevant to what
   changed:
   - Touched `schema.sql` / DB logic → `npm run test-schema`
   - Touched corpus/fact-fetching scripts → `npm run test-facts` or
     `node scripts/validate-corpus.js`
   - Touched JS/general logic with no obvious scoped test → `npm run lint`
     is cheap and safe to run often; prefer it over the full suite for quick
     sanity checks.
2. **Run the full `npm test` suite once**, right before committing / opening
   or updating a PR — not after each intermediate tweak in the conversation.
3. **Flaky tests are a bug, not a normal cost.** If `npm test` fails and a
   re-run (with no code change) passes, say so explicitly and note which
   test flaked, rather than silently looping "test without it, then with
   it again." Flaky tests should get fixed or flagged, not routinely danced
   around.
   - To reproduce a CI-only failure locally, run
     `OMNI_THROTTLE=4 node test/regression.js` (slows every page's CPU 4x,
     which is what a busy CI runner does). Fix the wait, don't lengthen it.
   - In `test/regression.js`, never add `waitForTimeout(N)` to wait for the
     app. Use `settle(page)` / `waitForBoot(page)` / `readWhen(...)` — see
     "Never sleep a fixed number of milliseconds" in ARCHITECTURE.md.
     Sleeps racing a slow runner were the cause of the suite's chronic
     flakiness.
4. Since CI runs on the PR anyway, it's fine to treat the local full-suite
   run as a pre-push sanity check, not a hard gate that must be reconfirmed
   after every subsequent tiny fix — trust CI to catch anything a last-minute
   change might have broken, and address it there if it does.

Goal: fast iteration locally, full confidence from CI on the PR, without
running the same expensive suite two or three times for one logical change.
