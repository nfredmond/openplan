# November window: seven migrations in one transaction

Inputs for the hosted install kit (`scripts/ops/hosted-install/README.md`,
Phase C, steps 14 to 21). Hosted history moves from 448 rows through
`20261024200400` to 455 through `20261102140000`. Nothing here has run on
hosted. **Merging the integration pull request before this install breaks
production** (see "If the code merges first").

## Use

Copy this folder into the window folder `$W`. Copy `plan.template.json` to
`$W/plan.json` and fill `window`, `capture` (step 15's stamp), every file's
`commit` (the frozen integration head) and `historyStatements` (the format
`prechecks/00-history.sql` reports for the newest hosted rows; review 15,
N6). The template refuses to build until all four are filled. Pre-checks run
with `kit.sh hosted $W read /work/prechecks/<file>`; each check row reads
`pass`, and a differing check stops the read as `read-failed` with
`PRE-CHECK FAILED <check>: expected ..., found ...`. Informational rows
(row counts, PR 410's invoice creators) are for the window record. Probes run
after the install with `kit.sh hosted $W probe /work/probes/<file>`.
`postchecks.sql` runs inside the install transaction.

## The seven files, in install order

| # | File (PR) | What it changes | Locks it takes (rehearsal, held to commit) |
|---|---|---|---|
| 1 | `20261102100000_persist_state_injury_crashes` (408), self-wrapped | Widens `safety_crashes.source_id` to the four state layers and `safety_crash_ingests.coverage_state` to `state_injury_file`; validates both against existing rows | ACCESS EXCLUSIVE on `safety_crashes` and `safety_crash_ingests` from its `ALTER TABLE` statements: 0.44 s |
| 2 | `20261102100100_bca_tribal_and_town_place_kinds` (408), self-wrapped | Adds `bca_snapshot_tigerweb_geoid_valid`; replaces the BCA place guard and jurisdiction check to admit all seven place kinds | None on tables |
| 3 | `20261102110000_reserve_ai_usage` (409) | Adds `reserve_ai_usage`, service role only | None on tables |
| 4 | `20261102110100_application_export_custody` (409) | Adds nullable `sha256` and `appendix_manifest_json` with CHECKs to the application export register | ACCESS EXCLUSIVE on `funding_opportunity_application_exports`: 0.40 s |
| 5 | `20261102120000_client_invoice_owner_admin_writes` (410) | Adds `workspace_member_can_write_invoices` and six RESTRICTIVE writer policies | ACCESS EXCLUSIVE on `client_invoices` and `client_invoice_line_items` from `CREATE POLICY`: 0.38 s |
| 6 | `20261102130000_safety_crash_statement_revision` (415) | Replaces the per-row acquisition and project bumps on crash and person rows with statement triggers; keeps the per-row fence | ACCESS EXCLUSIVE on `safety_crash_parties` from `DROP TRIGGER IF EXISTS safety_comparison_party_fence`: 0.35 s. Its `DROP TRIGGER` on `safety_crashes` also asks for ACCESS EXCLUSIVE, already held from file 1. PR 415's packet said "brief ShareRowExclusiveLocks"; that was wrong |
| 7 | `20261102140000_project_rtp_cycle_link_workspace_scope` (440) | Adds two guard functions and three triggers keeping RTP links inside one workspace | ACCESS EXCLUSIVE on `project_rtp_cycle_links`, `projects` and `rtp_cycles` from each `DROP TRIGGER IF EXISTS` (even when the trigger does not exist): 0.30 s. PR 440's packet said SHARE ROW EXCLUSIVE |

Rehearsal: scratch stack at 448, PostgreSQL 17.11, managed default privilege
added. Install 765 ms inside the database, dry run 792 ms. The lock column is
the span a 2 ms poller saw each lock granted; `projects` is locked last. Every
read of `projects`, the Safety tables, invoices and the export register waits
behind these locks for that span; on hosted Micro compute it will be longer.
The kit stops the window if the hosted dry run takes over 5 s.

No file depends on another being installed in the same window. They run in
version order. Holding hosted at 455 with the old code is safe: the old code
ignores the new columns and functions, and the new policies and triggers
refuse only writes the old routes already refuse.

PR 440's packet said to retry if a lock timed out. Struck: the kit never
retries. A lock timeout (3 s) rolls the whole window back to 448 and ends it.

## If the code merges first (hosted still at 448)

- `/api/health` expects 455 migrations.
- PR 409: every application export answers 503 naming migration
  `20261102110100`, and so does the export list.
- PR 408: a Safety acquisition in Oregon, Iowa, Ohio or DC fails at its first
  write. A BCA save for a tribal area or a town reaches the database and is
  refused by `guard_project_bca_place_insert` ("Recorded project place
  reference is invalid").
- PRs 410, 415 and 440: the code does not depend on its migration; each
  defect stays open on hosted.

## Rollback, per file, newest first

Each is a separate decision after the window (review 15, N11). Delete a
history row only when its file's effect is removed.

```sql
-- 7 (440): no data change.
DROP TRIGGER IF EXISTS project_rtp_cycle_links_workspace_scope ON public.project_rtp_cycle_links;
DROP TRIGGER IF EXISTS projects_rtp_link_workspace ON public.projects;
DROP TRIGGER IF EXISTS rtp_cycles_rtp_link_workspace ON public.rtp_cycles;
DROP FUNCTION IF EXISTS public.guard_project_rtp_cycle_link_scope();
DROP FUNCTION IF EXISTS public.guard_rtp_link_parent_workspace();
-- 6 (415): restores the row triggers; brings the large-acquisition timeout back.
-- Use the BEGIN ... COMMIT block in PR 415's install packet verbatim (11 DROP TRIGGER,
-- 3 CREATE TRIGGER on the unchanged old functions, 3 DROP FUNCTION).
-- 5 (410): no data change.
DROP POLICY client_invoices_invoice_writer_insert ON public.client_invoices;
DROP POLICY client_invoices_invoice_writer_update ON public.client_invoices;
DROP POLICY client_invoices_invoice_writer_delete ON public.client_invoices;
DROP POLICY client_invoice_line_items_invoice_writer_insert ON public.client_invoice_line_items;
DROP POLICY client_invoice_line_items_invoice_writer_update ON public.client_invoice_line_items;
DROP POLICY client_invoice_line_items_invoice_writer_delete ON public.client_invoice_line_items;
DROP FUNCTION public.workspace_member_can_write_invoices(uuid);
-- 4 (409): leave the columns (old code ignores them; dropping discards recorded hashes).
-- 3 (409): revert the code first; with this code live, the shared key refuses every metered call.
DROP FUNCTION public.reserve_ai_usage(uuid, text[], integer, integer, text, text, text, jsonb);
-- 2 (408): CREATE OR REPLACE both functions from 20261023190200_bca_project_place_snapshot.sql, then
DROP FUNCTION public.bca_snapshot_tigerweb_geoid_valid(text, text);
-- 1 (408): none. The wider CHECKs are harmless supersets; narrowing fails once a state row exists.
```
