# Staff-requested synthesis execution

Design checkpoint, October 7, 2026. Base 60920f8b, application runtime inspected
at 5646c33c. This is implementation preparation under roadmap M9b and A0, not a
new queue of product priorities or a claim that execution service support exists.

## Observed gap

Staff can save a source, create root/context/thematic requests, queue preparation,
grant exact execution permission, inspect saved results and import a machine
proposal for review. The current generation CLI requires an operator to supply
an authorization UUID and stage. It has no continuous discovery mode.
`scripts/workers/synthesis-preparation.ts` already offers a supervised polling
service; `scripts/workers/synthesis-generation.ts` operates one named grant.
The UI truthfully says that saving an allowance does not start a worker.

The desired outcome is that staff can explicitly request execution of a saved
allowance and observe its disposition with a configured worker running. An
operator should configure the service once, not copy every allowance identifier
into a shell. Existing installations and command-line recovery remain supported.

## Design constraints

1. Keep saving permission separate from requesting execution. Existing allowances
   must never become an automatic backlog when a service starts. Add an explicit
   staff command bound to the original stage, request, authorization and hash.
2. Reuse the existing segment, context and thematic schedulers. Their native
   authorization checks, task ordering, exact journals, selected predecessor
   results and unknown-dispatch refusals remain authoritative. A queue receipt
   grants no extra attempts or permission.
3. Use an additive native queue record and narrow authenticated command. Verify
   the author, current workspace/campaign/source, request stage and original
   permission before a new enqueue. Exact command replay returns the original
   receipt without manufacturing fresh execution rights after expiry.
4. Scope agent writes through the existing action registry or an executable
   staff-only refusal. Do not expose a service-role enqueue endpoint to browsers.
5. Persist a coordinator journal before dispatch and reuse the CLI's canonical
   target/authorization/task directories. Never assign a fresh task directory
   after an uncertain result. Worker restarts preserve the original queue and
   scheduler identity.
6. Bound discovery pages and rotate pending work so an unavailable provider does
   not strand unrelated cases. Native task claims remain the concurrency fence.
   An observation timeout alone does not justify another schedule or process.
7. Cancellation prevents fresh work through existing native request rules. Saved
   output can still recover custody. Expiry and cancellation do not prove that
   a sent call failed or that its cost is zero. Unknown outcomes stay visible.
8. Report queued, claimed, partially retained, retained, unobserved, refused and
   unavailable states without implying semantic correctness or staff approval.
   A worker heartbeat is operational evidence, not proof of output completeness.
9. Preserve all three stages and the complete source. Provider support remains
   accurately disclosed. This queue does not establish installed-provider parity
   for synthesis or finish the broader A0 requirement.

## Implementation and verification sequence

Read the current native authorizations, worker journals and preparation queue
before selecting the queue schema. Specify exact command/reply bytes and replay
behavior first. Add the native command and staff-only route, then browser recovery
and visible controls, then the continuous coordinator using existing schedules.
Update operator configuration and restore custody together.

Use the isolated restore-target stack for synthetic acceptance only after its
identity and outstanding jobs are inspected. Do not automatically run any existing
allowance. Test new explicit queue records against a synthetic local provider
that logs every call and rejects unpinned tasks. No paid provider is required.

Verification must include harmless and targeted mutation controls; wrong actor,
workspace, campaign, stage and permission hash; expired new commands and exact old
receipts; duplicate enqueue; lost enqueue reply; two workers; shutdown/restart;
provider loss before send; unknown dispatch after send; output custody recovery;
context predecessor gaps; thematic source completeness; and cancellation while
queued or running. Count native attempts, dispatches and outputs and compare
original hashes, not only UI success messages. Keep failed cases and blind spots.

Finish identified-build desktop and 390px navigation from retained source through
execution request, observable progress and explicit staff proposal import.
Synthetic semantics do not establish planner usefulness, public comprehension,
provider parity, complete accessibility or independent human acceptance. These
remain full V1 obligations.

## Existing browser evidence

Combined-runtime inspection reaches contribution results with four retained
outputs, both source contributions, context creation and thematic creation.
The thematic request 3620e480 has two retained outputs and an explicitly expired
allowance. Review bf07f2a2 retains revision 2, both unassigned contributions,
uncertainty and no approval events. Proposal inspection shows a replacement
preview and a separate selection control at desktop and 390px. No enqueue,
allowance, provider call, import or approval was performed in this read-only
follow-up. Private local checkpoint and screenshots retain the exact paths;
final workflow evidence must be collected after implementation.
