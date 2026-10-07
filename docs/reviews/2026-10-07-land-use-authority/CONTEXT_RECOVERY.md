# Context drafts and unconfirmed save recovery

This checkpoint adds the browser-side recovery functions for the M1 plan-context
editor. They are not yet mounted in the workbench. It follows the
[authoring-field checkpoint](CONTEXT_AUTHORING.md) without declaring a completed
staff workflow or rendered acceptance.

## Preserve staff work and its original scope

Current-context reads validate account, workspace and plan identity, the working
version, the retained context and its hash state. A failed read or malformed
response remains a failure. It cannot become historical absence or seed an empty
assessment. Responses must already be normalized; parsing cannot silently repair
a returned authority statement.

Each browser instance owns a mutable draft key. Updating it requires the exact
previous browser copy. Restoring a draft creates a new owned key and keeps the
original account, plan, version, context hash and checklist preconditions.
Incomplete text remains editable. An older draft does not gain current
preconditions merely because staff open it again.

Each pending save owns an immutable command key. It retains the exact request
bytes, original draft, version, context hash and any unchanged study area before
transport. Preparation verifies that the command still represents that draft.
The byte limit matches the route, including multibyte text. Reading or restoring
copies never sends a request. Retrying remains an explicit staff action.

Save confirmation checks the command, version, actor, assessment, response status
and returned study area. Retained, drawn and uploaded areas must match their
original records. A searched area must match the requested resolver identity,
label and jurisdiction codes. Its geometry still comes from the server resolver;
the client does not independently authenticate those boundary coordinates.

Unknown, interrupted, rejected and malformed replies preserve the request.
Cleanup checks a matching receipt and exact browser copy, and removes only that
command. Mutable drafts and newer commands remain separate. Preservation writes
and reads back an exact recovery copy before moving an original aside. A changed
original, failed storage read, quota failure or identifier collision is reported.
Malformed copies remain available for download rather than being repaired or lost.

Browser storage is not a cross-tab transactional database. Unique instance keys
avoid ordinary tab ownership collisions, and the server remains responsible for
permission, exact-command replay and concurrent database writes. The controller
must still check its current scope and refresh the workbench before acknowledging
a save or enabling a new freeze.

## Verification

The focused recovery suite passes 55 cases. The
[main controls](context-recovery/controls.json) and
[supplemental controls](context-recovery/supplement-controls.json) record passing
baselines, harmless comments and 49 detected faults. Every mutation restores the
source bytes. Controls cover scope, stale bases, exact retention, reply identity,
capture paths, byte limits, cancellation and preservation of newer copies.
TypeScript and changed-file ESLint pass. The final [land-use unit run](context-recovery/unit.log)
passes 334 tests, with three database-gated suites skipped. Those three suites
pass separately against the installed verification database as recorded below.

The first test collection failed because its fixture passed `contextHash` into a
strict save-command constructor that expects `expectedContextHash`. The fixture
was corrected before the passing baseline and controls. No production guard was
relaxed for that failure.

These checks use synthetic data, in-memory browser storage and mocked transport.
They do not establish browser rendering, keyboard behavior, accessibility,
practitioner judgment, native browser quota behavior or a complete staff journey.
No application build or production HTTP acceptance was collected for this new
recovery module. The earlier freeze-route build and HTTP evidence retain their
original commit boundary.

## Retained study-area migration installed

After the rollback-only authoring checkpoint, migration `20261016000006` was the
only pending migration on the isolated verification target. The
[installation record](context-recovery/installed-identity.json) identifies the
container, workdir and exact migration SHA-256. The
[migration log](context-recovery/migration-up.log) records application.

All three [installed native suites](context-recovery/installed-native.log) pass
without migration probes: context persistence, draft revision and freeze
persistence. The context fixture checks retained-place substitution refusal and
atomic plan geography alignment. The target is installed through migration 6.
Do not run its candidate migration probe against this installed target. Demo,
engagement and benefit-cost databases were not changed.

## Workbench connection remains open

The editor still needs scoped load and refresh handling, owned draft persistence,
visible download/preserve/restore actions and explicit pending-request retry.
Keep an old base visible until staff review it; do not silently rebase a restored
draft. Join dirty, unreadable and unconfirmed context state to the workbench's
unsaved-content freeze gate. Keep request recovery available after a version
freezes, while refusing new saves against that frozen version.

Then verify mounted controls and their harmless/failing cases, build the exact
checkpoint and collect native HTTP and rendered desktop/390px journeys. Atomic
creation, sourced plan-kind rules, public/export presentation, practitioner and
counsel acceptance remain open under M1. The full v1 contract remains unchanged.
