# Restored-schema cascade failure

October 7, 2026. PR #126 commit `67b052123750d6fcf91cb9539dccefcdfbdd3b13`
passes seven GitHub checks, including live RLS. Its full archive restore drill
fails two native land-use cases. This is a merge blocker, not a reason to remove
the assertions or rerun until green.

The [failed run](https://github.com/nfredmond/openplan/actions/runs/37641627241)
passes 95 native suites and fails creation and freeze persistence. In the
creation case, workspace deletion cascades to content before the version is
removed. The draft-counter trigger tries to update that version after its
workspace row has gone, violating `land_use_plan_versions_workspace_id_fkey`.
In the freeze case, deleting the plan cascades to relationships while its frozen
version still exists. The content guard treats that parent deletion as an
ordinary forbidden edit.

The initial diagnosis is that these triggers rely on foreign-key cascade order.
A restored schema can preserve the foreign keys while creating their internal
triggers in a different order. Local reproduction must establish that explanation.
A correction must allow deletion only when the owning plan or workspace is
already gone, keep direct frozen-content and journal edits forbidden, and avoid
updating draft counters for a parent deletion. It must cover implementation
records and append-only journals as well as the two observed failures.

## Local correction and evidence

The local reproduction confirms the diagnosis. Recreating equivalent parent
foreign keys after the child constraints reproduces both exact errors with the
old functions. Every probe runs in a transaction that rolls back schema changes
and synthetic records. The [old creation](restore-cascade/old-creation.log) and
[old freeze](restore-cascade/old-freeze.log) failures remain available.

Migration `20261016000009` checks whether the owning version, plan and workspace
still exist before applying child-delete guards. Parent cascades skip draft
counter updates and frozen-content restrictions only after an owner disappears.
Direct frozen content, relationship, action and journal deletions remain refused.
Frozen implementation status updates remain permitted. The helper runs with the
caller's privileges and matching workspace keys; existing RLS remains in force.

The broader workspace probe exposed a second dependency. A freeze receipt had
no direct workspace foreign key. Its review event could disappear before the
plan cascade reached the receipt, violating the receipt's event reference.
The migration adds a workspace cascade to the receipt. Its version and event
references still use NO ACTION, retaining protection against individual record
removal. The [controlled failure](restore-cascade/missing-receipt-workspace-fk.log)
records the omitted-fix behavior.

The native suite covers six scenarios: creation, plan and workspace deletion
after freezing, plan and workspace deletion after context changes, and ordinary
draft revision tracking. It also checks direct frozen changes under authenticated
writer RLS. The [controls](restore-cascade/controls.json) contain six passing
baselines, a harmless survivor and 13 detected faults, including the original
defects. Migration source bytes remain unchanged. The [reproduction script](restore-cascade/controls.py)
requires an explicitly named disposable restore-target container. No reset or
persistent migration occurs in these probes.

PostgreSQL documents that cascades execute child-table triggers and that those
triggers must preserve referential integrity. See [trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html).
The local failure establishes this application's defect; documentation alone
does not prove the correction.

TypeScript, changed-file ESLint and the product-direction check pass. A first
TypeScript invocation exhausted a 4 GiB Node heap; the sequential retry with a
6 GiB heap passes. This is not a system-memory capacity guarantee.

The complete GitHub archive restore drill must still pass on the corrected
commit. Local transaction probes do not replace an archive restore, current
rendered workflow acceptance, practitioner review or V1 acceptance. The migration
is not yet installed on the isolated local stack. No release or merge is claimed.


The subsequent [combined installed checkpoint](RULE_RECONCILIATION_BACKEND.md#installed-isolated-stack-checkpoint)
applies migrations 9 and 10 to the isolated stack and passes all 13 installed
native cases. That supersedes the uninstalled state above. The full GitHub
archive restore and rendered acceptance remain separate.
