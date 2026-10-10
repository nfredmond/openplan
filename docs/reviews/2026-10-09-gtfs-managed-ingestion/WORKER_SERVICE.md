# Managed GTFS worker service checkpoint

The worker service now calls the candidate queue, claim, attempt read, renewal
and member-status commands through the installed Supabase SDK. It validates
request identity before I/O and checks response types, scoped claim identity,
claim interval and attempt ordering. An inactive receipt remains history. A
snapshot cannot claim active ownership of a different or newer attempt.

Snapshot verification checks public and execution state agreement, prepared
ownership, archive confirmation and deterministic private path, upload hash and
byte count, URL/catalog source shape, expected output capacity, tract outcome and
completion evidence. Successful zero-row tract computation remains distinct from
a failed computation with null values. A ready current attempt needs its retained
completion receipt. Member status rejects unknown fields, including worker tokens.
Source arguments retain their original text. UUID identities are canonicalized.
Source-shape checks do not replace the existing SSRF and publisher-fetch controls.

Each call has a ten-second acknowledgement limit independent of whether the
transport settles after cancellation. Already-cancelled calls and cancellation
before the dispatch microtask do not invoke the SDK command. The helper aborts
the request, removes its listener and timer, ignores late replies, and returns a
generic acknowledgement-unavailable error without provider detail. It issues no
retry or failure command. A timeout does not prove that a database write failed;
the future durable journal must reconcile the original token or command.

## Checks and their limits

The focused suite has 64 passing tests. It uses the installed SDK with controlled
fetch responses and inspects each of the five endpoint names and argument bodies.
It tests missing, inactive, malformed, foreign and inconsistent receipts; source
and archive identity; plan capacity; tract/completion distinctions; status privacy;
queue bounds and duplicates; nonboolean renewal; immutable submitted scope;
pre-dispatch cancellation; redacted HTTP and transport errors; and transports
that ignore cancellation and reply after the local deadline. These are controlled
transport tests, not a live PostgREST or browser journey.

[worker-service-controls.json](worker-service-controls.json) records 36 runs:
baseline, harmless comment and restored source pass, while 33 deliberately broken
variants fail assertions. Every explicit cross-field guard is removed separately;
additional variants weaken strict schemas, queue bounds, renewal typing, error
handling, deadline and cancellation checks. Candidate source and tests use unique
disposable files. The tracked application source remains unchanged and each
candidate is removed on normal completion. A forced process kill can leave a
candidate file, but cannot leave a tracked guard disabled.

An initial pre-dispatch mutation survived because the SDK independently refused
the aborted request. The refined test also inspects whether the wrapper invokes
the SDK, proving its earlier guard separately. The oversized-queue table now
passes whole arrays to its test function; separate capacity and duplicate mutations
confirm that these assertions detect their stated defects. No failure is removed
to make the result pass.

[worker-service-native.json](worker-service-native.json) records three actual
PostgreSQL responses for running, completed and cancelled imports. The Python
runner installs the candidate and synthetic fixtures inside a rollback transaction,
uses the real commands as service_role, saves their JSON privately, and rolls back.
A separate connection confirms candidate-schema absence. A new Node process then
validates the real claim, attempt and member-status responses with the production
TypeScript verifier. This catches native timestamp, null and field-shape mismatch;
it does not prove native HTTP authorization or process-restart recovery.

Scoped TypeScript compilation includes the installed Next global declarations.
ESLint and diff checks pass. Full application CI has not run for this unfinished
worker-service branch. The existing 120-case SQL record still identifies the
unchanged candidate migration. Native snapshots and logs remain in the private
proof directory; the repository retains their hashes and summarized result.

## Remaining work

No managed import is enrolled. The next work connects mutation commands, durable
private journals, actual polling and lease renewal, archive reconciliation, parser
supervision, row mapping and all three import routes. In-flight Storage writes
must settle or reconcile after cancellation before cleanup can be acknowledged.
Mixed managed/legacy locking, native contention, committed restart recovery,
upgrade/restore and identified desktop/390px T3 journeys remain unproved.
This checkpoint stays outside v0.68 and makes no resumable-import, scientific,
practitioner, public or v1 acceptance claim.

Reproduce from the owned checkout:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_worker_service.py /private/new-control-directory
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_worker_native.py /private/isolated-proof-config.json /private/new-native-directory
```
