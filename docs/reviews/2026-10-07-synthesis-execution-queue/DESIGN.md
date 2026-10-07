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

## Record contract checkpoint

The shared command binds schema version, queue ID, actor, workspace, campaign,
source and source hash, request and intent hash, stage, and authorization and
intent hash. The receipt carries the unchanged command text, its SHA-256,
queue ID and original creation time. The portable verifier checks exact bytes
and the checksum without treating the receipt as permission or completion.
Native validation of authority and unique JSON keys remains required.

Twenty focused tests pass. A harmless comment passes; deleting the exact-command,
queue-identity or checksum comparison causes targeted assertion failures.
`record-controls.json` retains those outcomes. Changed-file ESLint passes.
An initial test invocation from the repository root failed to locate Vitest;
the actual tests ran from the application package. No native command, worker,
provider, browser write or new capability is implemented by this checkpoint.
Mock-free record checks do not establish database authorization, browser storage,
concurrency, worker recovery, deployment or full-package compatibility.

## Native enqueue candidate

The additive candidate stores one immutable enqueue command per authorization.
It uses the current requester lock and stage-specific execution checks, compares
source/request/permission identities and hashes, and rejects new scheduling after
expiry or credential changes. Exact receipt replay does not recheck permission
expiry or create another record. Direct table writes are revoked; only the narrow
authenticated enqueue function and service read are granted.

`native-probe.sql` runs inside a rollback-only transaction against the owned
synthetic restore target. It uses existing source/plan records and creates fresh
permissions through the actual stage authorization functions. All three stages
pass exact receipt/replay and adverse hash/stage/actor/duplicate/byte checks.
The baseline and harmless control pass; six targeted native faults fail the
intended probe assertions, recorded in `native-controls.json`. No worker runs,
provider is contacted, or candidate migration remains installed.

This probe sets the synthetic JWT subject while using the local database owner.
It tests function behavior, not authenticated-role grants or live HTTP isolation.
It depends on the retained synthetic fixture and is not a self-contained CI test.
Before landing the migration, add independent role, expiry/replay, cancellation,
credential-change, foreign scope, duplicate/concurrency and immutable-history
checks. Add the migration inventories and release documentation with the complete
increment. The queue has no claim/status API or worker pickup yet; service reads
must never interpret a queue record alone as fresh dispatch authority.

## Role and time-bound follow-up

`native-role-probe.sql` adds actual `authenticated`, `anon` and `service_role`
execution checks in the same rollback-only transaction. Authenticated staff
creates a new queue entry and recovers its original receipt for each stage.
Other actors cannot replay it. Anonymous and service roles cannot invoke the
staff enqueue function; direct authenticated table reads and updates fail.

Fresh permissions expire naturally during the probe. A previously enqueued
command still returns its exact receipt; an untouched expired allowance cannot
create a queue entry. Cancellation likewise preserves exact old receipts and
refuses fresh scheduling. These checks alter only temporary synthetic records.

The baseline and harmless control pass. Six targeted role/current-authority/
expiry mutations fail the intended assertions. The initial UPDATE probe also
read a column, so removing UPDATE restrictions still failed for missing SELECT.
The revised probe assigns a literal and isolates UPDATE permission. This initial
weakness and final results remain in `native-role-controls.json`.

These checks establish SQL role behavior and natural expiry, not browser/HTTP
session isolation, concurrent workers or deployment recovery. Independent fixture
construction, credential-change and concurrency coverage remain unfinished.

## Reproducible native suite

The repository now includes `synthesis-execution-queue-rls.test.ts` and its SQL
fixture in the live-isolation npm command. It creates source, request, plan and
permission records from the existing repository fixture producers. Contribution,
context and thematic cases each use fresh rollback-only records rather than this
machine's saved browser data. The 11 tests pass in 20.84 seconds on the explicitly
selected restore target; changed-test ESLint and whitespace checks also pass.

The initial command ran outside the app package and found no fixture. After
correcting the working directory, the first expanded run passed nine tests and
failed two: the fixture setup supplied the contribution author's ID for context
and thematic requests. Native authorization correctly refused that author.
The setup now reads the original actor from each created request before assuming
the authenticated role. All 11 cases pass, including seven targeted faults and
the harmless control. No production authorization check was weakened.

The suite applies the candidate migration inside its transaction when
`OPENPLAN_SYNTHESIS_EXECUTION_QUEUE_CANDIDATE=1`. Ordinary live CI uses the migrated
schema. It still requires the existing isolated-stack safeguard and explicit
live-test opt-in. These fresh fixtures supersede the earlier machine-specific
probe dependency, but do not establish HTTP/browser recovery or concurrent workers.
