# Node queue process observations, candidate

This separate candidate adds private process observations for eight existing Node queues. It does not change job outcomes, authorize work, measure queue progress or activate a new worker. Candidate migration `20261017000015` remains unapplied to hosted production. The combined original-worker PR #323 merged as `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`; its production verification remains separate.

## Behavior

Each invocation captures one UUID, deployment build and service client. The observer writes at most one request at a time, every 30 seconds, with a three-second request deadline. Shutdown cancels the active request and attempts a higher-sequence stopped observation. Diagnostic failures preserve the worker result or error and use a fixed warning without provider data.

The existing worker handlers retain signal ownership and notify the observer when they stop. The observer installs no signal listener. A signal before an asynchronous worker startup installs its handler therefore retains Node's default termination. A crash can leave an old running observation; its age becomes stale rather than implying progress.

The database uses server time, monotone sequences, one captured build and an absorbing stopped state. Exact replay does not refresh time. Ordinary roles have no table or RPC access. Service credentials remain trusted; a UUID is an identity, not independent attestation. Direct privileged table writes fall outside the RPC sequence guarantee.

The reader reports the complete eight-kind census. Missing, stale, future, running, stopping and historical stopped observations remain distinct. Unreadable or contradictory data makes that deep-health probe unavailable, without inventing an empty queue. PostgreSQL microseconds remain intact at the two-minute boundary. These process summaries do not approve or verify work.

## Current checks

The first observer/wiring source campaign passed four 17-case runs and 37 intended faults. Snapshot 01 then found a startup signal defect, so those results qualify the earlier bytes only. The corrected observer passes four 20-case cohorts and 50 targeted faults in source 05, including actual startup-body children for both signals and both affected entries. That run includes the fixture NODE_ENV type correction. All 22 restored source bindings match, with three positive and two in-memory digest fault controls. The first corrected rerun stopped on an outdated mutation anchor and restored source in `finally`; it is not a passing campaign.

The earlier reader campaign passed four 13-case runs and 17 faults. Snapshot 01 found timestamp/state consistency gaps and overly permissive positive fixtures. Reader 03 passes four 18-case cohorts and 28 targeted faults, including both fresh latest-row count implications and valid mixed-instance positives. The checker timeout also changes from 20 to 30 seconds to cover three serial eight-second server probes. Checker 01 passes four 12-case cohorts and one caller-budget fault. Snapshot 03 static review finds no further concrete defect. Narrow TypeScript, changed-file strict lint, 107 shuffled regression cases and product direction pass. The final service peaks at 392.8 MiB under a 1 GiB limit. The earlier broad worker-transitive typecheck exhausted its 640 MiB Node heap; full transitive application typing remains a required CI boundary.

Unchanged deep-health SDK transport controls pass four nine-case runs and 12 faults, including an actual stalled process-reader connection. Route controls pass four 11-case runs and five faults. Schema controls pass four 37-case runs and three faults after first detecting the new table count and SQL-read build field. These checks cover selected source and local HTTP boundaries, not hosted operation.

Native 06 clones the retained 415-migration SQL fixture, applies selected schema 417 and candidate 418, and confirms 310 application tables with RLS. Four functional probe runs and nine SQL faults pass. Three rollback query-load runs include 10,000 retired observations and 256 active observations; their measured SQL execution times are 0.345, 0.349 and 0.484 milliseconds on this fixture. An inflated-count fault fails as intended. These are bounded synthetic query measurements, not business-queue capacity.

Native HTTP 05 uses a separate 128 MiB PostgREST container and the owned 1 GiB database. Three complete cohorts cover all eight kinds and three roles; reader-grant and stopped-state faults fail as intended. Four real late-arrival runs observe an HTTP write waiting on a database lock, commit the stopped row first, and retain stopped with a false late receipt. Both function and role grants are restored in `finally`. The fixture retains synthetic probe rows and is not a clean production database. Earlier harness failures for provenance and anonymous HTTP status remain recorded separately.

## Evidence limits

There is no hosted migration 15 application, worker deployment, browser journey, business-queue throughput, actual-provider send, whole-installation restore, independent-host check or planner acceptance for this candidate. The native SQL fixture is selected-schema upgrade evidence, not a current-main or full archive restore. The process census covers the hosted supervisor's seven kinds and declared standalone GTFS poller; a future standalone worker outside those declarations needs explicit enrollment. Older instances stay retained; no cleanup or retention acceptance is claimed.

Private evidence lives under `~/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/node-queue-observation-20261014/`. Do not publish credentials, fixture environments or raw private logs.

The [proof index](proof-index.json) records each source or native report and its blind category. The [operator instructions](OPERATIONS.md) describe the unreleased rollout. Review findings and corrections are preserved in [REVIEW.md](REVIEW.md). Dedicated CI repeats source, reader, transport, route, checker and schema fault controls serially. That workflow passes on the earlier `0f1fdf508693` head; the corrected source still requires fresh exact-head CI.

The first PR QA job fails on one unused fixture binding because local lint omitted the warning cap. [The correction record](CI_CORRECTION.md) preserves that failure. Source 05 repeats all lifecycle controls after removing the binding. The final local command uses `eslint --max-warnings=0` across the complete PR source diff and passes. Fresh exact-head GitHub CI remains required.

## October 15 CI integration correction

The later `0f1fdf508693` QA and shuffled jobs each fail six assertions in the
same two files. Five actual preparation CLI cases expose an observation/request
census change and premature diagnostic HTTP before invalid startup refusal.
The sixth requires the full migration filename in the changelog. The failing
shuffle seed is 256781. These failures are retained, not retried as flakes.

Preparation arguments and target/directory configuration now validate before
the observer starts. A valid pass still records diagnostics, and its test counts
the one business inventory request separately. Invalid invocations retain the
original zero-HTTP boundary. The actual stopped-write attempt and idle signal
path remain checked. The AST guard accepts the explicit validated entry and
still refuses a bypass or reordered validation. The changelog names the full
candidate migration filename.

Source 06 passes four 33-case cohorts and 54 intended faults. An additional idle
CLI campaign passes four positive runs and one intended wrong-target fault.
All 23 restored source hashes match, with three positive and two digest faults.
Scoped types, full changed-file strict lint, 126 related shuffled cases under
seed 256781 and direction check pass. The final 1 GiB service reports a
688.9 MiB peak. Its first narrow type configuration omitted the global GeoJSON
definitions needed by the newly included worker transitive imports; adding the
actual installed type declarations resolves that scope error. No application
type errors are suppressed. Full application CI remains required.

The native SQL and HTTP report bytes are unchanged. These CLI corrections do
not qualify live queue recovery, hosted observations or browser acceptance.
