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
