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
(row counts, PR 410's invoice creators, pre-check 60) are for the window
record. Run `prechecks/60-live-traffic-and-handoffs.sql` last, right before
the dry run (see "Locks and live traffic"). `postchecks.sql` runs inside the
install transaction. Probes run after the install with
`kit.sh hosted $W probe /work/probes/<file>`; read their results as "Probes"
below says.

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

## Locks and live traffic

A live request that touches a locked table waits in the lock queue until the
install commits or its own statement times out. While the install waits for
a lock (at most 1 s, the kit's `lock_timeout` for the dry run and install),
every new reader of that table queues behind it too.
The install holds the Safety, export and invoice locks and asks for
`projects` last, so a request that already holds a `projects` lock and then
waits on a Safety table closes a cycle; after 1 s the deadlock detector ends
one side. **A lock timeout or a deadlock rolls the whole window back to 448
and ends it.** The kit never retries; PR 440's packet said to retry, and that
is struck. If the deadlock detector ends a live request instead, that user
sees an error once.

Right before the dry run, read `prechecks/60-live-traffic-and-handoffs.sql`.
Its first result lists transactions open for more than 1 s that hold a lock
on one of the nine tables above. If it returns rows, wait for them to finish
and read it again. An old-code Safety acquisition on a large study area
(up to 8 s per statement before PR 415) is the likeliest one.

## If the code merges first (hosted still at 448)

What a planner or operator sees, widest first:

- **AI calls, PR 409.** Every metered AI call goes through `reserveAiUsage`
  (`openplan/src/lib/runtime/ai-rate-limit.ts`), which calls
  `reserve_ai_usage` before the model call. Ten call sites use it: assistant
  chat, Planner Agent provider turns, analysis, grant narrative drafts, grant
  section drafts, report narrative drafts, RTP chapter drafts, RTP document
  extraction, engagement close-the-loop drafts and engagement moderation
  scans. With the function missing, what happens depends on who pays:
  - **A deployment-wide key pays** (`ANTHROPIC_API_KEY` set, plus
    `OPENPLAN_SHARED_AI_KEY=allow` in a production build): every one of those
    calls is refused with "AI usage could not be metered, so the deployment's
    shared AI key is not used".
  - **The workspace's own key pays:** the call goes ahead. `reserveAiUsage`
    logs `[ai-rate-limit] atomic usage reservation unavailable` and falls back
    to the earlier count-then-record limit, which is not atomic, so parallel
    calls can pass one count.
  - **No key:** AI is off for that workspace either way.

  Hosted, November 14, 2026 (the lead's check): no deployment-wide key is
  set. `ANTHROPIC_API_KEY` was removed from Production and Preview that day,
  and `OPENPLAN_SHARED_AI_KEY` is not set. So on hosted no call is refused;
  workspaces with their own key take the fallback path above, with one log
  line per call. A deployment that sets a shared key gets the refusal.
- **Application exports, PR 409.** Every application export answers 503
  naming migration `20261102110100`, and so does the export list.
- **Document library, PR 409.** The "Grant applications" group selects
  `sha256` (`openplan/src/lib/document-library/sources.ts`), so the knowledge
  base shows "Grant applications (unavailable)" and says the source is not
  set up on this installation yet. A project's documents read the same
  library and leave grant application exports out as not set up.
- **Safety and BCA, PR 408.** A Safety acquisition in Oregon, Iowa, Ohio or
  DC fails at its first write. A BCA save for a tribal area or a town reaches
  the database and is refused by `guard_project_bca_place_insert`
  ("Recorded project place reference is invalid").
- **PRs 410, 415 and 440:** the code does not depend on its migration; each
  defect stays open on hosted.
- `/api/health` reports the build's expected count (455). It does not read
  hosted history, so that number is informational, not a failure.

## What a planner or operator may see once

- **Award handoff preview, at the install.** `award_handoff_state`
  (`20261024200100`) fingerprints every application export row of an award's
  grant with `to_jsonb`, which includes NULL columns, so the two columns file
  4 adds change that fingerprint for every grant with at least one export. A
  handoff preview open across the install is refused once at apply with
  "Sources, outcomes or terms pointers changed; review again"; previewing
  again fixes it. Stored revisions are not rechecked, so nothing stored
  changes. Pre-check 60's second result counts the awards this can reach.
- **Saved report packets, after the merge (step 21).** The Oregon, Iowa, Ohio
  and DC crash adapters and the crash source registry change in this pull
  request, and all five are pinned by hash in the jurisdiction readiness
  registry. When the merge deploys, every saved report packet says its
  registry inputs changed and asks to be regenerated once more, on top of the
  November 14 re-pin. Regenerating records the new fingerprint. No stored
  crash record, count or grant rule changes.

## Post-checks

`postchecks.sql` runs inside the install transaction; any failure rolls the
window back to 448. Besides history, constraints and privileges, it checks
what each object does or is, not only that it exists:

- every function the seven files create or replace, by SHA-256 of its
  `pg_get_functiondef` (ten functions), and the owner (`postgres`) of the
  eight they create;
- the owner of `bca_snapshot_tigerweb_geoid_valid`, the one function whose
  catalog key `allowed_differences.json` lets differ (see its reason);
- row security enabled, and not forced, on `client_invoices` and
  `client_invoice_line_items`, and each of the six invoice writer policies
  calling `workspace_member_can_write_invoices`;
- the 415 triggers: the two fences per row, the nine revision and project
  triggers per statement with their transition tables;
- the 440 triggers: function, BEFORE, per row, events and `UPDATE OF`
  columns.

Lane 29 rehearsal, November 14, 2026 (scratch stack, PostgreSQL 17.11,
`supabase/postgres:17.11.0.006`): all post-checks pass at 455; a comment on a
function, table and trigger still passes; forcing row security, disabling it,
changing the helper's owner, adding one space to a function body, one policy
written without the helper, a 415 trigger made per row, and a 440 trigger
without `UPDATE OF` each fail with their own message. The definition hashes
are the same under three different `search_path` settings.

## Probes

Run after the install. Each ends in ROLLBACK, so nothing is kept. The kit's
envelope reads `probe-complete` only when the probe reached its end; every
other outcome reads `probe-failed`, and the first line of `stderrTail` says
which:

| `stderrTail` starts with | Meaning | Action |
|---|---|---|
| (envelope `probe-complete`) | The migration behaves as intended | Continue |
| `PROBE SETUP FAILED, probe N` | The probe could not build its synthetic rows or switch role. Says nothing about the migration | **Not a reason to roll back.** Record it; the post-checks inside the install already passed |
| `PROBE BLOCKED, probe N` | Live traffic held a lock past the 3 s lock timeout | Not a reason to roll back. Run the probe again later |
| `PROBE CHECK FAILED, probe N` | A refusal, allowed write, revision step or timing differs | Stop and review. Hosted at 455 with the old code is a safe hold; rollback is a separate decision |

Probes 415 and 440 write nothing to `auth.users`: they insert their
synthetic workspaces directly. Probe 410 still inserts four synthetic users,
because the invoice policies ask whether `auth.uid()` holds a role in
`workspace_members`, and `workspace_members.user_id` references
`auth.users`. Whether hosted lets `postgres` insert there is not known; if it
does not, probe 410 reads `PROBE SETUP FAILED`.

Lane 29 rehearsal, November 14, 2026, through the kit's own probe wrapper as
the non-superuser `postgres` role:

| Probe | At 448 | At 455 | At 455, INSERT on `auth.users` revoked from `postgres` |
|---|---|---|---|
| 410 | `PROBE CHECK FAILED`: Member created a draft invoice | `probe-complete` | `PROBE SETUP FAILED`: permission denied for table users |
| 415 | `PROBE CHECK FAILED`: canceling statement due to statement timeout (60 s) | `probe-complete`, 0.17 s per statement, revision 1 to 4 | `probe-complete` |
| 440 | `PROBE CHECK FAILED`: link to another workspace's project accepted | `probe-complete` | `probe-complete` |

Before this change all three probes read `permission denied for table users`
with no label in that last case.

## Rollback, per file, newest first

Each is a separate decision after the window (review 15, N11). Delete a
history row only when its file's effect is removed. Lane 29 rehearsed 7, 6,
5, 3 and 2 together at 455 on a scratch stack: the touched functions (by
definition hash and ACL), triggers and policies then matched the 448 stack
exactly.

**File 2 (408)** restores the two BCA functions from
`20261023190200_bca_project_place_snapshot.sql`. Take only lines 53 to 220 of
that file, which are its two `CREATE FUNCTION` statements
(`valid_bca_snapshot_jurisdiction` and `guard_project_bca_place_insert`),
and change `CREATE FUNCTION` to `CREATE OR REPLACE FUNCTION`. Do not take its
`REVOKE`, `GRANT` or `CREATE TRIGGER` lines: `CREATE OR REPLACE` keeps the
functions' privileges, and the trigger already exists, so that line would
fail. From the repository root:

```bash
git show <integration head>:openplan/supabase/migrations/20261023190200_bca_project_place_snapshot.sql \
  | sed -n '53,220p' | sed 's/^CREATE FUNCTION /CREATE OR REPLACE FUNCTION /' > $W/rollback-408-file2.sql
grep -c '^CREATE OR REPLACE FUNCTION' $W/rollback-408-file2.sql   # must print 2
sha256sum $W/rollback-408-file2.sql
# must print 4f11144d689c832a45158f0b31c1c7eda40eba44d07f73ed7e75d7bc41baa120
```

Run that file, then the `DROP FUNCTION` line for file 2 below.

```sql
-- 7 (440): no data change.
DROP TRIGGER IF EXISTS project_rtp_cycle_links_workspace_scope ON public.project_rtp_cycle_links;
DROP TRIGGER IF EXISTS projects_rtp_link_workspace ON public.projects;
DROP TRIGGER IF EXISTS rtp_cycles_rtp_link_workspace ON public.rtp_cycles;
DROP FUNCTION IF EXISTS public.guard_project_rtp_cycle_link_scope();
DROP FUNCTION IF EXISTS public.guard_rtp_link_parent_workspace();

-- 6 (415): restores the row triggers from 20261023190100 and 20260827000003
-- (their functions were never changed or dropped) and brings the
-- large-acquisition timeout back. PR 415's rollback, verbatim; run it as one
-- transaction.
BEGIN;
DROP TRIGGER IF EXISTS safety_comparison_crash_revision_insert ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_crash_revision_update ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_crash_revision_delete ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_party_revision_insert ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS safety_comparison_party_revision_update ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS safety_comparison_party_revision_delete ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision_insert ON public.safety_crashes;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision_update ON public.safety_crashes;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision_delete ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_crash_fence ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_party_fence ON public.safety_crash_parties;
CREATE TRIGGER safety_comparison_crash_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crashes FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.source_fence();
CREATE TRIGGER safety_comparison_party_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crash_parties FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.source_fence();
CREATE TRIGGER trg_safety_crashes_project_evidence_revision AFTER INSERT OR UPDATE OR DELETE ON public.safety_crashes FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('ingest_id', 'safety_crash_ingests');
DROP FUNCTION public.safety_crash_child_fence();
DROP FUNCTION public.safety_crash_child_revision();
DROP FUNCTION public.bump_project_revision_from_safety_crash_rows();
-- Only if the history row should go too, so a later install reapplies the file:
DELETE FROM supabase_migrations.schema_migrations WHERE version='20261102130000';
COMMIT;

-- 5 (410): no data change.
DROP POLICY client_invoices_invoice_writer_insert ON public.client_invoices;
DROP POLICY client_invoices_invoice_writer_update ON public.client_invoices;
DROP POLICY client_invoices_invoice_writer_delete ON public.client_invoices;
DROP POLICY client_invoice_line_items_invoice_writer_insert ON public.client_invoice_line_items;
DROP POLICY client_invoice_line_items_invoice_writer_update ON public.client_invoice_line_items;
DROP POLICY client_invoice_line_items_invoice_writer_delete ON public.client_invoice_line_items;
DROP FUNCTION public.workspace_member_can_write_invoices(uuid);

-- 4 (409): leave the columns (old code ignores them; dropping discards recorded hashes).

-- 3 (409): revert the code first; with this code live and a shared key, every metered call is refused.
DROP FUNCTION public.reserve_ai_usage(uuid, text[], integer, integer, text, text, text, jsonb);

-- 2 (408): after running $W/rollback-408-file2.sql (above):
DROP FUNCTION public.bca_snapshot_tigerweb_geoid_valid(text, text);

-- 1 (408): none. The wider CHECKs are harmless supersets; narrowing fails once a state row exists.
```
