# Publish one adopted-version packet in one transaction

October 16, 2026. This candidate addresses the publication-pointer race within
KI-2026-10-12-025. It does not close that issue, M1, or V1.

## Separate writes allow two publications to overwrite one pointer

At parent `b1f4aaa5fa6874af45afb75d9172b5ac6f7486e9`, the decisions route reads
the version pointer, inserts a report, inserts its artifact, then updates the
pointer. Two calls can both read NULL and create different reports. Their later
updates compete for one pointer. The report snapshot reader requires that pointer
to identify the report, so the overwritten report cannot satisfy its reader.
This is source reasoning. No concurrent native reproduction runs in this lane.

A pointer-only compare-and-set would retain partial reports and artifacts.
The candidate instead saves all three records through one PostgreSQL function.
An exception rolls back the function's changes with its caller transaction.
The old route's partial cleanup path is removed.

## The current adopted version chooses its canonical packet

The new service-role-only SECURITY INVOKER function locks the scoped plan first,
checks and locks current writer membership, then locks the selected version.
NOWAIT returns a conflict during another write. It requires the current adopted
pointer, version state and requested content hash to agree. PostgreSQL documents
the row-lock conflict behavior; the candidate's actual interleaving remains a
native test obligation. [PostgreSQL 17 row locking](https://www.postgresql.org/docs/17/explicit-locking.html).

The route passes the authenticated actor from existing access verification.
The function checks current owner/admin/member membership again. The function
accepts no user-selected role and grants no table privilege or schema access.
PUBLIC, anon and authenticated cannot execute it. This remains a trusted server
operation, rather than a new agent action or direct client API.

The helper validates the retained snapshot with the existing frozen reader.
It sends the existing JavaScript canonical serialization unchanged. SQL compares
the parsed value to the stored snapshot and hashes those supplied text bytes.
It does not substitute PostgreSQL JSONB text for the historical content hash.
Plan, version and version-number identity must match independently.

The function selects the retained adoption/amendment decision for that version,
with deterministic date, creation-time and ID ordering. It verifies the manifest's
hash and retained scope/review-release references. It does not recalculate adoption,
read current registry rules or change the human decision record.

If a pointer exists, the function verifies its report scope/type/status and one
HTML artifact. Artifact version, content, frozen snapshot and retained decision
must agree. A missing, ambiguous or inconsistent packet refuses. No legacy repair,
pointer reassignment or orphan deletion runs. A verified existing packet retains
its original title, even when a later caller supplies a different title.

If no pointer exists, the function inserts one report and one HTML artifact, then
updates the NULL pointer under its version lock. An unmatched update raises an
exception. The report's artifact URL identifies `/reports/<reportId>`; the separate
public URL continues to mean the plan's latest adopted edition. A later adoption
can change that public page. The public URL is not an immutable version identifier.

The response reader checks typed report/artifact IDs and exact workspace, plan,
version and hash. A newly created packet must also retain the requested title.
An unconfirmed or malformed response remains unavailable. Retrying the same
current adopted version checks its saved packet rather than creating another.

## Current scope and remaining proof

This serializes publication calls through the new route/function. It does not
make every historical report immutable or constrain every privileged/direct
table writer. No new uniqueness constraint rewrites legacy artifact history.
Recovery after the selected edition becomes superseded still follows the existing
historical report/workbench readers; this command requires the current adopted
version. Database-wide hostile-writer and rollout interleavings need separate
assessment.

The new filename comes from the pinned official Supabase 2.75.0 CLI's offline
`migration new` command. Generation also runs the actual nested direction check,
version and installed subcommand help in one bounded unit. It creates an empty
private file before SQL authoring. No database command, migration application,
repair, reset or hosted operation runs. [Supabase migration command](https://supabase.com/docs/reference/cli/supabase-migration-new).

Focused tests exercise the actual helper and route with supplied database
responses. SQL checks inspect the actual migration's text intent. Harmless and
named faulty variants must show those assertions can distinguish selected wrong
behavior. They cannot prove PostgreSQL parsing, transaction rollback, row locking,
RLS, stored history, browser behavior or an independently usable public packet.
Those boundaries require a separately reviewed exact-history native target and
an identified-build desktop/390px journey with console and artifact review.
