# Saved API request endpoint checkpoint

Continue full v1 goal, roadmap A0b. v0.54.0 remains the published release.
The verified worker increment is on main at
47c4985e361936b1f47c25f874b382ef9c69e60e, landed directly without a PR.
Local full QA and shuffle passed 14,029 tests, 450 skipped; native connector
382 passed, four skipped; isolated RLS 479 passed in 50 files; webpack and
TypeScript passed; audit zero vulnerabilities. See ../2026-09-12-api-worker.
Main CI 34728670375 and RLS Isolation 34728670387 were in progress when this
checkpoint was prepared. Python worker, modeling and ops CI jobs were already
successful. Poll those exact runs; do not restart. No migration changed in the
worker increment, so no new automatic Upgrade Path run was triggered. The prior
migration-bearing main b6dbb8ca completed Upgrade Path 34725416832 successfully.
Inspect applicable final upgrade evidence again for the capability release.

Implementation checkout remains:
/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Package openplan/, branch work/planner-agent-api-connections. Another active
session is in Job Search. Root OpenPlan checkout and demo are untouched.
No browser server, local mutation or test command remains active at checkpoint.
Preserve unrelated reminder constraint and private credentials. No subagents.

## New endpoint implementation, not yet on main

src/app/api/assistant/providers/turns/route.ts now accepts provider api_connection
with exact connectionId, revisionId, configurationHash, model, one of the two
connection auth modes, and literal true acceptApiCharges. It uses the existing
project/member read and create_assistant_api_turn RPC. Generation is never
inline for this option. The worker owns dispatch and its usage reservation.
The returned row must match request/provider/model/question/scope and exact
owner/connection/revision/configuration hash. A new row must retain exactly the
just-read packet; a retry preserves the original older packet. The common
checkedProviderTurn decoder validates the frozen hash, model, auth and literal
charge acknowledgement. No key enters this route and no action is executed.
Legacy native and Anthropic paths remain covered separately.

provider-api-request-route.test.ts has 26 passing cases. Existing provider route
72 cases and worker 38 cases passed together, 136 total. The intended decoder
filter initially used a nonexistent filename; that three-file result did not
cover the decoder. The corrected separate provider-api-retained-turn.test.ts
replay passed all 19 cases. Final restored TypeScript and changed-file ESLint
passed. No full QA or browser claim is made for this new endpoint increment.

mutations.mjs completed 13 cases: one harmless comment survived, twelve faults
failed the intended assertions. They cover wrong RPC/arguments/charge validation,
owner/connection/revision/config binding, new-packet mismatch, rewriting an old
retry baseline, and accidental inline generation. Source was restored; private
recovery /tmp/openplan-api-request-route-mutations-vJROR0/state.json.
The route tests mock database responses; SQL/RLS and actual process evidence in
the worker/lifecycle notes protect different boundaries. They do not establish
browser reachability or live external-provider account support.

## Next

1. Inspect exact main CI/RLS runs above and repair any demonstrated failure.
2. Join ProjectProviderPanel and its browser-safe turn parser. Read existing
   workspace API settings/list metadata before adding another schema or fetch.
   Saved connections must use current immutable revision metadata, configured
   model choices and exact auth. Show selected endpoint, shared project/question
   scope and explicit charge acknowledgement. Support keyless local connections.
   Keep pending payload frozen across response loss and provider/config switches;
   history must retain the original API configuration after edit/revocation.
3. Keep proposal review on the existing approval flow. The settings currently
   say generation is unavailable; remove that wording only when the real path
   works. Polling, retry and cancellation must never execute a proposal.
4. Use identified-build real navigation on desktop and 390px, keyboard and console
   evidence. Run actual worker/SDK/local synthetic fixture through the UI; verify
   response loss, interrupted retry, config changes, private history and original
   packet/receipt retention. Existing Playwright harness is authorized.
5. Complete applicable full QA, shuffle, isolated RLS and upgrade checks; commit
   and push directly to main, inspect exact final CI, then tag the capability
   release. Preserve all remaining v1 and scientific obligations.

## Private environment

Named disposable Supabase workdir:
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050
Container supabase_db_openplan-restore-target-2026091050, API29821/DB29822.
318 migrations already applied. Do not reset/reapply. Never overlap live claim
or mutation suites; they share a global API queue. Last post-RLS queue was zero.
Use OPENPLAN_SUPABASE_WORKDIR explicitly and getLocalSupabaseEnv for fixtures.

Private environment and logs:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
api-settings.env selects the named stack and operator encryption secret;
api-settings-account.json has synthetic browser credentials. Do not print or
commit either. The checkout .env.local points to an older stack; override it.
No external paid model was called by the tests.
