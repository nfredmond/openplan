# Preserve finalized GIS records through restored parent cascades

October 7, 2026. PR126 at `418ba38f` passes QA, shuffled tests, live RLS and the
worker checks. Its [full archive restore](https://github.com/nfredmond/openplan/actions/runs/37651187314)
fails one native case after 97 suites pass. The failure is a finalized GIS
version guard, separate from the earlier land-use trigger correction.

## Failure and correction

During workspace deletion, the restored schema reaches GIS versions before their
parent layer. The old guard permits deletion after the layer disappears, but
refuses while that row remains. The workspace has already gone. Recreating the
same foreign keys in child-first order [reproduces the exact error](gis-cascade/restored-order-failure.log).
All constraint changes and synthetic records roll back.

Migration `20261016000011_workspace_gis_cascade_guards.sql` checks whether the
layer and workspace still exist before refusing a finalized-version deletion.
The feature guard also recognizes a deleted owning version, layer or workspace.
Direct changes to finalized versions and features remain prohibited while their
owners exist. Mutable versions remain editable and can be deleted normally.
Existing foreign keys and RLS remain in force; neither function gains definer
privileges.

The feature test exposes another preservation gap. The old UPDATE guard checks
the destination version but not the original version, permitting a feature to
move out of a finalized edition into an editable one. The [installed old-function probe](gis-cascade/old-feature-move-failure.log)
confirms that move is accepted. The corrected guard checks both versions. Insertions into a finalized version and direct feature deletions
remain refused.

## Evidence

The [native suite](gis-cascade/native-correction.log) passes eight cases with
migration 11 applied inside each rollback transaction. It includes the six
existing land-use cascade cases plus GIS layer and workspace deletion with
finalized feature rows present. Direct update, delete, unfreeze, incoming-feature,
outgoing-feature and insertion refusals precede the permitted cascade checks.
The fixture derives the ready feature count from its actual feature rows.

The [controls](gis-cascade/controls.json) retain two passing baseline/harmless
cases and ten faults that fail the expected assertions. They remove workspace
or layer custody checks and selectively permit version or feature changes.
The migration source hash matches before and after. The script explicitly
requires an owned idle checkout and the named isolated verification stack.
Migration 9's CREATE probe remains disabled; installed migrations 9 and 10 are
not replayed.

The first reorder attempt still deleted the GIS layer before its versions and
did not reproduce the failure. The corrected ordering places that parent
constraint last. The first feature fixture also failed the existing ready-count
constraint; deriving the actual count repairs the fixture. Both attempts remain
in the evidence directory. No production constraint was removed to make them pass.

TypeScript, changed-file ESLint, 41 schema/GIS tests and the product-direction
check pass. Existing direction-review reminders remain unchanged. Migration 11
is not installed by these rollback probes.

## Verification boundary

These are native synthetic transaction checks, not a complete archive restore
or an application journey. The privileged fixture isolates trigger behavior;
current-role RLS is a separate suite. Existing direct-write land-use probes also
run under authenticated writer RLS. GIS geometry accuracy, import usability,
cartographic rendering and planner acceptance are not assessed here.

The full GitHub restore drill must pass on the corrected branch before merge.
The T3 host is disconnected and browser acceptance remains unfinished. No release,
M1 completion or V1 acceptance is claimed.
