# Working agreement: testing during a session

CI (`.github/workflows/test.yml`) runs the full suite on every pull request,
once per push (a newer push cancels the older run). That is the gate. Local
runs exist to get changes committed to the branch quickly, not to re-prove
what CI is about to prove anyway.

There are two tiers of checks:

| Command                  | What it covers                                        | Time    |
|--------------------------|-------------------------------------------------------|---------|
| `npm run lint`           | ESLint, including the no-fixed-sleeps rule for tests  | ~3s     |
| `npm run test-fast`      | corpus validation, schema, fact/substance/score harnesses, no prose in committed evidence | ~15s |
| `npm run test-browser`   | the Playwright suite, `test/regression.js`            | ~7 min  |

`npm test` runs both tiers in order.

Rules for Claude when making changes in this repo:

1. **Before committing and pushing to a branch, run `npm run lint` and
   `npm run test-fast`. That's all.** Do not run `npm test` or
   `npm run test-browser` as a pre-commit step. CI runs it on the PR.
   While iterating, it's fine to run only the scoped check for what changed
   (`npm run test-schema`, `npm run test-facts`,
   `node scripts/validate-corpus.js`).
2. **Run the browser suite only when it is the point of the work:** a change
   to `test/regression.js` itself, or fixing a regression check that failed
   on CI. Even then, run just the affected flow with
   `node test/regression.js --only=<part of the flow name>` (flow names are
   the `=== ... ===` headers it prints), which takes seconds instead of
   minutes. A full run is only warranted if the user asks for one.
3. **A CI failure is real until proven otherwise.** The suite no longer
   sleeps on the clock (see "Never sleep a fixed number of milliseconds" in
   ARCHITECTURE.md), so a red check is expected to mean something. Don't
   re-run CI hoping for green. Reproduce the failing flow with `--only`,
   and if it only fails on CI, add `OMNI_THROTTLE=4` (slows every page's CPU
   4x, like a busy runner). If it genuinely flaked, say so explicitly, name
   the check, and fix the wait it depends on. Don't lengthen a timeout.
4. **In `test/regression.js`, never wait on the app with
   `waitForTimeout(N)`.** Use `settle(page)`, `waitForBoot(page)` or
   `readWhen(...)`. Lint enforces this. Sleeps racing a slow runner were
   the cause of the suite's chronic flakiness.

Goal: changes get committed to the branch in seconds of checking, and the
full suite runs exactly once per PR push, on CI, where its result is trusted.
