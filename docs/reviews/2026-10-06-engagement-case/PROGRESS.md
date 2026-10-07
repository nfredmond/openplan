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
