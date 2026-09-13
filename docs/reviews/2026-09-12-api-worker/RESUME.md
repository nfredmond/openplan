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

## Immediate next

1. Build live worker acceptance with real PostgREST, the real SDK and a loopback
   HTTP response fixture. Use the named disposable stack below and launch the
   actual scripts/workers/provider-api.ts process, not only the in-process cycle.
   Test both saved-key and explicit keyless modes, exact packet/model/revision
   receipt, one dispatch reservation, no business action, and no ambient key.
2. Prove response loss after completion commit retries only delivery; process
   interruption while generating leaves a running journal that restarts as a
   failed/interrupted request without a second model call. Check cancellation,
   edit/revocation, private access, corrupt journal, lost lock and retry recovery.
   Use real fake-provider request counts and retained checksums/identities.
3. Run appropriate mutation controls for new checks; keep sources restored.
   Then full QA/shuffle and final applicable database checks before landing this
   worker increment directly on main. The shared native lock fix is included.
4. Join the api_connection POST discriminator and ProjectProviderPanel, including
   its browser-safe turn decoder. Exact saved revision/config hash/model/auth/
   charge acknowledgement must survive uncertain retries and history. Use the
   existing approval flow; generation only proposes. No inline web generation.
5. Accept real navigation on an identified build at desktop and 390px with
   keyboard and console evidence, response-loss recovery, config changes,
   private history and immutable original receipts. Only then remove settings'
   generation-unavailable wording. Inspect final main CI before a release tag.

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
