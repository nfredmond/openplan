# Resume real API worker process acceptance

Full v1 goal remains active; v0.54.0 is already released. Main is
b6dbb8ca4d0a69986dd897285f2c6766184c4a42 with successful CI 34725416835,
RLS Isolation 34725416839 and Upgrade Path 34725416832. All five CI jobs passed,
including full QA and shuffled tests. Continue roadmap A0b, not old releases.

Implementation checkout:
/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Package openplan/, branch work/planner-agent-api-connections. No other coding
session or browser collection was observed here. Preserve the root checkout,
demo, unrelated reminder constraint and private credentials. No PR or tag.

## Current worker implementation

- src/lib/assistant/provider-api-worker.ts owns one cycle under the existing OS
  lock. It validates a retained API claim, writes a running journal, loads the
  exact credential revision, observes cancellation/access/lease state, invokes
  the existing generation adapter, syncs completion, and uses the common finish
  RPC. Running-journal recovery interrupts without generation; completed-journal
  retry neither claims nor generates. It never adds a second usage event.
- scripts/workers/provider-api.ts plus npm run worker:provider-api provide a local
  loop or --once. The default private directory is derived from the Supabase URL;
  OPENPLAN_PROVIDER_API_WORK_DIR overrides it. The journal retains the exact target.
- workers/planner_agent_connector/connector-worker.mjs now uses flock --no-fork
  and checks both child exitCode and signalCode during release. The new process-
  loss test found the prior real 20-second cleanup hang. Only the test's own
  newly created child is terminated. Never kill another agent's worker.
- SELF_HOSTING documents the worker as in development. Project UI and POST
  selection are not joined; this is not a released generation option.

## Evidence completed on this branch

38 worker cases use real private files/flock but mocked database and generation.
The final restored replay with adapter, decoder and existing API/route tests
passed 176 cases in five files. TypeScript and changed-file ESLint passed.
The native connector replay passed 382 cases, four skipped. The real command
started once against the named disposable DB and reported idle, with zero active
API jobs before startup. That proves startup/import/empty-queue behavior only.

Mutation exec 19500 is terminal, exit one. Its initial report is retained:
Vitest rejects-match errors were misclassified by the runner, the redaction test
missed a canary sent to the finish RPC, and cleanup aborts could mask missed
polling in the fake provider. The tests and explicit failure matching are fixed.
Revised exec 94783 is terminal, exit zero: one harmless survivor, 42 targeted
failures. Both source files were restored and hashed. Recovery state:
/tmp/openplan-api-worker-mutations-fkpjR0/state.json, phase restored.
The stronger lock-loss test has a named cleanup deadline, not an unexplained
whole-file timeout. VERIFICATION.md records the defects and blind categories.

Final replay handles are all terminal: 60372 focused tests, 78388 native suite,
98698 TypeScript and 87510 ESLint, all exit zero. No test, mutation or browser
server is running. Do not restart those handles.

## Usage-reset checkpoint

The real-process live suite now exists in
openplan/src/test/provider-api-worker-live.test.ts. Its corrected baseline passed
all 11 cases. The first run passed ten and failed access removal because its
fixture had only one owner; a second synthetic owner now preserves the existing
last-owner protection. No production guard was weakened.

live-mutations.json records all seven completed cases: the harmless comment
passed all 11 tests, and six targeted faults failed the intended assertions.
These cover missing running/completed journals, forgotten crash recovery,
missed cancellation, changed deployment destination, and forbidden automatic
business-record creation. The worker source matches committed HEAD after
restoration. No mutation process or live worker remains running at checkpoint.
The new live test and mutation evidence are saved as unfinished implementation
work, not a release or a claim that full QA has passed.

The real child process uses actual PostgREST, the SDK and a synthetic loopback
model endpoint. It covers saved-key/keyless dispatch, exact original packet and
receipt, one reservation, completion response loss before/after database commit,
forced crash without a second model request, cancellation/edit/revoke/access
loss, corrupt journals and changed destination. It creates no real business
records and calls no external provider. Synthetic records remain only in the
named disposable stack.

## Worker gate completion

Full QA and shuffled seed 912555 passed 14,029 tests, 450 skipped. Native
connector passed 382, four skipped; audit zero vulnerabilities; webpack and
TypeScript passed. Full isolated RLS passed 479 tests in 50 files, including the
new eleven real-process cases now in test:rls-live. Nine lifecycle function
hashes match the retained source, and no active API jobs remain. The initial
full/shuffle failures exposed a missing .env.example entry for the documented
optional worker directory; that omission is fixed. local-checks.json and
VERIFICATION.md retain the results and limits. All local command handles are
terminal: 94900 corrected QA, 62688 corrected shuffle, 37658 RLS, all exit zero.

## Immediate next

1. Land the verified worker increment directly on main, inspect exact GitHub CI,
   RLS and upgrade jobs separately, and record the resulting commit/run IDs.
   No PR, no worker-only capability tag. Main was b6dbb8ca before this landing.
2. Join the api_connection POST discriminator and ProjectProviderPanel, including
   its browser-safe turn decoder. Exact saved revision/config hash/model/auth/
   charge acknowledgement must survive uncertain retries and history. Use the
   existing approval flow; generation only proposes. No inline web generation.
3. Accept real navigation on an identified build at desktop and 390px with
   keyboard and console evidence, response-loss recovery, config changes,
   private history and immutable original receipts. Only then remove settings'
   generation-unavailable wording. Inspect final main CI before a release tag.
4. Continue the full v1 roadmap under the active goal. A usage reset is not a
   completed goal. Recheck processes, git and serving identity when resuming.

## Isolated environment

Disposable stack:
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050
Container supabase_db_openplan-restore-target-2026091050, API29821/DB29822.
318 migrations including 20261012000002_assistant_api_turns.sql are applied.
Do not reset or reapply manually. API claim selects globally; do not overlap
live mutation/claim suites. Existing Vitest live mode serializes files.

Private files:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
api-settings.env selects the DB and operator encryption secret; do not print or
commit it or api-settings-account.json. The checkout .env.local points at an older
stack. Use getLocalSupabaseEnv/LIVE_RLS helpers for live tests and an explicit
OPENPLAN_SUPABASE_WORKDIR. Child workers need the same resolved URL/service key,
operator secret and an exact OPENPLAN_AI_LOCAL_ENDPOINTS loopback allowlist.

The prior SDK test's createServer fixture in provider-api-generation.test.ts
shows the real structured response format. prepareProviderApiRevision creates
proper immutable config/hash/encrypted envelopes. Real child tests should set
OPENPLAN_PROVIDER_API_WORK_DIR to a per-case private directory and preserve
undelivered journals when testing response loss. Never log keys or raw histories.
Native final log: api-worker-native-final.log under the private root. The idle
command used api-worker-smoke there. No external provider was called.
