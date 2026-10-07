# Complete engagement case development

Nathaniel directed continued development through the full v1 contract on October
6. This work continues the October product-direction review and roadmap M9b.
It does not narrow v1 or declare a new release. The implementation checkout is
`engagement-complete-case-20261006`, based on merged main `b028d0e4`.

## Preparation controls

Staff can inspect preparation from a saved generation request. The panel reads
the native job state, checks request, actor, intent hash and stage, and offers
explicit enqueue or observed-attempt retry to the original requester. Another
staff account can inspect status. Preparation does not authorize provider
execution, approve a finding or publish a contribution.

The panel uses the existing recovery module. It retains and reads back the exact
command before sending, recovers it after remount, and preserves unreadable
originals before clearing the active recovery slot. Failed storage prevents a
network write. History refresh closes the preparation inspector before native
revalidation. Denied access clears its private state and notifies the source view.

Focused component and recovery checks pass: 3 files, 64 tests. The harmless
comment mutation passes. Removing actor verification, enabling another staff
account's queue button, and retaining selection across history refresh each
fail their corresponding component test. These checks use simulated HTTP
responses. They do not prove native authorization, worker operation, rendered
usability or practitioner acceptance.

Lint and the full TypeScript check pass. The first type-check process exhausted
Node's default 4 GB heap; the unchanged check passed with 6 GB.

[Browser evidence](preparation-browser.json) identifies checkpoint `81c06fef`,
the owned server and isolated database. Normal navigation reaches the inspector.
The cancelled state fits desktop and 390px and disables queueing. A controlled
lost response after a native enqueue preserves the exact command across reload.
Tab and Enter explicitly replay it; the native receipt retains the same request
and creation time, and local cleanup completes. The existing selected-request
worker journal then records a prepared result at attempt 1, with no provider
call. This uses an existing synthetic source and plan.

The shared T3 browser disconnects before inspection of the final prepared state.
Subsequent interaction calls fail although status and read calls return page
state. The final prepared screen, native context/theme controls and remaining
browser fault cases remain unverified. The owned server is stopped before
further implementation. Release checks remain pending. Explicit provider authorization and the complete case through
proposal import, response, decision and usable artifacts remain unfinished.
The roadmap remains the only active queue.

## Request creation and cancellation

The next checkpoint adds creation from a saved source, using the existing saved
API connection and model metadata. Browser reads can pin their account and
workspace; mismatched or incomplete pins fail before metadata access. Existing
unpinned settings reads retain their native membership checks. The UI checks
connection and revision scope before showing a choice. API key material never
enters this panel. Saving an intent does not grant execution or spending authority.

Creation uses the original recovery module. A retry retains the same intent,
provider revision, model and request identifier even if the current provider
metadata changes. The retained original remains inspectable before retrying.
Cancellation uses its separate recovery slot and preserves an uncertain create.
A delayed creation reply cannot erase a confirmed cancellation. If cancellation
precedes creation, staff can preserve the uncertain original and start another
request. Saved history reopens and verifies the original intent before offering
cancellation, including for context and thematic requests. Only the original
requester receives cancellation controls.

The creation, cancellation and inspector component checks exercise exact command
retention, unavailable storage, denied access, different actors and source hashes,
lost replies and the cancellation/creation race. Harmless comments pass. Deliberate
removal of provider workspace or browser-pin checks, trimming the original reason,
erasing cancellation with a late creation reply, blocking continuation after an
early cancellation, and ignoring the saved source hash each fail the relevant
check. These use simulated HTTP responses and do not establish native or browser
acceptance of the new controls. See the mutation receipts alongside this note.

The focused run passes 9 files and 158 tests before the final storage-readback
cases. Those additional cases then pass for all three command controls. If the
storage write succeeds but its readback throws, each control reopens the saved
command and offers the original retry without sending a network write. Removing
that recovery read makes each corresponding new test fail. Full gate and native
browser checks of creation and cancellation remain pending.

Source review then found that a later metadata page could replace the revision
of the selected provider without a fresh selection. The panel now retains the
explicitly selected revision and disables saving if a later read changes or
revokes it. Staff must choose the current revision and model again. The new
regression passes; restoring the earlier selection behavior fails that exact
test. A harmless comment still passes. The first local full gate on `00971fe7`
was deliberately stopped during tests to make this correction. It supplies no
passing full-gate claim; the corrected commit requires a fresh run.

The main-branch QA workflow `37567988907` passes after PR #115. Its separate live
RLS workflow is still running when this checkpoint is recorded. This does not
replace verification of the new branch.

The main live RLS run `37567988750` subsequently passes: 91 files, 1,422
checks and 125 skipped. Its log is retained locally at
`/tmp/openplan-main-rls-b028.log`. Skipped cases do not supply acceptance evidence.

## Execution authority adapter in progress

The separate `engagement-execution-controls-20261006` checkout starts at
`6bedf6b8`, preserving the request-controls build during its full gate. The new
authenticated execution route calls the existing segment, context or thematic
authorization function. It does not start workers, access a service key or send
contributions to a provider. The original request is checked before and after
the write against the actual actor, campaign, workspace, source and intent hash.
Browser account/workspace pins, same-origin writes and explicit refusal of
unregistered agent commands remain required. Original grant bytes and identifiers
survive expiry and cancellation for exact acknowledgement recovery. Native
functions retain responsibility for new-grant eligibility and worker dispatch.

The worker authorization schema moves unchanged to a browser-compatible records
module. The existing worker import remains available. Three existing loader and
authority suites pass 172 checks. The new HTTP and adapter suites pass 61 checks.
Their harmless comment passes; deliberate removal of original-actor, source,
receipt-hash, post-write access, browser-account, agent-write and single-retry
checks fails the corresponding test. See [mutation receipts](execution-mutations.json).
These tests simulate RPC responses and establish neither native RLS nor provider
execution. The route has no visible staff control yet. Full type/build checks,
native authorization recovery and identified-build browser evidence remain open.

The next staff control must show the actual saved destination/model, the sealed
plan's task count, exact grant limits and expiry before explicit acknowledgement.
Attempt, output-token and response-byte limits are not a dollar ceiling. A
bounded plan read can inspect retained header/seal identity; the durable worker
must still reconstruct original inputs before dispatch. The browser must retain
the exact grant before POST and preserve it on a lost reply, access change,
storage failure or reload. It must not silently create a second allowance.
Existing worker journals own execution and result recovery. Context and thematic
continuation, reviewed proposal import, response/decision links, usable exports
and second-staff continuation still need the complete case evidence. The roadmap
continues to own sequencing; this note does not declare those outcomes complete.

## Prepared execution preview checkpoint

The authenticated GET route now reads the existing segment, context or thematic
plan before staff authorizes execution. It checks the original request before
and after the read, validates retained header and seal hashes, and requires the
complete count/byte prefix. Provider metadata queries select only the fields
needed to show the original destination, model, revision and current status.
A cancelled request or changed provider remains visible with its actual status;
an incomplete plan fails the read instead of reporting zero work.

The preview, authority adapter and HTTP suites pass 102 checks. TypeScript and
targeted ESLint pass. A harmless comment passes; removing intent binding,
complete-count validation, provider workspace scope, the explicit projection or
the final access check fails the respective preview check. See
[preview mutation receipts](execution-preview-mutations.json).

A read-only native check signs in as the synthetic original requester against
the isolated restore-target stack on port 29821. Existing sealed plans return
4 segment tasks, 13 context frames and 5 thematic tasks. The check grants no
authority, starts no worker and calls no provider. The sanitized
[native preview receipt](execution-native-preview.json) identifies file hashes
because this check precedes the preview commit. These bounded header/seal reads
do not establish full input reconstruction or scientific validity. Browser
authorization controls and native grant recovery remain open.

Nathaniel confirms that the separate benefit-cost agent owns
`work/bca-workbench-20261006`. Its worktree is excluded from these edits and must
be included in the next integration audit.

## Execution discovery and browser recovery checkpoint

Saved execution authority is discoverable through a bounded current-staff read.
The private query selects request identity, original intent/hash and creation
time, with no credential columns. Pages use creation time and UUID together;
the cursor preserves native fractional-second precision. Access is checked
before and after the query. Expired grants and cancellation remain visible as
history. An unavailable read never becomes an empty list.

Browser recovery retains the exact allowance before POST and checks its original
receipt bytes and checksum. A confirmed command stays in its slot until staff
explicitly preserves it. Confirmation does not silently permit a new allowance.
Lost replies, old expiry, access errors, replaced commands and storage failures
retain the original recovery path. Preservation saves unreadable originals and
newer in-memory commands before releasing the slot, and does not cancel native
authority or resolve an unknown provider outcome.

Five focused files pass 143 checks. TypeScript and targeted ESLint pass. Harmless
comments pass. Targeted mutations fail for missing private-query scope or
projection, unstable pagination, lost access, erased cancellation, missing
browser pins, incomplete cursors, replacement allowances, failed readback,
incorrect receipt checksums, automatic cleanup and archive races. See
[history mutations](execution-history-mutations.json) and
[recovery mutations](execution-recovery-mutations.json). An initial wrong-request
mutation removed only a redundant check and remained rejected by the receipt
parser. The revised mutation removes both bindings and fails the intended check.
All mutations are restored. These are simulated boundary checks, not native RLS
or browser acceptance of execution controls.

The owned isolated stack returns one existing original grant for each synthetic
segment, context and thematic plan. Authenticated exact replay returns the same
ID, original intent bytes and checksum for each. See the
[history read](execution-native-history.json) and
[original grant replay](execution-native-replay.json). No new authority is
created, no worker is started and no provider is called. The route and browser
recovery still need a visible staff review control and its identified-build
journey. New-grant native recovery and the full engagement case remain open.
