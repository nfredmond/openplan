# A0 usage-limit candidate requires three source corrections

October 16, 2026. Independent source and pure-function review of exact commit
`7048efd372edce210e8af5438aa7775f7d359739`, parent
`bbbcfcc56e293cbf5fad105d0bfaf3ce94da1ffc`.

**Disposition: three P2 findings, no P1 finding. Correct standard test integration,
reset-bucket attribution and migration function configuration before integrating
this candidate.** The remaining scoped implementation supports the limited source
claims described below. This review does
not accept migration 18, native SQL, RLS, installed CLI operation, or the visible
workflow. A0/T1 and T15 remain partial.

## P2-1: Make the new worker test run through the existing commands

Location: `workers/planner_agent_connector/test/usage-limit.test.mjs:14`.
The new test throws at module load unless `OPENPLAN_USAGE_TEST_TMP` is set.
The README's root-level `node --test workers/planner_agent_connector/test/*.test.mjs`
and `openplan/package.json:54` include this file without supplying that variable.
The package's `qa:gate` invokes `test:provider-connector`; the actual CI QA step
invokes that gate and supplies no such variable. None of these runner files
changes in the candidate. Therefore the normal connector command and CI gate
cannot pass this new file in their documented environment, even if the rest of
their tests pass. The private checker setup masks this integration failure.

A targeted load with the variable explicitly unset exits 1 with
`Set the private usage-limit test directory`, before registering any test cases.
The private `unset-worker-test.log` and JSON receipt preserve this observation.
No native process, account or network call executes. This isolated check completed
before the parent's matching result arrived. It is not rerun afterward. The
parent's `a0-parent-standard-command-20261016/result.json` and `standard-env.log`
independently report the same outcome; the log SHA-256 is
`2d5659f94200016a0e5754f19d71d4ba0752fbe1c57ed40fbf8f63a343619479`.
The complete glob and gate are not executed in this review.

Let the test create and clean its own private temporary parent by default, while
allowing a private override for review runs. Alternatively, wire a tracked private
temporary-directory runner through every supported command. Do not skip the new
tests, write into a dependency donor, or require a developer's private checker
configuration. Verify the ordinary entry point after the correction.

The Vitest adapter test shows no corresponding bespoke environment requirement.
Its mocked launch uses the Node executable and a repository fixture resolved from
the normal `openplan/` working directory. The child has an empty environment;
the fixture does not read `OPENPLAN_USAGE_TEST_TMP`. The private Vitest cache
override protects the donor, and the private TypeScript config bounds compilation.
Neither is a runtime input to this adapter test. This is source disposition only;
Vitest is not rerun. `test:workers` discovers Python suites and is not the runner
that includes this `.mjs` test.

## P2-2: Do not attach an unbound default-bucket reset to a generic failure

Location: `workers/planner_agent_connector/codex-usage-limit.mjs:12` and lines
26 through 29.

The tracker discards nondefault bucket updates while retaining an earlier
exhausted default-bucket window. A final `usageLimitExceeded` has no bucket
identity. The tracker receives neither the selected model nor a proven mapping
from that model to the default bucket. The supplied schema explicitly supports
multiple buckets and `normalModelSlug`; neither establishes a mapping in this
implementation. Native thread/turn correlation establishes the failed attempt,
but it does not establish which quota bucket caused that failure.

The pure reproduction first merges an exhausted `limitId: codex` window resetting
at 1800000000. It then merges an exhausted `other-model` bucket resetting at
1900000000, or reporting an unknown reset. In both cases, a generic final
`usageLimitExceeded` still returns reset 1800000000. Private
`bucket-ambiguity.json` records both results. This does not copy the other bucket's
number, but it still presents an unrelated earlier default reset as the failed
task's reset when that task may have exhausted the other bucket. The panel's
unconfirmed-recovery caveat does not supply the missing attribution.

Keep `limited` and the structured failure. Return an unknown reset when the
causal bucket cannot be established from a reviewed provider contract and the
selected task/model. If default-bucket resets remain supported, retain explicit
causal evidence and reject ambiguous multi-bucket cases. Add controls for known
and unknown nondefault resets following a known exhausted default snapshot, and
for multi-bucket initial snapshots. The current other-bucket test checks an
already-unknown default reset, so it does not expose this case. No provider call
or new authenticated recording is needed to demonstrate the present source gap.

## P2-3: Preserve the finish RPC's temporary-schema ordering

Location: `openplan/supabase/migrations/20261017000018_assistant_usage_limit_receipts.sql:30`.
The new validator has the same configuration at line 4.

Migration `20261014000032_application_temporary_schema_order.sql:60` explicitly
sets the existing finish RPC's search path to `pg_catalog, public, pg_temp`.
Migration 18 replaces that function with `SET search_path=pg_catalog,public`.
The replacement therefore removes the previously installed explicit ordering.
The new validator also omits `pg_temp`.

The earlier hardening migration explains the consequence in its first five
lines: omitting `pg_temp` gives temporary relations implicit priority. The
replacement RPC still runs as `SECURITY DEFINER`, and PL/pgSQL declarations also
use unqualified built-in type names. Preserve the trusted-schema ordering rather
than restoring implicit temporary-schema resolution. Set both function paths to
`pg_catalog, public, pg_temp`, consistent with the existing migration.

This is a confirmed source/configuration regression, not a demonstrated privilege
escalation. Application table references in this body are schema-qualified, and
the function's service-only grants remain. Those facts limit the immediate
exposure and support P2 rather than P1. No database or exploit ran in this review.
Before native acceptance, inspect the resulting function configuration and include
a temporary-name shadowing refusal control in the isolated stack.

The 15 retained mutations cannot detect this regression. None changes SQL or
inspects the installed function configuration. Private
`sql-source-comparison.json` retains the complete finish-function body comparison
and the intervening configuration amendment. Comparing only the old CREATE body
would miss the amendment.

## Review custody and permitted work

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-461f76fb`,
branch `t3/review-a0-usage-limit-candidate`. It started clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. An ancestry check succeeded, followed
by a local fast-forward to the exact candidate. The candidate was clean before
this report. Only this new review directory is committed.

Private review evidence lives at
`/home/nathaniel/.local/state/openplan/a0-usage-limit-independent-20261016`.
The review reads the full candidate STATUS, diff, changed implementation and tests,
SQL 18, prepared probe, source/check/control manifests, retained logs and mutation
driver. It also traces the existing connector client, native adapter selection,
turn route, previous finish RPC, authorization helpers and later search-path
hardening. The supplied protocol-input JSON is the schema reference. A later parent
request adds the bounded standard-runner and bucket-attribution checks above.

The full repository AGENTS.md, planner-writing, prove-it, Supabase and Postgres
guidance inform this review. The user's source-only restrictions take precedence
over operational skill steps. No network documentation refresh, SQL execution,
database, native CLI, account/model call, original provider profile, credential,
raw history, service, browser, build, full suite, delegation, push or release occurs.
No Vitest, dependency installation or donor cache access occurs. The reviewer
does not run the implementation's mutation driver because it edits source and
launches Vitest. The existing direction receipt is read, not rerun. The only
test-runner execution is the targeted Node file-load failure in P2-1; no test body
executes.

The separate root-owned installer-guidance `e41` lane and `607` preview are outside
this candidate and unchanged by the review. No main merge or hosted migration is
authorized by this report.

## Scoped source disposition

- **Structured classification and correlation.** `codex-provider.mjs:9` classifies
  a failed final turn through the session's frozen structured code. The production
  `waitFor` predicate at line 70 binds native thread and turn IDs. The three
  allowed codes are literal serialized strings. Prose, arbitrary object keys and
  other codes cannot classify a limited attempt. New sessions create new trackers.
- **Attempt-local reset observations.** `codex-provider.mjs:62` reads the snapshot
  before starting the thread/turn. Unsupported metadata requests can leave reset
  unknown without launching a replacement. `codex-usage-limit.mjs:8` merges
  primary/secondary windows, preserves sparse nulls, replaces newly reported
  unknown resets, and ignores named buckets other than `codex`. It chooses the
  latest reset among exhausted retained default windows only when each supplies a
  valid reset. P2-2 prevents accepting that number as the failed task's reset
  without causal bucket binding. Other limit codes retain unknown resets. The bounds are integer Unix
  seconds from zero through 253402300799, inclusive.
- **Final-event freeze.** `codex-session.mjs:75` snapshots the narrow signal into a
  WeakMap keyed by the final event before resolving or retaining that notification.
  Later limit updates cannot change that event's stored signal. Production
  correlation happens before classification. This is one session per generation,
  not a shared account-level cache.
- **Private failure journal and replay.** `connector-worker.mjs:121` creates the
  receipt only for an un-aborted `NativeProviderError` with the allowed code.
  The completed delivery is synced before sending it. The pre-delivery version 2
  guard checks receipt shape and job/setup scope. Lost acknowledgement retains
  the same attempt and delivery; replay avoids inspection and generation. Aborted
  generation keeps `native_connector_interrupted` with no receipt. Existing
  conflict/status handling does not regenerate or overwrite a refused failure.
- **Receipt scope and privacy.** `usage-limit-receipt.mjs:8` copies an explicit
  allowlist. The application schema is strict at both levels and binds user,
  workspace, project, connection, request, turn, attempt, packet hash, model and
  account mode. Native IDs use a bounded restricted alphabet. New limit receipts
  exclude provider account IDs, email, plan, credits, tokens and error prose.
  Internal OpenPlan user/request IDs are intentional custody fields. Existing
  version 1 success behavior is preserved.
- **Route and retained reader.** `native/route.ts:48` requires null answer,
  `native_usage_limit` and a strict version 2 receipt together. Success requires
  version 1. Route custody is checked before finish; `provider-server.ts:117`
  rejects mismatched retained version 2 reports. Exact projection assertions
  include the user, request, connection, attempt, packet hash and receipt fields.
  The browser turns route uses that projection and reader too. Bare historical
  failures remain readable failures without fabricated reset evidence.
- **SQL scope, authorization and replay.** Apart from the P2 configuration
  regression, a complete body comparison against the prior finish implementation
  changes only failure-receipt validation/storage. Existing connection/token,
  current membership/project authorization, connection-before-turn locks, attempt
  identity, lease expiry, cancellation, terminal equality and success/proposal
  checks remain. The new immutable validator compares the entire receipt with an
  allowlisted object built from the saved row. A nonnull failure receipt requires
  a native connection and Codex scope. API failures still require null receipts;
  version 1 API success/replay checks remain. Grants remain service-only.
- **Display and adoption.** The panel derives `limited` from a validated retained
  failure. It shows UTC reset text or `Reset not reported`, separate token/cost
  unknowns, and unconfirmed access recovery. Time passing cannot change this
  saved status. Failed rows cannot enter the success-only proposal review control.
  No automatic retry, provider/model substitution, billing fallback, credit
  action, account change or updater is added.

These are bounded source dispositions. No claim here authenticates a provider's
report, establishes current entitlement, or establishes restored availability.

## Existing checks and controls support limited claims

All 15 source manifest entries, five public evidence entries and 42 private
evidence entries match their SHA-256 pins at review time. The prepared SQL probe
appears in both source and public manifests. These are 62 matching entries, not
62 unique files. An intentionally wrong hash does not match. `evidence.json`
records additional review input and private observation pins.

The final retained Node log records 42 passed, zero failed and zero skipped.
The final Vitest log records four files and 110 passed. The selected files match
`checks.json`. Their scope is synthetic frame processes, mocked storage and
transport, and DOM assertions. The Node set also contains an existing local HTTP
redirect control; this reviewer does not rerun it. The scoped TypeScript config
names six candidate TS/TSX files, imported dependencies and the ambient Vitest
types. Its corrected log and the scoped lint log are empty; their exit-zero
results are recorded in `checks.json`. Empty logs alone do not prove execution
or its exit status. No independent compiler, lint or Vitest rerun occurs here.

The mutation driver, logs and restored hashes support two harmless survivors and
15 targeted failures. The meaningful failures are:

- `final-event-freeze`: final reset changes from 1800000600 to 1900000000.
- `sparse-merge`: clearing sparse null windows removes the expected reset.
- `reset-bounds`: invalid reset -1 survives instead of becoming unknown.
- `structured-classification`: structured failure becomes `native_turn_failed`.
- `journal-retention`: the expected scoped receipt becomes null.
- `journal-custody`: changed user custody reaches delivery instead of refusal.
- `attempt-initial-read`: the adapter fails with `native_request_failed` when its
  synthetic turn requires the removed initial snapshot read.
- `route-custody`: finish is called for changed custody, despite a later reader
  refusal. The test explicitly checks that finish was never called.
- `failure-receipt-refusal`: arbitrary failure receipt returns 409 instead of the
  required pre-finish 400. This does not independently prove SQL refusal.
- `reader-custody`: a transplanted retained report no longer throws.
- `app-reset-bounds`: an out-of-range reset returns 200 instead of 400.
- `limited-state`: the panel loses `Status: limited` while retaining reset text.
- `unknown-reset`: the panel loses `Reset not reported`.
- `unknown-tokens-cost`: missing usage becomes fabricated zero usage/cost.
- `cancellation-code`: cancellation becomes `native_usage_limit` instead of the
  required interruption code.

Both harmless comment mutations exit zero. Finally blocks restore original bytes;
the current source pins match the recorded restored hashes. Restored focused logs
record four Node tests and seven Vitest tests passing. This review verifies those
receipts, not the historical process actions themselves.

The initial failed trials remain retained: null plan/delivery fixture fields,
Vitest's transformed fixture URL, missing TypeScript ambient roots, and the
mutation driver's initial failure to recognize `TestingLibraryElementError`.
The last trial contains real named DOM failures, not a surviving product fault.
Its first log and controls result remain; the corrected driver recognizes that
error category and the intended assertion. No trial is deleted or reclassified as
native acceptance.

The implementation's first two Vitest commands wrote the donor's ignored cache.
This is a retained read-only donor boundary violation. The STATUS and checks
report it explicitly. Later configuration points caches into private state. This
review neither deletes nor restores the donor cache and makes no claim that the
implementation kept every write within its assigned boundaries.

## Independent pure observations and blind categories

This review independently imports only the dependency-free tracker and receipt
helpers. Observations cover known/unknown exhausted windows, sparse null merge,
newly lower reset replacement, other bucket exclusion, fresh tracker state,
literal code classification, timestamp bounds, scope mismatches, success and
cancellation reuse, extra fields and synthetic privacy canaries. The results are
retained privately in `pure-observations.json`.

The journal validator protects shape and scope. It is not a seal against arbitrary
editing by the local file owner: changing a valid reset to another valid reset
still satisfies it. Historical bare failures intentionally remain permitted.
Do not describe this as universal journal-tampering detection. Exact terminal
replay ultimately relies on the unchanged SQL comparison and the preserved
delivery. No new P2 is assigned for the absence of cryptographic local-owner
tamper protection.

The retained 15 mutations do not challenge ordinary runner environment integration
or the known-default/nondefault attribution case in P2-1 and P2-2. They also do not
separately challenge final thread/turn
correlation, each scope field independently at each layer, the nullable-window
exhaustion predicate, all timestamp edges, cancellation-after-final interleavings,
or the complete success-only adoption path. Several of those have positive or
negative fixtures and clear source branches. Their mutation coverage must still
remain narrower than a claim that every changed guard was independently proven.

Source and pure helpers cannot see installed SQL semantics, RLS, lock behavior,
PostgREST serialization, actual account changes, process/power-loss durability,
current CLI compatibility or browser layout. DOM tests cannot see real navigation,
desktop/390px geometry, console output or assistive-technology behavior. Hashes
establish byte identity, not the truth of an implementation report.

## Native probe remains preparation, with safety controls still missing

`NATIVE_PROBE.sql` proposes valid and unknown-reset validator checks, wrong-scope
and arbitrary-receipt refusals, cancellation refusal, retained failure, exact
replay and changed-terminal refusal, inside a rollback transaction. PostgreSQL
has not parsed or executed it in the supplied evidence or this review. It does
not establish SQL, RLS, authorization, transport, recovery or lock acceptance.

Before a separately authorized isolated run, the consequential missing controls
are:

- A runtime wrapper that binds the actual disposable database/stack identity,
  a new owned synthetic fixture and migration/function hashes before any SQL,
  including migration application. A source helper or manually set `synthetic=yes`
  flag cannot establish the executing target's identity. Retain fail-stop execution,
  private token-hash custody, bounded lock/statement timeouts and rollback proof.
- Real role/execute-denial and cross-user/workspace/project controls, wrong token,
  revoked/expired connection, removed membership, moved project, stale attempt and
  expired lease. The current probe uses one authorized running Codex attempt.
- Native-only receipt refusals for Claude, OpenCode, Anthropic and saved API
  callers; unchanged version 1 success and API exact/changed replay cases. The
  finish body is shared, so source equivalence alone cannot accept API behavior.
- Independent concurrent-session controls for finish versus cancellation,
  connection revocation and access changes. The probe prelocks the turn row before
  calling the RPC and cannot prove the RPC's production lock acquisition order.
- Installed configuration/temporary-schema controls for the P2 finding, and
  deliberate harmless and targeted failing SQL mutations with unchanged-row and
  restored-source evidence. None of the current mutations exercises SQL.
- A real route-to-database retention/readback and cancellation journey before
  claiming transport acceptance. Browser and consented installed-CLI evidence
  remain separate requirements for the published visible/native behavior.

These are identified acceptance gaps, not authorization to execute them. Correct
the three P2 findings, preserve the donor incident and failed trials, then
return the revised candidate for bounded review. Claude/OpenCode structured
classification and resets remain explicitly unimplemented. T1 is not complete.
