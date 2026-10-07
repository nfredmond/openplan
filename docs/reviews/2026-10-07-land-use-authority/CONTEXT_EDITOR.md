# Mounted plan-context editing and recovery

The land-use workbench now connects the authority and study-area fields to scoped
context reads, draft retention and exact save recovery. This implements the staff
editor under M1. Rendered acceptance, atomic plan creation and sourced plan-kind
rules remain open. This checkpoint does not close M1 or v1.

## Staff workflow

The workbench shows the current saved context separately from the editable draft.
Staff can retain multiple responsible bodies, unresolved applicability, source
URLs and a study area without inheriting legal authority from workspace home or
geometry. Replacing a study area does not replace the authority assessment.
Historical absence stays explicit. Frozen versions retain their own context;
the editor labels its information as current plan context and permits request
recovery after the working version freezes.

Each edit retains incomplete text in an owned browser draft. A save retains both
the original draft and exact normalized command before transport. The editor
checks the matching receipt, refreshes the workbench and current context, then
clears only the confirmed command and this instance's matching draft. A lost
reply leaves an explicit exact-retry action. Mounting, reloading, reading storage
and restoring a downloaded copy never dispatch a save.

A recovered older draft keeps its version and context hash. Staff compare the
saved assessment and study area with their draft, select either the current area
or an explicitly proposed replacement, and acknowledge that review before using
the assessment against current preconditions. That action preserves the original
copy and does not send a request. Retained older geometry cannot silently become
a newly retained current boundary. Staff can instead keep their draft aside and
start from current saved context.

Storage errors preserve on-screen text and a JSON download. If a browser copy
changes, staff can retain current typing under a new owned key without overwriting
the changed original. Unreadable or unconfirmed copies remain downloadable and
can be preserved before moving them aside. That action does not cancel or undo
an earlier save. The editor refuses late file restores after newer typing or an
account change and prevents an initial read from replacing a recovered draft.

## Freeze integration

The actual workbench joins dirty, unreadable, unconfirmed and unreviewed browser
context to its existing content freeze gate. It starts blocked until context has
been read. A newer displayed draft revision also requires a fresh context read;
that read keeps any locally edited assessment and exposes stale preconditions.
The server's revision check remains the authority for changes after a read.

This does not turn separate HTTP reads into a transaction or establish general
snapshot consistency for every workbench read. The context editor's read-readiness
gate prevents a known older editor view from enabling a newer displayed revision.
The existing native save/freeze transaction evidence keeps its own boundary.

## Verification

The focused mounted suites pass 29 cases, including the actual workbench freeze
control. TypeScript and changed-file ESLint pass. The
[initial controls](context-editor/initial-controls.json) detect 27 targeted faults
before a test-timing finding. The
[follow-up controls](context-editor/followup-controls.json) detect the corrected
case and the final two faults. Both sets have passing baseline and harmless
controls, with byte-for-byte source restoration.

The initial unresolved-copy mutation was detected by the workbench integration
and lost-reply tests, but not by its intended smaller test. That test checked the
blocked state before the initial context read finished. The assertion now waits
for the saved context to appear, then checks the gate. The follow-up detects the
fault for that specific reason. The original unmatched-target report remains in
place; it has not been relabeled as a passing control.

The first complete land-use run found six older draft-custody failures. Its fetch
fixture returned the full workbench payload for the newly mounted context route,
so context verification correctly stayed blocked. It also expected the old
section-only status text. The fixture now returns a valid scoped historical
context and waits for that read; wording assertions include context recovery.
The original draft preservation, refused-save and freeze assertions remain.
The [custody controls](context-editor/custody-controls.json) and
[follow-up](context-editor/custody-followup.json) detect seven additional faults.
One initial control named the wrong expected test: its mutation treated typing
as already saved and failed seven preservation/refusal tests, rather than the
intended during-save reversion case. The follow-up records that fault against
the refused-save case and separately mutates acknowledgment to use current
typing instead of the submitted snapshot. The reversion test detects that fault.
No production code changed to repair either control target.
The first failing [unit log](context-editor/unit-first.log) is retained.

The final combined [land-use unit run](context-editor/unit-final.log) passes
361 tests, with three database-gated suites skipped. Final TypeScript,
changed-file ESLint and the product-direction check pass. The direction check
retains its existing registry-age and package-version reminders.

These are DOM, in-memory storage and mocked-transport checks. They cover usable
JSON download bytes, multiple responsible bodies, uploaded geometry, original
command retry, account changes, current-revision reads and recovery without silent
overwrites. They do not establish rendered desktop/390px appearance, keyboard
behavior, accessibility, actual browser quota behavior, or practitioner/legal
acceptance. Production build and HTTP evidence must identify their application
commit separately. No release claim follows from this checkpoint alone.

## Remaining M1 work

Collect the identified-build rendered journeys and native HTTP follow-up. Connect
atomic creation to these same fields and remove the workspace-home applicability
assumption. Distinguish source-supported plan-kind rules, then verify the roadmap's
cross-state, missing-home, uploaded, multistate and tribal cases through saved,
public and exported context. Practitioner and counsel review remain separate.
