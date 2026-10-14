# Aerial callback retry candidate

A callback ledger row previously caused an immediate deduplication success even
when the subsequent status or evidence write had failed. The correction loads
the original job/workspace and parsed payload before replaying interrupted work.
It compares the JSON representation retained in JSONB, including key-order
independence. This is not original HTTP-byte retention. A changed payload,
missing original or different worker reference refuses. Existing terminal
preservation and held-artifact/evidence reuse remain in place.

The status write requires the observed status and worker reference, including a
null reference when assigning the first one. Its returned id must identify
exactly one job. A concurrent change or removed job returns 503, which the
existing worker retries, rather than applying downstream artifacts or overwriting
a new terminal state. Other progress ordering and complete transaction/custody
recovery remain separate boundaries.

All 20 route cases pass. Four positive cohorts, a harmless comment, 18 targeted
faults and 90 failure-oracle controls pass. The retained pre-fix route fails the
named interrupted-status assertion. New mocks assert both the original ledger
projection and the conditional update filters/affected-id projection. These
mocks do not establish live permissions, concurrency, Storage or full delivery.

The compiled route, actual Supabase SDK and isolated PostgREST perform real
loopback HTTP requests on the retained selected 409 schema. A controlled proxy
interrupts the first status PATCH after the ledger insert. The second identical
callback finishes that original update. A changed payload and other worker
reference refuse. Another fixture changes to succeeded after its initial read;
the conditional write returns 503, and its next retry preserves that terminal
state. Only new synthetic fixtures are added; existing proof records are not
reset or deleted. Owned services stop. The service peaks at about 87.4 MiB.

The route adapter is not a full Next build, browser journey or hosted acceptance.
It uses this physical computer and a historical selected schema. It does not
establish current-main installation, default durable worker enablement, actual
processing, artifact delivery, positional quality or full M3/M5b.2 completion.
The native controller passes four positive cohorts, five targeted faults and
40 failure-oracle controls. It rejects skipped replay, changed payload acceptance,
foreign worker acceptance, missing observed-status filtering and missing affected-id
projection. The first harmless control used a Python comment in TypeScript and
failed compilation; that failed trial remains retained. The corrected comment
survives, and every mutation restores in finally. Its service peaks at about
91.6 MiB under 1 GiB. Changed-file lint passes. Original job and callback-key filter controls also pass. All 129 related application/documentation cases in 12 files pass; fresh GitHub CI remains pending.

Private proof:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/aerial-callback-retry-20261014/`.

The first documentation pointer oracle expects the missing path inside JSON
failureMessages, which omit Vitest's rendered array detail. It refuses that
incomplete diagnostic. The corrected verbose-plus-JSON control passes baseline,
harmless and restored checks and rejects the intended missing-link assertion.
The first local source commit precedes this correction and was not pushed.
Joined-main/308 checks follow before publication. No failed trial is acceptance.

Joined main901 and the308 correction preserve the route bytes. The joined lint
and 129 related/documentation cases pass again. The new CI source-control
command also passes from the actual nested package: four positives, 18 targeted
faults and 90 oracles. CI adds that command after QA without removing a check.
No migration, hosted setting, version or release tag changes belong here.

## Same-status review correction

Review 4267945502 identifies a real gap: status/reference predicates alone let
an old replay overwrite a later same-status event. The correction reads the
last callback identity/time, checks the applied ledger's job/workspace/payload
identity, and compares its original event time with the incoming event. Older
events and equal-time replays of different applied identities are preserved as
superseded. A newer original retry remains allowed. Fresh equal-time events
retain arrival ordering. The write also conditions on the observed last callback
id and timestamp, preventing a concurrent same-status event from being lost.

The comparison uses original payload fractions rather than rounded database or
JavaScript timestamps. It handles offsets and trailing zeros without truncating
fractional digits. The database timestamp remains a write fence, not the source
of event-time precision. Missing or unreadable ordering returns a retryable error.

All 28 route/time cases pass in four positive cohorts. The harmless edit
survives and 35 targeted faults plus 175 failure-oracle controls pass. Applied
record scope, callback key, timestamp precision, unknown time and each new write
filter are challenged. The first same-status native trial fails because its
proxy shadows response bytes with an injected event dictionary. The corrected
trial preserves a newer applied event and refuses a real concurrent same-status
write. Both failed and corrected trials remain retained. Updated native controls pass four positive cohorts, seven targeted faults and
56 failure-oracle controls, peaking at about 94.9 MiB. The new faults omit the
stale-event refusal or both last-event write fences; each fails the intended real
database assertion. Joined checks and fresh-head CI remain pending. The review is not yet closed.

The review correction passes changed-file lint and all 137 related/documentation
cases in 13 files. Its current source cohort has 28 cases, four positives, 35
faults and 175 oracles. Applied job/workspace/callback-key and unreadable-record
cases are separately challenged. Current native controls pass four positives,
seven faults and 56 oracles. Source restores and owned services stop. Fresh
GitHub CI follows on the pushed correction; no earlier-head result is inherited.

## Existing custody fixture join

Fresh shuffled CI fails three checks in the existing custody-to-planner fixture.
It models the old eq-only status write and omits the new nullable callback fields.
The route therefore stops before custody. The corrected fixture supplies the
same guarded eq/is/select chain as the actual client, checks its observed status
filter and returned-id projection, and keeps every custody/privacy/page assertion.
Captured shuffle seed491551 passes all36 affected cases. Four positive36-case
cohorts,37 targeted faults and185 oracles pass; the harmless comment survives.
The two added faults omit the custody status filter or alter its id projection.
This remains fixture/source coverage, distinct from the real database proof.

Changed-file lint and145 related/documentation cases in14 files pass on the
joined custody fixture. The CI source command runs all36 affected route, time
and custody/page cases in its positive cohorts. Fresh full/shuffled CI follows
the pushed fixture correction; the captured failed run is retained.

## October 14 accepted-response and overlapping-retry correction

GitHub review identifies two defects in the combined candidate. The dispatch
handler records the synchronous accepted callback pointer without retaining its
payload in the private callback ledger. The ordering reader then refuses the
first posted running event. Separately, two exact terminal retries can both read
no evidence package and insert separate records.

The correction validates the accepted response's original request ID, retains
its normalized payload before installing the ordering pointer, and accepts a
unique conflict only after reading the exact payload and original job/workspace.
The accepted write guards the requested state and empty worker reference and
callback pointer, so a faster callback can advance the job without being
replaced. A missing accepted ledger remains a visible503, with no invented
ordering pointer. The worker may already own that request.

Legacy accepted jobs can use the timestamp actually saved on the job after a
successful ledger lookup returns no row. They must remain accepted and carry a
matching worker reference and saved callback identity. This does not reconstruct
fractional precision absent from that saved timestamp. Missing running/terminal
records, failed reads and mismatched retained payloads still refuse application.

New callback-created packages use the processing job UUID as their existing
primary key. Overlapping revised handlers cannot create separate IDs. A unique
conflict reads that deterministic ID and verifies job, workspace, mission,
project and package type without replacing human edits. The initial legacy
lookup checks those same scope fields. This introduces no migration. Older
writers using random IDs, other direct writers, existing duplicates and
concurrent artifact custody remain separate gaps.

Four source cohorts each pass69 cases. All58 faults reach the intended
assertion, and290 oracle controls reject wrong tests, diagnostics and exits.
The first assertion-order failure remains. A later surviving scope mutation
reveals a vacuous fixture that changed both job identity and payload. The revised
fixture changes job, workspace and payload separately; all three targeted faults
then fail. No assertion is removed to make that evidence pass.

The actual compiled route and installed SDK pass a selected409 PostgREST fixture.
Two real package reads finish before either insert, overlapping exact terminal
retries both complete, and SQL finds one package whose ID equals the job UUID.
A legacy accepted pointer also advances. This adapter is not a full Next build,
browser journey, current-main restore, hosted acceptance or scientific proof.
Native controlled faults and current exact CI remain pending at this checkpoint.

## Joined candidate after the roadmap and Storage join

The current combined tree joins main259 and Storage checkpoint95856e9ae.
Changed source/dependencies pass TypeScript,12 changed files pass lint, and148
cases pass across11 files. Four callback cohorts each pass69 cases; all60
source faults reach the named assertion and300 oracle controls reject unrelated
failures. Four selected409 native cohorts and10 faults pass with80 oracle
controls. Those native cases include actual overlapping terminal retries,
one deterministic evidence package, and legacy accepted-baseline advancement.
The reuse audit now records `evidence_package_reused`.

The joined source bindings match restored files. The first nullable-record
TypeScript failure remains retained; the corrected guard explicitly requires
the original accepted record. Missing records and failed reads remain visible.
The [joined Storage evidence](../2026-10-14-aerial-immutable-custody/STATUS.md)
protects bytes and actual transport. Its limits remain separate. Fresh exact-head
CI, main integration and hosted delivery remain pending. No migration, worker
default, version or tag changes. The bounded candidates do not close the wider
M3/M5b.2 or v1 contract.

## CI fixture deadline correction

Exact657 CI run38559861159 fails in the URL-draft positive controller. The
full-delegate test gives the pipeline one second while real fixture writes and
syncs are still running. It reaches `Source custody deadline exceeded`. This is
not a passing CI result.

The revised test uses a120-second original intake adapter and30-second outer
pipeline. It still runs the actual delegates and inspects the forwarded stage
and engine deadlines. The stage cannot receive the original larger budget, the
shared adapter cannot be mutated, and transport cannot extend the outer limit.
Production deadlines and defaults do not change. Both Python3.14 and3.11
controllers pass four positive22-case cohorts,31 intended faults and eight
failure-oracle controls. Earlier failed logs remain. Fresh exact-head CI is still
required; retrying the failed head alone would not establish this correction.
