# Codex usage-limit attempt receipts

October 16, 2026. Local implementation candidate only. Base
`bbbcfcc56e293cbf5fad105d0bfaf3ce94da1ffc`, branch
`t3/a0-usage-limit-receipt`, isolated checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-c1880cd3`.
No push, PR, release, hosted change or database application occurs in this work.
The root607 preview stays frozen. Installer guidance belongs to root's separate
checkout and does not form part of this candidate.

## Implemented behavior

The Codex adapter reads one attempt's account rate-limit snapshot before starting
its native turn. Its owned session merges sparse rate-limit notifications. Null
windows leave the previous available window intact; a newly reported window
replaces its old reset, including when the new reset is unknown. Only the default
Codex bucket is used. Other named buckets do not supply a reset for this task.
No snapshot crosses sessions or attempts.

A correlated failed final turn can report the serialized structured codes
`usageLimitExceeded`, `rateLimitExceeded` or `sessionBudgetExceeded`. Provider
prose and similarly named object keys cannot classify the attempt. For
`usageLimitExceeded`, exhausted reported windows can supply reset timestamps.
When every exhausted window supplies a valid reset, the receipt keeps the latest
of those timestamps. Otherwise the reset stays null. Rate-limit and session-budget
codes retain unknown resets because the account windows do not establish those
specific reset semantics. Timestamps must be integer Unix seconds from zero
through 253402300799, the displayable UTC date boundary. A reset is an observation,
not evidence that access has recovered.

The session freezes this narrow snapshot when the final event arrives. Later
notifications cannot rewrite it. A new session starts without prior metadata.
The connector writes the completed failure delivery to its private, synced journal
before delivery. Lost acknowledgement replays that same attempt and result without
another inspection or model generation. A modified scoped usage-limit journal
refuses delivery. Cancellation keeps the interruption path and cannot become a
limited receipt.

The version 2 receipt binds the stored user, workspace, project, connection,
request, turn, attempt, packet hash, selected model and account mode. Native thread
and turn identifiers use a restricted identifier alphabet. Receipt fields exclude
provider error prose, provider account identifiers, plan, email, tokens and credits.
This is a scoped connector report. It does not independently authenticate a
provider's report or establish remaining quota, model entitlement or restored access.

The native route accepts this strict receipt only alongside a null answer and
`native_usage_limit`. A different failure cannot attach it. A success still needs
the existing version 1 success receipt. The route and retained reader check all
receipt scope fields against the saved attempt. A bare historical failure code
continues to display as failed without an invented structured report or reset.

The provider panel derives `limited` from the validated retained version 2
receipt. It shows the provider-reported reset in UTC, or `Reset not reported`.
It separately shows unreported tokens and cost, and states that access recovery
is unconfirmed and no automatic retry starts. Passing time does not change this
saved attempt to available. The result contains no proposal and cannot enter the
existing success-only adoption control.

No automatic model retry, provider substitution, API billing fallback, reset-credit
purchase or consumption, email, account change or native updater was added.

## Migration18 is prepared, not applied

`20261017000018_assistant_usage_limit_receipts.sql` is required because the current
finish RPC rejects every failure receipt. It adds a service-only immutable
shape/scope validator and replaces the current finish RPC with one narrow change:
a native usage-limit failure may retain its validated version 2 receipt. It keeps
the durable `failed` state, current authorization/locking, attempt lease,
cancellation, exact terminal replay, result/proposal validation, API behavior and
success behavior. Historical failure receipts remain null. No existing row or
state constraint changes.

`NATIVE_PROBE.sql` is a prepared transaction for root's reviewed isolated synthetic
stack. It requires explicit private settings and an unexpired seeded Codex attempt.
It proposes valid and unknown-reset retention, wrong-scope and arbitrary-receipt
refusal, cancellation refusal, exact replay and changed-terminal-result refusal.
It rolls back. It has not been executed, parsed by PostgreSQL or mutation-tested
against a database. It is not native SQL, transport, RLS or recovery acceptance.

## Source provenance

The supplied safe historical protocol input is
`/home/nathaniel/.local/state/openplan/a0-usage-limit-protocol-20261016/protocol-input.json`.
Its source schema SHA-256 is
`7b9e7d385fffef8d428cc5490b56ce9c393bd3ed7bc7ccd730956387e723ec05`.
It records historical Codex 0.154.0 schema provenance. The supplied current global
Codex 0.150.1 remains unsupported by the connector's reviewed version registry.
This work does not inspect, invoke, update or generate a protocol from that binary.
The new frames are authored synthetic fixtures from the supplied schema contract,
not new recordings from an authenticated provider session.

Existing repository design and custody references include the full V1 contract,
roadmap, milestone A0/T1/T15 definitions, architecture, capability matrix, known
issues, October 6 direction review, September 4 provider/T3 research and September
10 provider implementation record. The nested direction check passes with dated
review reminders. No capability or milestone status is promoted.

SQL authoring follows the existing locked RPC implementation and the
[PostgreSQL CREATE FUNCTION documentation](https://www.postgresql.org/docs/current/sql-createfunction.html).
The current [Supabase changelog](https://supabase.com/changelog.md) was fetched into
private evidence. This work changes no SDK API, service configuration or installed
PostgreSQL version.

## Focused checks and controls

All compiler, lint, test and mutation commands use the shared
`compiler-repair-checks-20261015.lock`, a 1024 MB Node heap and serial test workers.
The selected Node set covers the new usage-limit flow, session and existing
connector worker. The selected Vitest set covers the new adapter, route/reader
and panel cases, plus existing provider route/panel regressions. See `checks.json`
for terminal results and exact selected files.

The real adapter test replaces only launch construction with an owned synthetic
Node frame process. It retains the real provider/session parsing and requires the
initial rate-limit read before turn generation. Worker tests inject generation
and app transport and inspect the synced journal before allowing delivery. Route
mocks assert the exact retained-row projection and that refused receipts never
reach finish. Panel tests inspect DOM text and absence of a retry write/control.

Mutation evidence has two harmless survivors and 15 targeted failures. It covers
final-event snapshot freezing, sparse merging, reset bounds, structured
classification, journal retention and custody, initial attempt read, route custody,
arbitrary failure-receipt refusal, retained-reader custody, displayable reset bounds,
limited status, separate reset/token/cost unknowns and cancellation classification.
Every source mutation restores exact original bytes in a finally block. Restored
checks pass. `controls.json` records the source hash at each restoration.

Retained failed trials include an invalid synthetic packet's null plan fields,
a fixture URL incompatible with Vitest's transformed module URL, a private
TypeScript configuration missing ambient type roots, and a mutation harness that
initially did not recognize Testing Library's named failure. The harness correction
retains that trial and checks the intended failing test and error category. No
product failure was hidden by deleting a test.

## Remaining evidence and limits

- Node frames establish deterministic parser/session behavior, not current CLI
  compatibility, provider authenticity, account entitlement or live reset accuracy.
- Worker tests establish journal/delivery behavior with mocked generation and app
  transport. They do not prove native PostgREST, database locking, RLS, physical
  power-loss durability or every cancellation interleaving.
- Route tests use mocked storage. Projection assertions do not prove installed
  schema/RPC compatibility. Migration18 and the prepared SQL probe remain unexecuted.
- DOM checks establish copy and state selection. They do not establish identified
  browser navigation, desktop or 390px layout, keyboard usability or accessibility.
  No browser or service starts in this run.
- No authenticated provider frames were recorded and no native account/model call
  occurred. New recording needs the recording account owner's separate consent.
- Claude and OpenCode structured usage-limit classification and resets remain
  unimplemented here. Existing generic failures remain honest; no prose classifier
  or reset guess is introduced. Multi-provider T1 remains open.
- Token and cost collection remains open under T15. This increment displays unknowns
  for these limited attempts; it does not implement usage records for every task.
- Full suites, builds, installed CLI tests, native DB/RLS, CI, cloud and release
  checks are intentionally outside the authorized scope.

## Dependency donor boundary incident

The first two Vitest commands used the donor node_modules symlink before a private
cache override existed. They wrote the donor's ignored cache file
`/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`.
The observed modification time was `2026-10-16T09:52:00.943276908` local time.
This violated the read-only dependency-donor boundary. The implementation owner
reported it during the run. Later commands use the private Vitest config/cache;
the donor cache was left untouched after discovery. No tracked donor source or
root607 checkout changed. This incident is retained as a limit on the claim that
all writes stayed within the assigned checkout and private directory.

Private logs, runner, configuration and manifests live under
`/home/nathaniel/.local/state/openplan/a0-usage-limit-receipt-20261016`.
`source-integrity.json` hashes every candidate source and prepared probe.
`evidence-integrity.json` hashes retained private logs/configuration and public
review evidence. Candidate commit identity is returned separately to avoid
self-referential commit hashes.
