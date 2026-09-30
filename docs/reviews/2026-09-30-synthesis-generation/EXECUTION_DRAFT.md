# Synthesis execution foundation, September 30, 2026

This work extends main `a4846acd` in the isolated synthesis checkout. It records the verified local worker checkpoint. Publication and final CI remain
pending. Migration 35 now runs on the named isolated test stack
`openplan-restore-target-2026091050`, after its earlier rollback checks.
The installed v0.64.0 app remains unchanged.

## Implemented boundary

The original requester can retain explicit resource authorization against a
sealed plan. The immutable request and plan retain source, provider revision,
model and task identity. Authorization records attempt allowance, output token
and response byte limits, expiry, charge acknowledgement and any exact retry
predecessor. These bounds do not establish vendor prices or a dollar guarantee.

Each claimed attempt consumes allowance. Initial grants cannot repeat an
attempted task, including through a second initial grant. A retry names one
prior attempt and permits one successor after a result or expiry. Dispatch
checks current requester access, cancellation, API revision and credential.
Its first acknowledgement permits one call. Replaying that acknowledgement
returns `authorizedNow: false` and does not renew permission.

Output custody permits the same worker to retain late original bytes after
cancellation or access loss. Exact retry preserves the original. Conflicting
bytes cannot replace it. An explicit local worker command now runs one authorized
task. It is not deployed to the demo, and no generation interface is enabled.

Execution-status reads recheck current authority and credential identity. They
refuse continuation after expiry or retained output and never renew permission.
Selection history records the first attempt under its authorization. Retry claims
and arriving results do not overwrite that choice. Staff can select a retained
older attempt or clear a choice with an expected-predecessor check. Clearing a
choice before the first claim preserves that clear without blocking the claim.

Native selection pages use a fixed request sequence and ordered task cursor.
The service reader reconstructs the source plan, checks retained receipt hashes
and identities, and keeps cleared tasks in that complete plan. It supplies
explicit selected attempt IDs for subsequent result accounting.

The protected API transport now has a separate raw-receipt profile. It retains
observed entity-body bytes as base64 with their checksum, HTTP status, selected
content headers and termination state. Invalid UTF8, malformed JSON, non-200
responses and incomplete provider outputs remain available for later inspection.
Cancellation, truncated responses and response limits retain an explicitly
incomplete prefix. A complete HTTP body does not establish valid model output.

Both profiles share endpoint policy, pinned DNS, TLS verification, exact
credentials, deadline and one-request controls. The existing project profile
keeps its original request, token and response bounds. Synthesis receipts permit
authorized responses from 4 KiB through 4 MiB and up to 65,536 output tokens.
The fixed request envelope bound is 8 MiB. No provider call is authorized by
constructing a transport; the worker must join it to native dispatch authority.

The API attempt adapter now checks the current dispatch acknowledgement, worker,
authorization, task checksum, frozen recipe, provider revision and retained
credential checksum. It consumes each invocation once and applies the earlier
of the dispatch expiry and configured timeout. A required storage callback must
finish before response interpretation. The worker still needs to supply the
private filesystem journal behind this callback.

Saved API receipts now have a strict verifier for byte bounds, canonical base64,
checksum, HTTP metadata and complete/prefix state. Response interpretation keeps
invalid or missing usage counts unknown and retains original bytes on failure.
Loading a saved result reconstructs its output, outcome and usage from those
bytes, instead of trusting a self-hashed replacement. This checks protocol
consistency, not provider authenticity, segment coverage or model usefulness.

## Demonstrated defect and correction

The first draft parsed captures with PostgreSQL JSON. A native probe showed
that this rejects JavaScript strings containing unpaired Unicode surrogates.
The corrected command receives the exact canonical capture bytes as base64
with their SHA256 checksum. PostgreSQL stores the original text without
interpreting provider strings as JSON values.

Native storage enforces worker and dispatch identity, size, canonical encoding,
checksum, immutability and exact retry. It does not independently validate the
capture's embedded attempt binding or business meaning. The TypeScript delivery
module checks the existing strict result protocol before sending and after
receiving the native acknowledgement. Future saved-output readers must do the
same. Supplied usage values remain provider reports; unknown usage remains null.

## Evidence

- The execution candidate suite passed 58 native checks. The 30 status/selection
  checks also passed across the combined run and a focused follow-up. One mutation
  assertion expected an older label after a new credential probe caught its
  targeted fault earlier. The follow-up verifies the corrected assertion and
  reruns all three source-derived delivery joins after source restoration.
  Native evidence includes independent cancellation-lock contention, targeted
  faults, separate-request controls and source-derived delivery.
- The selection reader, delivery, column accounting and migration inventory
  suites passed 79 checks. Changed-file lint and the TypeScript check passed.
- The delivery join reconstructs the retained 303-contribution source, stages
  and seals its complete plan, and verifies native attempt identity. A lost
  output acknowledgement recovers through the same bytes. First delivery after
  cancellation and access revocation retains NUL and unpaired surrogate strings.
- Delivery mutation evidence includes a harmless control, 19 targeted failures
  and one retained survivor. Removing the acknowledgement checksum comparison
  alone survives because result verification independently checks the hash.
  Removing the text comparison changes the public error and fails that assertion;
  independent result parsing still refuses the changed text.
- Selection-reader checks survive two harmless controls and detect 27 targeted
  faults. Three initial survivors exposed weak assertions. Refined cases require
  refusal before another query, reject an unknown cleared task without relying
  on later attempt mapping, and abort before source reconstruction.
- Integration checks survive a harmless control and detect 20 targeted faults
  in relation accounting, column explanations and the operator migration note.
- The transport and existing generation suites pass 143 checks, including real
  local HTTP and TLS servers. Changed-file lint and TypeScript also pass after
  fault injections are restored. Checks cover exact bytes, both response bounds,
  invalid encodings, error statuses, truncation, deadlines, no repeat calls and
  trusted, untrusted and wrong-hostname TLS for both transport profiles.
- Transport mutation evidence includes harmless controls and 33 targeted faults
  detected across the initial and refined runs. Two initial survivors showed
  that a later refusal masked an unnecessary DNS lookup. The refined assertions
  require endpoint rejection and pre-cancellation before DNS. Removing the
  redundant settlement check survives because the promise and stream cleanup
  still preserve the first returned receipt. This survivor remains recorded;
  these tests do not independently prove that particular redundant check.
- The response verifier, interpreter and API adapter pass with the existing
  transport, plan, result and delivery checks: 273 tests across nine files.
  Changed-file lint and TypeScript pass. The source-derived API fixture uses
  a real local HTTP server and a synthetic dispatch acknowledgement; it does
  not establish the native worker join.
- These additions detect 67 targeted faults and retain harmless controls.
  Removing the adapter's second abort check survives because the transport
  independently refuses a pre-aborted request. Some other faults change the
  refusal point while independent credential or protocol checks still refuse
  the input. The byte-bound and task-checksum probes also use otherwise valid
  oversized receipts and changed task content to prove those specific boundaries.
  Mutation evidence includes a missing storage callback, failure to await storage,
  callback mutation of the received value and a bypassed native deadline.

The worker and loader checks join the transport, API, delivery, selection reader
and column audit in a 340-test run. Changed-file lint and TypeScript pass.
Worker mutation runs retain three harmless controls, detect 69 targeted faults
and retain two independent-guard survivors. Removing either the chosen task text
comparison or its hash comparison alone leaves another source-derived comparison
in force. Removing the combined source-inventory comparisons is detected. Initial
survivors also led to earlier-refusal assertions and internally consistent altered
fixtures; their original outcomes remain in the private evidence bundle.

Nine CLI subprocess checks cover a lost output acknowledgement, interruption
while waiting for a model and interruption after storing a response. The resumed
worker either redelivers the stored original or leaves the outcome unobserved.
A harmless CLI comment change passes, and six targeted process faults fail.
These subprocess cases use a simulated database bridge; the next checks use the
installed native commands.

Four isolated native HTTP checks cover keyed and keyless calls, a lost dispatch
acknowledgement, and late original output after cancellation and requester access
revocation. The large response contains exactly 4,194,304 bytes. Its delivery
request exceeds 13 MB through the configured Kong and PostgREST services. Losing
the acknowledgement and starting another worker process retains one database
output with identical capture text and checksum, without another provider call.
A native-check control passes; six faults fail: missing observation recovery,
missing unknown-dispatch recovery, skipped database custody, a one-megabyte
journal, a four-megabyte delivery ceiling and a changed token allowance. The
last fault is refused by the transport before a wrong allowance reaches the model.
All mutation sources are restored before current checks.

The native fixture initially passed an oversized request DTO to the strict plan
constructor. Projecting its exact three fields fixed the fixture. Its first access
revocation also attempted to remove the workspace's sole owner. The database
refused that change. A separate synthetic owner now keeps the workspace valid
while the requester loses access. Unique committed fixture identities remain in
the disposable stack; cleanup does not bypass immutable-history protections.

The first expanded fixture attempted a prohibited credential update. The
existing immutable credential trigger correctly refused it. The corrected
fixture tests service-level deletion and replacement within a rollback, and
uses the native configuration-save command for revision advancement. An initial
Vitest invocation from the repository root also failed before running tests;
the checks above run from the nested application package.

Earlier native tests use rollback transactions and synthetic captures. The worker
checks below add real filesystem journals and process interruption, followed by
native HTTP delivery. They do not prove storage-hardware power-loss recovery,
provider authenticity, model quality, live billing, usefulness or browser reachability. A refusal-code
fault can be caught while a separate constraint still prevents the same write.
The installed synthesis and trusted-path subset passes 98 checks; all 52 Python
worker suites pass. The first full QA run found a two-second override below the
repository's 20-second test timeout. Removing that override passes the focused
33-test run. The next full run passes 16,303 tests with 1,009 skipped, then stops
at the dependency audit for GHSA-vcvr-r3jv-pc5j in Next.js 16.3.4. The package and
lockfile now pin Next.js and its lint configuration to 16.3.8. The dependency audit
reports no vulnerabilities. An initial install trusted stale hidden npm metadata:
`npm ls` reported 16.3.8 while the actual package files still reported 16.3.4.
Preserving and removing that hidden metadata, then installing again, replaced
five packages. The actual Next.js and lint package files now report 16.3.8.
The production build also identifies Next.js 16.3.8. Full QA passes on that
runtime, including lint, tests, connector checks, audit and the webpack production
build. Normal and shuffled runs each pass 16,303 tests with 1,016 skipped; the
shuffled seed is 99173. Full installed RLS passes 920 tests, with 125 skipped,
across 73 files. Upgrade checks and final CI remain pending. The dependency advisory concerns
attacker-controlled SVG inputs to Node.js `next/og`; no source use of that API
was found. See the [upstream advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j).

## Populated-stack test accounting

The full isolation run exposed eight baseline/control failures in the earlier
request and plan fixtures after native worker tests retained their synthetic
history. Five assertions counted entire tables as though the stack were empty.
The revised fixtures capture each table's starting count, then check the exact
number of transaction additions. Two added controls seed background history;
five added failure cases insert an unexpected request, cancellation, plan, task
or seal. The 15 focused native checks pass. Two harmless SQL controls pass, and removing
each of the five count assertions makes its added-row test fail because the
expected rejection disappears. All fixture sources are restored. The first full
isolation run reports 905 passed, eight failed and 125 skipped; all eight failures
name the two old global-count assumptions. The full rerun passes all 73 files,
with 920 tests passed and 125 skipped, in 1,300.57 seconds. Counts cannot detect replacement that
leaves the total unchanged; separate immutable-history and byte checks protect
that boundary.

## Framework browser check and interruption recovery

The candidate production server runs from the isolated synthesis checkout on
port 3234, with base commit `a4846acd2e72`, Next.js 16.3.8 and a retained manifest
of the pending source hashes. The build identity script matches that checkout.
The source hashes distinguish this candidate from unchanged main at the same base
commit. A reported desktop crash did not stop the server or isolated database.
All 39 previously recorded source hashes still match; the two pending roadmap
and requirements-ledger corrections are also retained. The pending isolation
session completed with exit 0. This observation does not prove power-loss recovery.

Fresh Chrome contexts enter through the front page. The desktop journey creates
a synthetic account through the product, signs in, then uses keyboard activation
to open Engagement. Separate 1440px and 390px journeys reach the Engagement
heading with no horizontal page overflow, console errors or page exceptions.
Both screenshots were visually inspected. A harmless CSS custom property leaves
the 390px check green. Forcing a wider root element makes the overflow assertion
fail for the expected reason. The fault affects only that disposable browser
context and changes no source file.

Private screenshots and machine-readable results remain under the local
`approval-resume-2026-09-27` checkpoint, with prefix
`generation-worker-patched-browser-`. These checks cover native account entry
and existing Engagement navigation on the patched framework. They do not cover
a new generation interface, synthesis quality or downstream campaign workflows.

## Remaining implementation

The private worker journal and explicit CLI now join source reconstruction,
native claims, dispatch, current status and original-byte delivery. The worker
locks its directory, retains attempt identity before claiming and stores raw
receipts before interpretation. Known receipts recover by redelivering the same
bytes. Unknown dispatch outcomes remain unobserved and create no invented result
or automatic replacement call. A complete surviving temporary receipt can recover;
partial temporary files remain evidence and do not supply a result.

Run the local worker with the saved authorization UUID and task index:

```bash
npm run worker:synthesis-generation -- --authorization AUTHORIZATION_UUID --task-index 0
```

It reads the configured service endpoint and uses a separate private directory per endpoint,
authorization and task. `OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR` can select its
storage root. Repeat the same command to recover the same attempt. Exit 0 means
native output custody was acknowledged; exit 2 means the dispatch outcome remains
unobserved. Neither state establishes semantic usefulness or staff approval.

Add the full-corpus scheduler and staff controls before enabling generation.
Each worker invocation currently operates one explicitly authorized task.

The current internal choice command requires the original requester. Add current
campaign-staff historical access and review when joining the staff interface;
older results must not become permanently inaccessible after staff turnover.
Keep that read/review authority separate from the original requester's authority
to continue provider execution. The native HTTP join exercises the configured isolated PostgREST and Kong
transport. Other operator proxy configurations require their own delivery check.

Record and context consolidation, retained machine-review import, installed CLI
provider scope, the generation interface and identified desktop/mobile acceptance
remain open. This foundation does not complete M9b or change the V1 contract.

## Subsequent coordinator candidate

The [coordinator candidate](SCHEDULER_DRAFT.md) adds saved task lists over the same
explicit authorization and single-task journals. It records its own tests and
remaining gates. It does not enable the staff generation interface or complete
record/context consolidation.
