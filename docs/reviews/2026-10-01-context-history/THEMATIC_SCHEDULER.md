# Durable thematic scheduling

October 2, 2026. This internal checkpoint extends single-task thematic execution
to a saved complete-grant schedule. It does not complete M9b or the v1 contract.
No new migration is required beyond the execution checkpoint's installed schema.

## Fixed task inventory and recovery

The CLI now accepts `--authorization UUID --all-tasks --thematic`. It retains
`--task-index INTEGER --thematic` for individual tasks. One private schedule
records the target database, authorization, request, original header and grant
hashes, initial attempt identities and ordered task indices before execution.
The final proposal is included in `taskCount`; evidence frames alone are not the
complete inventory. A saved schedule does not grow when another command claims
work. Explicit retries name one predecessor and one task, including the proposal.
The scheduler does not select a retry on the user's behalf.

The historical authority reader compares original request bytes, sealed input
manifest, input-seal receipt, frozen recipe, reconstructed header commitments,
frame seal and original final reference. All reads name explicit tables and
columns so the static projection guard can inspect them. These metadata checks
retain historical identity after cancellation or expiry. They do not reconstruct
source evidence, inspect current credentials or authorize provider calls.

Creating a new schedule independently replays current original inputs and checks
that its header still matches the retained authorization. Each fresh task uses
the existing worker's original-input reconstruction, complete selected predecessor
chain and native authorization fences. An unresolved dispatch stops successors.
A malformed or incomplete predecessor also stops work through the worker's replay
checks. Existing observed responses can still be delivered after cancellation or
requester revocation, through their exact original journals, without another call.
Segment, context and thematic schedule modes remain distinct.

A complete private temporary schedule left before rename can restore the final
journal, including after current access ends. Every candidate must pass the
same identity and fixed-inventory checks before promotion. Conflicting complete
schedules stop recovery before any worker runs. Partial JSON remains untouched
for diagnosis and does not authorize a schedule. This recovery is limited to the
thematic scheduler; the existing context scheduler is unchanged.

The CLI reports retained outputs and tasks outside its schedule. Draining an
allowance does not establish a valid proposal or staff approval. The final output
still requires complete original replay and explicit staff review/import.

## Evidence

- Initial scheduler and historical-authority suites pass 84 tests. Expanded
  authority, scheduler and unchanged projection-guard checks pass 125. Cases
  cover the final task, partial allowances, own and other initial attempts,
  short native inventory pages, fixed retries, cancellation recovery, changed
  scope/receipts, original-byte bounds, interruption and incompatible journals.
- Authenticated native HTTP recovery passes in 174.44 seconds including runner
  overhead. The actual CLI starts with one retained thematic task, schedules the
  complete inventory, and reaches the final proposal. The proxy drops its output
  acknowledgement after commit. Repeating the same schedule after cancellation
  and requester revocation retains the original schedule and captures without
  another provider call. An independent continuation replays the proposal as
  `machine_unreviewed`. This uses one synthetic source contribution and a local
  synthetic provider.
- The extended scheduler and authority suites pass 128 tests, including nine
  temporary-file recovery and refusal cases. A harmless comment control passes
  those nine cases. Five deliberate recovery faults fail the intended assertions:
  omitted scan, omitted promotion, unchecked candidates, ignored conflicts and
  treating partial JSON as fatal. Invalid candidates must leave the final
  schedule absent, even when a later guard would also reject them.
- The native temporary-file control passes in 169.50 seconds including runner
  overhead. It renames the complete schedule to a temporary file before retrying
  after cancellation and requester revocation. The same schedule and final
  capture are recovered; the temporary file is preserved and provider call count
  is unchanged. This simulates interrupted-rename custody, not process crash timing.
- Omitting temporary-file recovery makes that native CLI retry fail its expected
  success assertion in 169.79 seconds. An earlier native inventory fault that
  omits the final proposal fails the exact saved task-list assertion in 165.58
  seconds; its harmless control passes in 169.39 seconds. Both source mutations
  are restored.
- Final full QA passes: 17,227 application tests with 1,429 skips, 382 connector
  tests with four skips, lint, configured dead-code check, dependency audit with
  zero reported vulnerabilities, webpack production build and TypeScript. The
  broad live RLS gate is skipped in full QA; the native HTTP scenario runs
  separately against the owned isolated stack. No new SQL is introduced.
- The corrected column registry passes a harmless comment control. Restoring
  each of the three stale entries independently fails its unchanged assertion.
  [Machine-readable evidence](thematic-scheduler-mutations.json) retains initial
  failures, corrections, mutation results, source hashes and key local log hashes.

## Fault isolation and limits

One header mutation initially fails some cases because a later reference check
also rejects the changed content identity. In that case, the test's expected
error label obscures what the header comparison itself proves. The corrected
fixture keeps downstream references consistent while preserving the incorrect
header continuation hash. Removing the header comparison then accepts the bad
header and fails the intended rejection assertion. The initial result and the
isolated follow-up remain in the evidence record.

A separate historical-recovery fault initially produced the intended current-
scope error, but the result matcher accepted only assertion failures. The
positive recovery case now explicitly asserts promise resolution. The same
fault fails that assertion, while the original code and harmless control pass.
The initial classification remains in the evidence record.

Initial full QA reports 17,226 application passes and one schema-accounting
failure. The new explicit authority reads make three unread-column entries
stale: the thematic request text/hash and the input-seal manifest text. Removing
those obsolete entries aligns the registry with the actual readers; every guard
assertion and projection threshold remains unchanged. The first failed run is
preserved separately from final QA.

Historical count, chain and content hashes are immutable commitments. The
historical reader does not prove source membership or semantic correctness by
recalculating a self-hash. Native sealing and fresh original reconstruction
protect those different boundaries. Mocked transport cannot prove live RLS or
concurrent native authorization; the HTTP scenario exercises the installed stack
separately. No new SQL functions or client permission grants are introduced.

The native scenario does not establish large-campaign performance, external
provider quality, vendor billing or planning usefulness. Preparation still keeps
original evidence in memory, and a final proposal exceeding its byte ceiling
remains incomplete. No input or uncertainty is clipped. Derived proposal custody,
current-staff proposal history, explicit staff import and identified desktop and
390px journeys remain unfinished. Wrong-mode prepared task journals still need
a documented self-service recovery path. The full nationwide planning and
separate scientific validation requirements remain open under the roadmap.
