# Context authoring and retained study areas

This checkpoint adds reusable authority and study-area fields and the command
path needed to edit an assessment without replacing its boundary. The fields
are not yet mounted in the workbench or creator. The staff save/recovery
controller and atomic creation remain unfinished under M1.

## Keep the saved boundary when editing an assessment

A context save can explicitly request `place.mode = retained`. New saves read
the scoped stored context and verify its hash, working version, checklist and
plan kind before reusing the exact place record. The configured checklist still
requires a supported staff assessment. This path does not contact the boundary
resolver. A replay discovers its receipt before reading current mutable context.

Candidate migration `20261016000006` checks the retained place against the locked
plan row. An absent or substituted place is refused. Saving context also updates
the plan's study-area label and geometry in the same transaction, so subsequent
frozen plan identity cannot keep an older label while its context carries a newer
boundary. Historical context and frozen versions are not backfilled or rewritten.

## Authoring fields

Inherited display labels do not fill authority type, jurisdiction, role, sources
or an applicability assessment. Staff can record multiple bodies, including
sovereign and overlapping responsibilities. The body-type suggestions display
plain names while preserving a custom type; they are not a closed legal taxonomy.
Jurisdiction stays unassessed until staff enter it. Country and subdivision fields
remain independent of the study geometry and workspace home.

Source text preserves incomplete input while staff type. Command preparation
validates and normalizes it before retention and transport. Staff-assessed
applicability selects the responsible bodies and supporting sources explicitly.
Removing a body also removes its assessment reference. Unresolved scope remains
available through the neutral workflow and cannot authorize a configured bundle.

Study-area replacement uses the existing picker. Leaving the saved-area choice
requires a new boundary selection. Search, drawing and uploaded GeoJSON preserve
their distinct source paths and do not change authority statements. A null
resolved-place label stays blank rather than borrowing the former area name.
Uploads accept a closed WGS84 Polygon, MultiPolygon or single Feature up to 2 MB.
A late file read cannot replace a newer choice or modify disabled fields.

## Evidence boundary

The [form and route controls](context-authoring/form-controls.json) record a
passing baseline, harmless comment and 21 detected faults. The
[native controls](context-authoring/retained-area-controls.json) record baseline,
a harmless comment and four detected faults. All source is restored byte for byte.
The native candidate runs in a rollback-only transaction on the named isolated
verification database. Migration 6 remains unapplied at this checkpoint.

A new configured-checklist negative test initially named an unsupported plan
kind. Review corrected it to the actual registry key before the mutation run;
removing the assessment guard then fails that test. Earlier test invocations from
the repository root failed to load application aliases. They were rerun from the
nested package. A SQL-fixture edit anchor matched two owner updates and was made
specific before collection. TypeScript and React lint findings were corrected,
including effect-based ref synchronization and concise accessible field names.
These harness/development failures do not establish acceptance.

The DOM cases cover source typing, multiple bodies, jurisdiction non-inference,
retained geometry, picker callbacks, uploads and stale/disabled file completion.
They do not establish rendered appearance, keyboard behavior, accessibility or
practitioner acceptance. T3 still reports a preview attached; a new owned tab also
fails text-only snapshot capture on the same client. No browser fallback is used.

The final focused unit run passes 279 tests, with three database-gated suites
skipped. TypeScript, changed-file ESLint and the product-direction check pass.
The direction check retains its registry-age and version reminders. The
[unit log](context-authoring/unit.log) records the tested package and totals.

## Connect the complete workflow next

Mount the fields through a scoped context editor that validates GET responses and
keeps unreadable state distinct from historical absence. Preserve unsaved forms
under account/workspace/plan/version scope. Each browser instance must own its
mutable draft key; another instance must not erase it while clearing an older
save. Recovering someone else's stored draft starts a new owned copy.

Retain each normalized save command under its own immutable key before transport.
Keep its original draft and base context hash. Unknown responses require explicit
exact retry, with no automatic resubmission, resolver refresh or newer-version
substitution. Provide usable download/preserve/restore paths for malformed copies,
quota/readback failure and stale bases. A restored old draft must not silently gain
the current context hash. Confirmation verifies command/version/actor and refreshes
the plan before enabling a new freeze. Dirty or unresolved context editing must
join the workbench's existing unsaved-content freeze gate.

Then connect atomic creation using the same fields and prepared context, remove
the workspace-home applicability assumption, distinguish sourced plan-kind rules,
and collect the full M1 geography/authority cases. Public and exported presentation,
rendered desktop/390px recovery and practitioner/counsel acceptance remain open.
The roadmap remains the only work queue; this is implementation guidance within M1.
