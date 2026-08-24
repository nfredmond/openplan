import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, migrationFiles, readMigration, splitTopLevel, unquoteLiteral } from "./read-migrations";
import { UnexpandableDynamicSqlError, expandDynamicPolicyStatements, stringLiteralRanges } from "./plpgsql-expansion";
import {
  classifyRoleAwareness,
  classifyWorkspaceScope,
  isWriteCommand,
  loadPolicyInventory,
  parsePolicyRoles,
  type PolicyStatement,
} from "./policy-inventory";
import { loadSchemaInventory } from "./schema-inventory";
import { describeViolations, loadGrantInventory, parseGrantStatement } from "./grant-inventory";

/**
 * GUARD THE GUARDS — this module tree is now load-bearing for five test files,
 * so it needs its own.
 *
 * The exact counts below are not decoration. The defect that motivated all of
 * this was a parser that silently reported a SMALLER schema than the one that
 * exists: 12 policies were invisible to `viewer-write-denial-guard.test.ts`
 * because they are built by `EXECUTE format(…)` at migration time, and the suite
 * stayed green while three tables' role gates rested on a coincidence. A floor
 * (`>= 70`) cannot catch that — it tolerates exactly the kind of shrinkage that
 * hid the bug. An equality can only move in a commit that also explains why.
 *
 * Every number here was verified against the running local Postgres at the time
 * it was written: 540 policies matched `pg_policies` on
 * (tablename, policyname, cmd, permissive) with both set differences EMPTY;
 * 1,466 columns matched `information_schema.columns` with the only live-side
 * extras belonging to PostGIS's own `spatial_ref_sys`; and the 106 RLS-enabled
 * tables matched `pg_tables.rowsecurity` exactly.
 *
 * If one of these fails after a schema change, read the number as a question —
 * "did you mean to add/remove that?" — and update it in the same commit.
 */

const EXPECTED = {
  // +2 permissive UPDATE policies from 20260728000010 (runs, project_rtp_cycle_links).
  // +2 permissive policies (SELECT + INSERT) from 20260728000012
  // (vmt_significance_screenings), whose INSERT policy is role-AWARE — it calls
  // workspace_member_can_write — so it needs no restrictive writer gate and the
  // restrictive count is unchanged. +1 table, +1 view, +1 RLS-enabled table.
  //
  // +4 permissive policies (SELECT + INSERT + UPDATE + DELETE) from
  // 20260729000002 (engagement_context_layers), the GIS context layers an
  // operator puts on participant maps. All three writes are role-AWARE for the
  // same reason, so `restrictive` again does not move — that is the intended
  // shape for a new table, and the 240 restrictive policies remain a retrofit
  // of 80 older tables whose policies were written role-blind. +1 table,
  // +1 RLS-enabled table, +1 table with policies, and no new view.
  //
  // 20260729000003 (engagement_campaigns.place_*) moves NOTHING here, and that
  // is the whole entry: it adds nullable columns to a table that already exists
  // and already has its policies, so no count below changes. Recorded because a
  // reader diffing the migration list against these notes would otherwise find
  // it unaccounted for and have to re-derive that absence.
  //
  // +4 permissive policies (SELECT + INSERT + UPDATE + DELETE) from
  // 20260729000004 (engagement_content_translations), the per-locale variants of
  // the text an agency wrote for its participant surfaces. All three writes are
  // role-AWARE — each calls workspace_member_can_write — so `restrictive` again
  // does not move, which is the intended shape for a new table. +1 table,
  // +1 RLS-enabled table, +1 table with policies, and no new view. The same
  // migration also adds engagement_campaigns.default_content_locale, which
  // changes no count here for the reason 20260729000003 did not.
  //
  // These four are the only numbers in this block NOT standing on a live schema:
  // 20260729000004 is in the tree and not yet applied. They were verified the
  // nearest available way instead — the migration was executed inside a
  // BEGIN/ROLLBACK against the local database, where `pg_policies` returned
  // exactly these four policies (one SELECT, three role-aware writes),
  // `relrowsecurity` was true, and the constraint list matched the file. Re-check
  // against `pg_policies` once it is applied for real.
  // +0 policies from 20260730000003 (engagement_survey_response_drafts), and
  // that zero is the point: a part-finished survey response is as sensitive as a
  // submitted one, so the table gets RLS ENABLED WITH NO POLICIES and REVOKE
  // ALL FROM anon, authenticated — the same service-role-only posture as
  // engagement_survey_response_sessions / _answers. It therefore moves
  // `relations`, `tables` and `rlsEnabledTables` by one each and nothing else.
  // Verified by parsing the migration file; it is in the tree and not yet
  // applied to a live database.
  // 20260730000004 (aerial_artifact_custody) moves the RELATION counts and
  // nothing else, which took two offsetting changes to be true and is worth
  // spelling out rather than leaving as a coincidence:
  //   +1 permissive SELECT policy for the new table (workspace members read
  //      custody facts), and
  //   -1 permissive SELECT policy, because the same migration DROPs
  //      workspace_members_can_read_aerial_processing_callbacks. That ledger's
  //      `payload` is the vendor callback verbatim, and a succeeded callback
  //      carries signed artifact download URLs — bearer credentials for the
  //      agency's own imagery — so it becomes service-role-only. No application
  //      code read it with a user client.
  // `tablesWithPolicies` therefore also holds at 108: aerial_processing_callbacks
  // leaves the set (that was its only policy; it is in neither writer-gate
  // migration) exactly as aerial_artifact_custody joins it. The new table grants
  // no write policies, so `restrictive` and `permissiveWrites` do not move — RLS
  // with no write policy denies PostgREST writes outright, the same posture as
  // its sibling aerial_processing_jobs.
  // +1 relation, +1 table, +1 RLS-enabled table. Verified by parsing the
  // migration file; it is in the tree and not yet applied to a live database.
  // 20260730000008 / 20260730000009 move NOTHING here, and that is worth
  // recording rather than leaving unaccounted for: both are pure GRANT/REVOKE
  // migrations. This inventory tracks relations, policies and RLS flags, none of
  // which a privilege change touches. The revokes they perform are asserted
  // live instead, in `rls-isolation.test.ts` ("hardening of 2026-08-03 stays in
  // force"), because a grant is not visible in the schema shapes parsed here.
  //
  // +10 rlsEnabledTables from 20260730000010 (the eight GTFS child tables:
  // agencies, routes, stops, trips, stop_times, shapes, calendar,
  // calendar_dates) and 20260730000011 (census_tracts, lodes_od). No new
  // relation, no new policy — every one of these ten ALREADY had its policy and
  // had carried it, unenforced, since 20260420000062. `ALTER TABLE … ENABLE ROW
  // LEVEL SECURITY` had never been run on any of them, so `policies`,
  // `tablesWithPolicies`, `relations`, `tables` and `views` all hold exactly
  // where they were and only the RLS count moves. That +10 with +0 policies is
  // the signature of this defect class, and it is the number to look at first if
  // it ever appears again.
  //
  // 20260805000003 (RTP financial element) adds THREE tables —
  // rtp_horizon_bands, rtp_financial_assumptions, rtp_performance_measures —
  // each with four PERMISSIVE policies (one read, three writes) built through a
  // `DO` loop, so every delta below is a multiple of three:
  //
  //   policies            552 -> 564  (+12 = 4 x 3)
  //   permissive          312 -> 324  (+12; all four are permissive)
  //   restrictive         240 -> 240  (+0, and deliberately: writes are
  //                                   role-aware at the permissive layer via
  //                                   workspace_member_can_write, so these
  //                                   tables need no companion RESTRICTIVE
  //                                   gate from 20260728000006. A copy of the
  //                                   OLD RTP policies would have shown +0 here
  //                                   too while leaving every viewer a writer —
  //                                   so this zero is only correct alongside
  //                                   the +9 permissiveWrites below.)
  //   permissiveWrites    204 -> 213  (+9 = 3 write policies x 3)
  //   expanded            252 -> 264  (+12; all twelve are EXECUTE format in a
  //                                   DO loop, so they exist only after
  //                                   plpgsql expansion)
  //   tablesWithPolicies  108 -> 111  (+3)
  //   relations           127 -> 130  (+3)
  //   tables              121 -> 124  (+3)
  //   views                 6 ->   6  (+0)
  //   rlsEnabledTables    121 -> 124  (+3; equal to `tables`, which is the
  //                                   invariant that matters — a new table
  //                                   missing ENABLE ROW LEVEL SECURITY shows
  //                                   up here as tables > rlsEnabledTables)
  //
  // 20260805000006 (GTFS service levels) adds THREE tables —
  // gtfs_feed_versions, gtfs_route_service_levels, gtfs_stop_service_levels —
  // each with ONE permissive SELECT policy and no client write policy at all
  // (every write is service-role behind an explicit membership check, the
  // Knowledge Base posture), so `restrictive` does not move: there is no
  // permissive write for a writer gate to narrow. It also adds TWO permissive
  // write policies to the EXISTING gtfs_feeds — the UPDATE and DELETE partners
  // its restrictive `_writer_only_*` gates from 20260728000006 had been sitting
  // without, which is the `runs` defect from 20260728000010 pre-armed: every
  // client UPDATE matched zero rows and supabase-js reported `error: null`.
  // So: +5 policies, +5 permissive, +2 permissiveWrites, +3 tablesWithPolicies
  // (gtfs_feeds was already in the set), +4 relations, +3 tables, +1 view
  // (gtfs_stops_map, which exists because supabase-js cannot read a PostGIS
  // geometry — PostgREST returns hex EWKB and nothing here parses it),
  // +3 rlsEnabledTables. `expanded` holds at 264: these policies are written
  // literally, not through a DO/EXECUTE loop.
  //
  // 20260805000009 (Title VI service equity) adds TWO tables.
  // `title_vi_policies` is a document a planner authors, so it takes the full
  // client-writable set: FOUR permissive policies (select/insert/update/delete)
  // and THREE restrictive `_writer_only_*` gates, matching every other
  // workspace-scoped table a member edits. `gtfs_tract_service` is DERIVED by a
  // spatial join at ingest and is service-role-authored, so it takes ONE
  // permissive SELECT and no write policy at all — the same posture as the
  // service-level tables it reads.
  // So: +8 policies, +5 permissive, +3 restrictive, +3 permissiveWrites,
  // +2 tablesWithPolicies, +2 relations, +2 tables, +2 rlsEnabledTables.
  // `views` holds at 7 and `expanded` at 264: this migration declares no view
  // (the tract table carries no geometry of its own — it references tracts by
  // GEOID, so there is nothing for a GeoJSON view to convert) and writes every
  // policy literally rather than through a DO/EXECUTE loop.
  //
  // 20260810000003 (engagement_campaign_projects) adds ONE table — the
  // campaign-covers-project join, in which engagement_campaigns.project_id
  // stays the LEAD and the join carries the full covered set including it.
  // THREE permissive policies (select/insert/delete — no UPDATE, because a
  // link row is an immutable pair and correcting one is delete-and-insert).
  // Both writes are role-aware AT THE PERMISSIVE LAYER via
  // workspace_member_can_write — the intended post-20260728000006 shape — so
  // the table carries NO restrictive companion gates.
  // So: +3 policies, +3 permissive, +0 restrictive, +2 permissiveWrites,
  // +1 tablesWithPolicies, +1 relation, +1 table, +1 rlsEnabledTable.
  // `views` holds at 7 and `expanded` at 264: no view, and every policy is
  // written literally.
  //
  // 20260811000001 (aerial_flight_plans) adds ONE table — the planner-authored
  // flight plan, one per mission. FOUR permissive policies (one read, three
  // writes), every write role-aware AT THE PERMISSIVE LAYER via
  // workspace_member_can_write — the intended post-20260728000006 shape — so
  // the table carries NO restrictive companion gates.
  // So: +4 policies, +4 permissive, +0 restrictive, +3 permissiveWrites,
  // +1 tablesWithPolicies, +1 relation, +1 table, +1 rlsEnabledTable.
  // `views` holds at 7 and `expanded` at 264: no view, and every policy is
  // written literally.
  //
  // 20260811000002 (aerial_imagery) adds ONE table — one row per stored
  // mission photo, bytes in the private aerial-imagery bucket. ONE permissive
  // policy: member SELECT only. NO write policies ON PURPOSE — the custody
  // posture: photo bytes must transit an authed route (membership + role gate
  // checked there), which then writes with the service role, so a client-side
  // write policy would be a hole. authenticated is GRANTed SELECT only.
  // So: +1 policy, +1 permissive, +0 restrictive, +0 permissiveWrites,
  // +1 tablesWithPolicies, +1 relation, +1 table, +1 rlsEnabledTable.
  // `views` holds at 7 and `expanded` at 264.
  //
  // 20260811000007 (work_notifications) adds ONE table — one deadline reminder
  // for one person, written by the daily sweep with the service role. FIVE
  // policies: a recipient-scoped SELECT, a recipient-scoped mark-read UPDATE,
  // and the three restrictive `_writer_only_*` gates that a role-blind
  // workspace write requires. NO permissive INSERT and no permissive DELETE:
  // the row is evidence that someone was told, so its subject may not author or
  // destroy it.
  // So: +5 policies, +2 permissive, +3 restrictive, +1 permissiveWrites,
  // +1 tablesWithPolicies, +1 relation, +1 table, +1 rlsEnabledTable.
  // `views` holds at 7 and `expanded` at 264 — every policy here is literal.
  //
  // 20260811000008 (rtp_extraction_runs, rtp_extraction_candidates) adds TWO
  // tables — the staging floor between a model transcribing an adopted RTP and
  // that plan's own numbers entering OpenPlan. ONE permissive policy each:
  // member SELECT. NO write policies at all, following aerial_imagery and
  // kb_documents: a candidate row is a claim that some text was quoted
  // verbatim off a page, and a client writing one directly through PostgREST
  // would be a claim that never met the verifier. `authenticated` is GRANTed
  // SELECT only; every write is an authed route using the service role.
  // So: +2 policies, +2 permissive, +0 restrictive, +0 permissiveWrites,
  // +2 tablesWithPolicies, +2 relations, +2 tables, +2 rlsEnabledTables.
  // `views` holds at 7 and `expanded` at 264 — both policies are literal
  // (written inside a pg_policies-guarded DO block, which is plain SQL text
  // rather than EXECUTE format, so nothing is rendered).
  //
  // 20260811000009 (the four extraction_candidate_id provenance columns) moves
  // NOTHING here, and that zero is the entry: it adds one nullable column and
  // one partial index to each of four existing tables, creating no relation, no
  // policy and no grant. Recorded so a reader diffing the migration directory
  // against these notes does not have to re-derive its absence.
  //
  // 20260811000010 (kb_ocr_jobs, kb_ocr_job_callbacks) adds TWO tables for the
  // OCR lane — one job per scanned document sent to a self-hosted recogniser,
  // and the idempotency ledger for its callbacks. They take DIFFERENT postures,
  // which is why the two counts move by different amounts:
  //   * kb_ocr_jobs — ONE permissive policy, member SELECT. No write policy: a
  //     client-written job row would be a way to make a document claim text
  //     nobody recognised. Every write is an authed route or the
  //     bearer-authenticated callback route, both using the service role.
  //   * kb_ocr_job_callbacks — ZERO policies, row security ON. Unreadable by
  //     every client role regardless of grants, which is the strongest of the
  //     three postures and the one aerial_processing_callbacks reached the slow
  //     way (its member-read policy was dropped in 20260730000004). The ledger
  //     is plumbing; a planner reads the JOB, not the deliveries that advanced
  //     it. So it is a table with RLS and no policies — counted in `tables` and
  //     `rlsEnabledTables`, deliberately NOT in `tablesWithPolicies`.
  // So: +1 policy, +1 permissive, +0 restrictive, +0 permissiveWrites,
  // +1 tablesWithPolicies, +2 relations, +2 tables, +2 rlsEnabledTables.
  // `views` holds at 7 and `expanded` at 264: no view, and the one policy is
  // written literally.
  //
  // The same migration widens kb_documents.extraction_source's CHECK to admit
  // 'ocr'. That moves nothing here — it drops and re-adds a constraint on an
  // existing table — and it is recorded because a reader diffing the migration
  // directory would otherwise have to re-derive the absence.
  //
  // 20260812000001 (the neutral crash dimensions) moves NOTHING here, and the
  // zero is the entry: it adds columns and CHECK constraints to two existing
  // tables and issues the first GRANT/REVOKE either has ever had. Privileges are
  // not schema shapes — they are replayed by `grant-inventory.ts` and asserted by
  // the locked-door guard — so no count below can see them.
  //
  // 20260812000002 (safety_crash_parties) adds ONE table — one person in one
  // observed collision, carrying a neutral role, an age BAND and an injury
  // outcome. ONE permissive policy: member SELECT. NO write policies at all,
  // following aerial_imagery and the OCR job tables: every write is an authed
  // route using the service role after a membership check, so a client-side
  // write policy would be a hole in a table that holds injury outcomes. `anon`
  // is granted nothing and never will be.
  // So: +1 policy, +1 permissive, +0 restrictive, +0 permissiveWrites,
  // +1 tablesWithPolicies, +1 relation, +1 table, +1 rlsEnabledTable.
  // `views` holds at 7 and `expanded` at 264: no view, and the policy is written
  // literally inside a pg_policies-guarded DO block, which is plain SQL text
  // rather than EXECUTE format, so nothing is rendered.
  //
  // 20260812000003 (safety_crash_evidence_counts) moves NOTHING here, and the
  // zero is the entry: it creates one SECURITY INVOKER function that groups
  // severity and person-role counts for a set of acquisitions, and functions are
  // neither relations nor policies. Its REVOKE/GRANT is a privilege, replayed by
  // `grant-inventory.ts` rather than counted below. Recorded because a reader
  // diffing the migration directory against these notes would otherwise have to
  // re-derive the absence.
  //
  // 20260812000011 (the self-help local measure fund) adds SIX tables — the
  // measure, its accounting periods, its effective-dated allocation rules, its
  // sub-recipients, the apportionment figures a person states for them, and
  // what each period allocated. TWENTY-ONE permissive policies and NO
  // restrictive ones, and the zero is the deliberate part: every write policy
  // calls `workspace_member_can_write`, so it is role-AWARE at the permissive
  // layer and needs no `_writer_only_*` companion to supply the role. That is
  // the shape argued for `rtp_horizon_bands` and `engagement_context_layers`,
  // and adding gates anyway would fail viewer-write-denial-guard's "keeps the
  // gate list honest" assertion — a gate over a table with no role-blind policy
  // is either dead weight or a sign the inventory cannot read the policies.
  //
  // The 21 rather than 24 is also deliberate, three tables being narrower than
  // the usual read/insert/update/delete set:
  //   * measure_recipients — no DELETE (the invoicing_clients posture: a body
  //     that has been paid public money must keep appearing on the record that
  //     paid it; `is_active` retires it).
  //   * measure_allocation_rules — no UPDATE (a rule version is what an
  //     ordinance said on a date; an amendment is a new effective-dated row).
  //   * measure_recipient_basis_values — no UPDATE (a stated figure with a
  //     named source and a stater is a record, restated by a new vintage).
  // Each table's GRANT names exactly those commands, so the locked-door guard
  // holds without widening the audited posture by one privilege.
  // So: +21 policies, +21 permissive, +0 restrictive, +15 permissiveWrites
  // (3+3+2+2+2+3), +6 tablesWithPolicies, +6 relations, +6 tables,
  // +6 rlsEnabledTables. `views` holds at 7 and `expanded` at 264: no view, and
  // every policy is written literally rather than through EXECUTE format.
  //
  // 20260812000012 (claims against the measure fund) adds THREE more: the
  // claims themselves, the link onto kb_documents that carries their backup,
  // and the maintenance-of-effort record. ELEVEN permissive policies, no
  // restrictive ones — the same role-aware shape as 20260812000011, and the
  // same reason.
  //
  // Eleven rather than twelve because `measure_claim_documents` has no UPDATE
  // policy: an attachment ASSERTS that this document substantiates this claim,
  // and an assertion is withdrawn by detaching rather than edited.
  //
  // One of the eight write policies is doing more than a role check, and it is
  // worth naming here because a future reader counting policies will not see
  // it: `measure_claims_delete` is
  //
  //     USING (workspace_member_can_write(workspace_id) AND status = 'draft')
  //
  // so a submitted or paid claim cannot be deleted by anyone, through any
  // route. That is a mechanism rather than a convention — a second writer
  // inherits it without knowing it exists — and it is asserted by name in
  // `measure-claims-migration.test.ts`.
  //
  // So: +11 policies, +11 permissive, +0 restrictive, +8 permissiveWrites
  // (3+2+3), +3 tablesWithPolicies, +3 relations, +3 tables, +3
  // rlsEnabledTables. `views` holds at 7 and `expanded` at 264.
  //
  // 20260812000014 (what the fund took off the top, and the atomic replacement)
  // adds ONE table, `measure_period_off_the_top`. THREE permissive policies and
  // no restrictive ones — the same role-aware shape as the two migrations above.
  //
  // Three rather than four because there is no UPDATE: a period's off-the-top
  // is replaced wholesale together with its category allocations, never edited
  // in place, and a table with no UPDATE policy cannot be edited in place by a
  // future route that forgot why. Its GRANT names exactly SELECT, INSERT,
  // DELETE for the same reason.
  //
  // The migration also creates `replace_measure_period_allocation`, which moves
  // none of these counts: this inventory is about tables, views and policies,
  // and a function's EXECUTE grant is audited by
  // `measure-off-the-top-migration.test.ts` instead.
  //
  // So: +3 policies, +3 permissive, +0 restrictive, +2 permissiveWrites
  // (INSERT + DELETE), +1 tablesWithPolicies, +1 relations, +1 tables, +1
  // rlsEnabledTables. `views` holds at 7 and `expanded` at 264.
  // 20260812000015-18 (workspace GIS layers) add FOUR tables — the layer, its
  // versions, its PostGIS features, and the references that make deletion
  // refusable — for a total of 14 permissive policies and no restrictive ones,
  // the role-aware shape every new table now takes.
  //
  // Four policies each on the layer and version tables; THREE each on the
  // feature and reference tables, and both threes are load-bearing. A stored
  // shape is never edited in place — a corrected file is a new version — so
  // there is no UPDATE policy on `workspace_gis_features` and its GRANT names
  // exactly SELECT, INSERT, DELETE. An adoption is a fact with a date rather
  // than a field to edit, so `workspace_gis_layer_references` is the same
  // shape. A table with no UPDATE policy cannot be edited in place by a future
  // route that forgot why, which is the point of leaving it out.
  //
  // The two PostGIS functions (`workspace_gis_append_features`,
  // `workspace_gis_features_in_bbox`) and the current-version trigger move none
  // of these counts — this inventory is about tables, views and policies — and
  // are audited by `workspace-gis-migration.test.ts` instead.
  //
  // So: +14 policies, +14 permissive, +0 restrictive, +10 permissiveWrites
  // (3+3+2+2), +4 tablesWithPolicies, +4 relations, +4 tables, +4
  // rlsEnabledTables. `views` holds at 7 and `expanded` at 264 — every policy
  // here is written literally inside a DO block, none through EXECUTE format().
  //
  // 20260812000019 (what the measure kept back in reserve) adds ONE table,
  // `measure_period_reserve`. THREE permissive policies and no restrictive
  // ones — the role-aware shape 20260812000011, 12 and 14 all take.
  //
  // Three rather than four, and the missing one is UPDATE for exactly the
  // reason it is missing next door: a period's reserve is replaced wholesale
  // together with its categories and its off-the-top takes, never edited in
  // place. Its GRANT names exactly SELECT, INSERT, DELETE to match.
  //
  // The migration also DROPs the four-argument
  // `replace_measure_period_allocation` and creates a five-argument one that
  // clears and rewrites the reserve rows in the same statement batch. Neither
  // moves a count here: this inventory is about tables, views and policies, and
  // the function's EXECUTE grants are audited by
  // `measure-reserve-migration.test.ts`.
  //
  // So: +3 policies, +3 permissive, +0 restrictive, +2 permissiveWrites
  // (INSERT + DELETE), +1 tablesWithPolicies, +1 relations, +1 tables, +1
  // rlsEnabledTables. `views` holds at 7 and `expanded` at 264.
  //
  // 20260817000002 (cron_job_heartbeats) adds ONE deployment-global heartbeat
  // table: RLS enabled with NO policies (locked to the service role), so it is
  // +1 relations, +1 tables, +1 rlsEnabledTables, and +0 to every policy count
  // and to tablesWithPolicies. It is a deliberate locked table (see the
  // write-policy coverage guard's allowlist). 20260817000001 only replaces the
  // kb_search_chunks function's return columns — a function, not a relation.
  policies: 668,
  permissive: 422,
  restrictive: 246,
  permissiveWrites: 272,
  expanded: 286,
  tablesWithPolicies: 150,
  relations: 172,
  tables: 165,
  views: 7,
  rlsEnabledTables: 165,
} as const;

/** The three tables whose policies exist ONLY as runtime-built SQL. */
const DYNAMIC_POLICY_TABLES = [
  "scenario_assumption_sets",
  "scenario_data_packages",
  "scenario_indicator_snapshots",
] as const;

const inventory = loadPolicyInventory();
const schema = loadSchemaInventory();

describe("migration policy inventory", () => {
  it("counts what the database actually has", () => {
    const all = inventory.all();

    expect(all).toHaveLength(EXPECTED.policies);
    expect(all.filter((p) => p.kind === "PERMISSIVE")).toHaveLength(EXPECTED.permissive);
    expect(all.filter((p) => p.kind === "RESTRICTIVE")).toHaveLength(EXPECTED.restrictive);
    expect(all.filter((p) => p.kind === "PERMISSIVE" && isWriteCommand(p))).toHaveLength(
      EXPECTED.permissiveWrites
    );
    expect(all.filter((p) => p.origin === "expanded")).toHaveLength(EXPECTED.expanded);
    expect(inventory.tables()).toHaveLength(EXPECTED.tablesWithPolicies);
  });

  it("sees the policies that are built at runtime, not only the ones spelled out", () => {
    // The whole point. `20260410000045_scenario_shared_spine.sql` writes
    // `CREATE POLICY %I ON %I` inside a FOREACH loop; a regex wanting a literal
    // identifier matches none of it. Nine of these twelve are role-blind
    // workspace WRITES, and the viewer-denial guard was green only because a
    // later migration happened to list these three tables by hand.
    for (const table of DYNAMIC_POLICY_TABLES) {
      for (const command of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
        expect(
          inventory.permissiveGrants(table, command).map((p) => p.policy),
          `${table} must expose its ${command} policy`
        ).toEqual([`${table}_${command.toLowerCase() === "select" ? "read" : command.toLowerCase()}`]);
      }
      expect(inventory.forTable(table).every((p) => p.origin === "expanded" || p.kind === "RESTRICTIVE")).toBe(true);
    }
  });

  it("expands each loop shape into the right number of statements", () => {
    const expand = (file: string) => expandDynamicPolicyStatements(file, blankComments(readMigration(file)));

    // Form A — FOREACH over a literal array: 3 tables x 4 commands.
    expect(expand("20260410000045_scenario_shared_spine.sql")).toHaveLength(12);

    // Form B — FOR r IN (VALUES …): each row emits a DROP and a CREATE for all
    // three write commands. 45 and 35 tables respectively.
    expect(expand("20260728000006_workspace_write_role_gate.sql")).toHaveLength(45 * 6);
    expect(expand("20260728000007_workspace_write_role_gate_children.sql")).toHaveLength(35 * 6);
  });

  it("renders the writer gate's hardest row without truncating it", () => {
    // `model_run_kpis` reaches its workspace through a coalesce of two
    // subqueries — parentheses AND commas inside a single-quoted VALUES cell. A
    // naive `\(([^)]*)\)` splitter cuts it in half, and the truncated expression
    // still parses into something that LOOKS scoped.
    const statements = expandDynamicPolicyStatements(
      "20260728000007_workspace_write_role_gate_children.sql",
      blankComments(readMigration("20260728000007_workspace_write_role_gate_children.sql"))
    );
    const update = statements.find((s) => s.sql.includes("model_run_kpis_writer_only_update") && s.sql.includes("CREATE"));

    expect(update?.sql).toContain("coalesce((SELECT p.workspace_id FROM public.model_runs p");
    expect(update?.sql).toContain("(SELECT p.workspace_id FROM public.county_runs p WHERE p.id = model_run_kpis.county_run_id))");
  });

  it("throws rather than shrinking when a migration builds SQL it cannot render", () => {
    const fixture = (body: string) => `DO $$\nDECLARE r record;\nBEGIN\n${body}\nEND\n$$;`;

    // A specifier this parser does not implement.
    expect(() =>
      expandDynamicPolicyStatements(
        "fixture.sql",
        fixture("EXECUTE format('CREATE POLICY %L ON t FOR SELECT USING (true)', 'x');")
      )
    ).toThrow(UnexpandableDynamicSqlError);

    // String concatenation instead of format() — a plausible way to write the
    // same thing, and one this parser cannot reduce.
    expect(() =>
      expandDynamicPolicyStatements(
        "fixture.sql",
        fixture("EXECUTE 'CREATE POLICY ' || quote_ident(v) || ' ON t FOR SELECT USING (true)';")
      )
    ).toThrow(UnexpandableDynamicSqlError);

    // A format() template that is not a literal string.
    expect(() =>
      expandDynamicPolicyStatements(
        "fixture.sql",
        fixture("EXECUTE format(build_sql('CREATE POLICY'), 'x');")
      )
    ).toThrow(UnexpandableDynamicSqlError);

    // An argument that does not reduce to a constant.
    expect(() =>
      expandDynamicPolicyStatements(
        "fixture.sql",
        fixture("EXECUTE format('CREATE POLICY %I ON t FOR SELECT USING (true)', some_function(x));")
      )
    ).toThrow(UnexpandableDynamicSqlError);

    // And the positive control: the same shape, resolvable, does not throw.
    expect(
      expandDynamicPolicyStatements(
        "fixture.sql",
        fixture(
          "FOREACH v IN ARRAY ARRAY['a','b'] LOOP\n" +
            "EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (true)', v || '_delete', v);\n" +
            "END LOOP;"
        )
      ).map((s) => s.sql)
    ).toEqual([
      "CREATE POLICY a_delete ON a FOR DELETE USING (true);",
      "CREATE POLICY b_delete ON b FOR DELETE USING (true);",
    ]);
  });

  it("treats a policy with no FOR clause as a write grant, because Postgres does", () => {
    const all = inventory.all();
    const forAll = all.filter((p) => p.command === "ALL" && p.kind === "PERMISSIVE");

    // Six live FOR ALL write grants. These are the policies an assertion that
    // counts the literal string "FOR DELETE" cannot see.
    expect(forAll.map((p) => p.table).sort()).toEqual([
      "aerial_evidence_packages",
      "aerial_missions",
      "aerial_project_posture",
      "land_use_plan_consultation_records",
      "land_use_plan_content_nodes",
      "land_use_plan_decisions",
      "land_use_plan_designation_policy_links",
      "land_use_plan_designations",
      "land_use_plan_implementation_actions",
      "land_use_plan_implementation_reports",
      "land_use_plan_relationships",
      "land_use_plan_review_events",
      "land_use_plan_versions",
      "land_use_plans",
      "modeling_claim_decisions",
      "modeling_source_manifests",
      "modeling_validation_results",
    ]);
    for (const policy of forAll) {
      expect(inventory.permissiveGrants(policy.table, "DELETE")).toContain(policy);
      expect(inventory.permissiveGrants(policy.table, "INSERT")).toContain(policy);
    }
  });

  it("separates permissive grants from restrictive gates", () => {
    // The distinction the parser this replaces did not have, and the reason
    // `runs` reported success over zero rows for every user: a RESTRICTIVE
    // policy only ever subtracts, so a table with a restrictive UPDATE gate and
    // no permissive UPDATE policy accepts no updates at all. 20260728000010
    // supplied the missing permissive halves; both layers must stay present.
    for (const table of ["runs", "project_rtp_cycle_links"]) {
      expect(inventory.restrictiveGates(table, "UPDATE").map((p) => p.policy)).toEqual([
        `${table}_writer_only_update`,
      ]);
      expect(inventory.permissiveGrants(table, "UPDATE").map((p) => p.policy)).toEqual([`${table}_update`]);
    }
    expect(inventory.permissiveGrants("runs", "SELECT").map((p) => p.policy)).toEqual(["runs_read"]);
  });

  it("replays drops so a rewritten policy is read as it stands today", () => {
    // billing_invoice_records was role-BLIND in 20260424000072 and rewritten
    // role-AWARE in 20260717000082. Reading every CREATE POLICY ever written
    // would register it as role-blind forever.
    const insert = inventory.permissiveGrants("billing_invoice_records", "INSERT");
    expect(insert).toHaveLength(1);
    expect(classifyRoleAwareness(insert[0]).kind).toBe("matched");
  });

  /**
   * Who a policy is addressed to — the half of an access decision that has to
   * agree with the GRANT. Every policy in the repo omits `TO`, which is
   * `TO PUBLIC`, so the interesting cases are the ones the corpus does not have
   * yet and the residue that refuses to guess.
   */
  it("reads a policy's audience, and refuses to guess at one it cannot parse", () => {
    const roles = (body: string) => parsePolicyRoles("fixture.sql", "p", body);

    expect(roles(" FOR SELECT USING (true)")).toEqual(["public"]);
    expect(roles(" AS RESTRICTIVE FOR UPDATE USING (true) WITH CHECK (true)")).toEqual(["public"]);
    expect(roles(" FOR SELECT TO anon USING (true)")).toEqual(["anon"]);
    expect(roles(' FOR ALL TO anon, "authenticated" USING (true)')).toEqual(["anon", "authenticated"]);
    // No USING at all is legal SQL (`FOR INSERT WITH CHECK`), and TO may sit last.
    expect(roles(" FOR INSERT TO authenticated WITH CHECK (true)")).toEqual(["authenticated"]);

    // A clause the head grammar does not contain must throw. Reporting
    // "addressed to PUBLIC" instead would silently satisfy every caller.
    expect(() => roles(" FOR SELECT AS SOMETHING_NEW USING (true)")).toThrow(/cannot read/i);
  });
});

describe("policy classifiers", () => {
  const statement = (body: string): PolicyStatement => ({
    file: "fixture.sql",
    order: [0, 0, 0, 0],
    origin: "literal",
    policy: "p",
    table: "t",
    command: "INSERT",
    kind: "PERMISSIVE",
    roles: ["public"],
    body,
  });

  it("never lets a policy exempt itself by being unreadable", () => {
    // The two silent-shrink holes, as one assertion. `isWorkspaceScoped` used
    // to be `body.includes("workspace_members")` and `isRoleBlind` a bare
    // /\brole\b/ — both answer "no" for anything they have not seen, and a "no"
    // here means the policy leaves the inventory without anyone being told.
    const writes = inventory.all().filter((p) => p.kind === "PERMISSIVE" && isWriteCommand(p));

    expect(
      writes.filter((p) => classifyWorkspaceScope(p).kind === "unclassifiable").map((p) => `${p.table}.${p.policy}`)
    ).toEqual([]);
    expect(
      writes.filter((p) => classifyRoleAwareness(p).kind === "unclassifiable").map((p) => `${p.table}.${p.policy}`)
    ).toEqual([]);
  });

  it("recognises each workspace-scoping idiom, and flags one it does not know", () => {
    expect(
      classifyWorkspaceScope(
        statement("FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))")
      )
    ).toEqual({ kind: "matched", idiom: "membership-in" });

    expect(
      classifyWorkspaceScope(
        statement("FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM scenario_sets s JOIN workspace_members wm ON wm.workspace_id = s.workspace_id))")
      ).kind
    ).toBe("matched");

    // The helper introduced by 20260728000006. Under the old literal test this
    // policy silently left the inventory; it is the latent hole this closes.
    expect(
      classifyWorkspaceScope(statement("FOR UPDATE USING (public.workspace_member_can_write(workspace_id))"))
    ).toEqual({ kind: "matched", idiom: "writer-helper" });

    // Not workspace-scoped at all — a legitimate "absent", not a failure.
    expect(classifyWorkspaceScope(statement("FOR INSERT WITH CHECK (user_id = auth.uid())"))).toEqual({
      kind: "absent",
    });

    // Looks like it, matches nothing. This is the case that must be LOUD.
    expect(
      classifyWorkspaceScope(statement("FOR UPDATE USING (workspace_id = my_new_helper())")).kind
    ).toBe("unclassifiable");
  });

  it("tells a role CHECK from the word 'role' appearing", () => {
    expect(classifyRoleAwareness(statement("USING (role IN ('owner', 'admin'))")).kind).toBe("matched");
    expect(classifyRoleAwareness(statement("USING (public.workspace_role_rank(wm.role) >= 1)")).kind).toBe("matched");
    expect(classifyRoleAwareness(statement("USING (public.workspace_member_can_write(workspace_id))")).kind).toBe("matched");

    // service_role is the commonest incidental appearance of the substring and
    // never denotes a role check.
    expect(classifyRoleAwareness(statement("USING (auth.jwt() ->> 'role' IS NULL AND service_role_only)")).kind).not.toBe(
      "absent"
    );
    expect(classifyRoleAwareness(statement("USING (current_setting('x') = 'service_role')")).kind).toBe("absent");
    expect(classifyRoleAwareness(statement("USING (workspace_id = any(x))")).kind).toBe("absent");
  });
});

describe("migration schema inventory", () => {
  it("reads every relation the migrations declare", () => {
    expect(schema.relations()).toHaveLength(EXPECTED.relations);
    expect(schema.tables()).toHaveLength(EXPECTED.tables);
    expect(schema.views()).toHaveLength(EXPECTED.views);
    expect(schema.tables().filter((t) => schema.rlsEnabled(t))).toHaveLength(EXPECTED.rlsEnabledTables);
  });

  it("knows the two tables that have no id column", () => {
    // The whole reason this inventory exists. `.select("id", { count })` over a
    // dynamic table asserted that all 33 project relations have an `id`.
    expect(schema.hasColumn("data_dataset_project_links", "id")).toBe(false);
    expect(schema.hasColumn("data_dataset_project_links", "project_id")).toBe(true);
    expect(schema.hasColumn("aerial_project_posture", "id")).toBe(false);
    expect(schema.hasColumn("aerial_project_posture", "project_id")).toBe(true);

    // And a third the same trap applies to, outside the project-delete list.
    expect(schema.hasColumn("workspace_members", "id")).toBe(false);
    expect(schema.hasColumn("workspace_members", "user_id")).toBe(true);
  });

  it("applies ALTER TABLE, in order", () => {
    expect(schema.hasColumn("data_datasets", "geography_scope")).toBe(true);
    expect(schema.hasColumn("data_datasets", "geometry_scope")).toBe(false);

    // Added by a later migration than the CREATE TABLE.
    expect(schema.hasColumn("projects", "place_geometry_geojson")).toBe(true);

    // Dropped by 20260722000006 and therefore gone.
    expect(schema.hasColumn("aerial_project_posture", "aerial_posture")).toBe(false);
  });

  it("distinguishes a table with no RLS from a table with no policy", () => {
    // THIS LIST WAS TEN TABLES UNTIL 2026-08-03, AND THE COMMENT ABOVE IT SAID
    // "a write to a reference table with RLS off is fine". That was wrong twice
    // over, and both halves are worth recording because the sentence is what
    // made the list look benign:
    //
    //   * Eight of the ten were not reference tables at all. `agencies`,
    //     `routes`, `stops`, `trips`, `stop_times`, `shapes`, `calendar` and
    //     `calendar_dates` are TENANT data — GTFS children whose visibility is
    //     inherited from `gtfs_feeds.workspace_id`. Each carried a correct
    //     workspace-scoped policy that had never been enforced, so an anonymous
    //     caller could read any workspace's entire transit network.
    //   * And the write WAS NOT fine. With RLS off and default grants live, an
    //     anonymous caller rewrote a real `census_tracts` row's
    //     `median_household_income` from 67970 to 1 — shared reference data
    //     feeding the equity choropleth for every workspace at once.
    //
    // 20260730000010 and 20260730000011 enable RLS on all ten; 20260730000009
    // revokes the write grants. The list is now empty and must stay empty:
    // `src/test/policies-are-enforced-guard.test.ts` asserts the same invariant
    // against a LIVE catalog, which is what would have caught this originally.
    expect(schema.tables().filter((t) => !schema.rlsEnabled(t))).toEqual([]);

    // Positive and negative controls, so an empty list above cannot be an
    // artifact of `rlsEnabled` always answering true. It is a set membership
    // test, so a view — which cannot have RLS — must answer false.
    expect(schema.rlsEnabled("projects")).toBe(true);
    expect(schema.rlsEnabled("census_tracts_map")).toBe(false);
    expect(schema.rlsEnabled("no_such_table_exists")).toBe(false);
  });

  it("reports a view's columns as unknown rather than as a short list", () => {
    // Deliberate: four of the five need a real SELECT-list parser (CTEs,
    // SELECT *, DISTINCT ON, expression aliases), and a half-working one would
    // report a SMALLER column set — the exact failure this tree exists to
    // avoid. Callers must handle undefined; the nightly live drift test checks
    // views against information_schema.
    expect(schema.views()).toEqual([
      "census_tracts_computed",
      "census_tracts_map",
      "gtfs_stops_map",
      "lodes_by_tract",
      "project_bca_screenings_latest",
      "scenario_comparison_summary",
      "vmt_significance_screenings_latest",
    ]);
    expect(schema.isView("census_tracts_map")).toBe(true);
    expect(schema.columns("census_tracts_map")).toBeUndefined();
    expect(schema.columns("projects")).toBeDefined();
  });

  it("tracks foreign keys, so the project-delete inventory can be checked", () => {
    const children = schema.childrenOf("projects");

    expect(children.length).toBeGreaterThanOrEqual(30);
    expect(children).toContain("data_dataset_project_links");
    expect(children).toContain("aerial_project_posture");
    expect(children).not.toContain("workspaces");
  });
});

describe("migration lexing", () => {
  it("blanks comments without moving a single byte", () => {
    const sql = "SELECT 1; -- the agency's own\nSELECT 2;";
    const blanked = blankComments(sql);

    expect(blanked).toHaveLength(sql.length);
    expect(blanked).not.toContain("agency");
    expect(blanked.indexOf("SELECT 2;")).toBe(sql.indexOf("SELECT 2;"));
  });

  it("does not mistake a -- inside a string for a comment", () => {
    // Real shape: a format() template containing SQL. Blanking it would delete
    // the rest of the template and, with it, the policy.
    const sql = "EXECUTE format('CREATE POLICY x ON t FOR SELECT USING (a -- b\n)');\nSELECT 1;";
    expect(blankComments(sql)).toContain("CREATE POLICY x ON t");
  });

  it("splits on separators that are not inside strings or parens", () => {
    expect(splitTopLevel("a, b, c", ",").map((s) => s.trim())).toEqual(["a", "b", "c"]);
    expect(splitTopLevel("'x, y', z", ",").map((s) => s.trim())).toEqual(["'x, y'", "z"]);
    expect(splitTopLevel("f(a, b), c", ",").map((s) => s.trim())).toEqual(["f(a, b)", "c"]);
  });

  it("unquotes a literal, and refuses text that is not one", () => {
    expect(unquoteLiteral("'plain'")).toBe("plain");
    expect(unquoteLiteral("  'it''s'  ")).toBe("it's");
    expect(unquoteLiteral("'a', 'b'")).toBeNull();
    expect(unquoteLiteral("identifier")).toBeNull();
  });

  it("finds the string literals the policy scanner must not read", () => {
    const sql = "EXECUTE format('CREATE POLICY p ON t FOR SELECT USING (true)');";
    const ranges = stringLiteralRanges(sql);

    expect(ranges).toHaveLength(1);
    expect(sql.slice(ranges[0][0], ranges[0][1])).toBe("'CREATE POLICY p ON t FOR SELECT USING (true)'");
  });

  it("reads every migration without throwing", () => {
    // The expander's contract is that an unrecognised shape is an ERROR, not a
    // smaller inventory. That makes this assertion the tripwire for the next
    // migration that builds policies a new way.
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(140);

    for (const file of files) {
      expect(() => expandDynamicPolicyStatements(file, blankComments(readMigration(file)))).not.toThrow();
    }
  });
});

/**
 * THE GRANT POSTURE — a deliberate REVOKE may only be undone on purpose.
 *
 * On 2026-08-04 `20260804000002` looped every table in `public` and re-granted
 * the four client DML privileges, then re-asserted the deliberate revocations
 * from two of the roughly twenty-six migrations that had written them. The rest
 * were widened with nothing failing: the suite was green, and RLS still denied
 * the writes, so no behavioural probe could see that a second, independent lock
 * had been removed from twenty-odd tables — including the column-scoped UPDATE
 * gate that keeps a workspace member from writing a narrative draft's own
 * grounding record.
 *
 * The invariant below is deliberately not a shape rule and not a list of names:
 *
 *     any (table, role, privilege) that a migration REVOKED may be held at HEAD
 *     only if a later statement granted it BY NAME.
 *
 * A blanket grant — `ALL TABLES IN SCHEMA`, or a loop over `pg_tables` — says
 * nothing about any particular table, so it can never re-establish a deliberate
 * denial. That leaves blanket grants legal, which matters: the next platform
 * change to default privileges will need one. It just makes them compose. When
 * this fails it prints the exact REVOKE block that would fix it, so the author
 * of the next blanket grant never has to type a table name twice.
 */
describe("client grants compose back to the audited posture", () => {
  const inventory = loadGrantInventory();

  it("holds no privilege a migration revoked, except where a by-name grant restored it", () => {
    const violations = inventory.violations();

    expect(
      violations.length === 0
        ? ""
        : `${violations.length} privilege(s) revoked by a migration are held at HEAD, and only a ` +
          `blanket grant put them back. Add these to the newest migration:\n\n` +
          `${describeViolations(violations)}\n`
    ).toBe("");
  });

  it("sees a world big enough to be worth asserting on", () => {
    // Floors, not equalities: this set grows whenever a table is locked down, and
    // a guard that had to be edited for every such migration would be edited
    // carelessly. What must never happen is the inventory silently SHRINKING —
    // the failure mode that hid the unarmed GTFS policies for four months.
    expect(inventory.revokedTables().length).toBeGreaterThanOrEqual(25);
    expect(inventory.denials().length).toBeGreaterThanOrEqual(150);

    // The four service-role-only ledgers from 20260730000008 are the ones
    // 20260804000002 DID re-assert, so they prove the parser reads a correct
    // revoke as satisfied rather than reading every revoke as a violation.
    const ledgers = ["assistant_action_approvals", "engagement_item_votes", "aerial_processing_callbacks"];
    for (const table of ledgers) {
      const denied = inventory.denials().filter((denial) => denial.table === table);
      expect(denied.length).toBeGreaterThan(0);
      expect(denied.every((denial) => !denial.violation)).toBe(true);
    }
  });

  /**
   * GUARD THE GUARD. Every assertion above is only as good as the parser, and a
   * parser that reads a statement wrong reports a SMALLER denial set — which
   * looks exactly like compliance. That is not hypothetical here: the first
   * version of this module dropped `authenticated` from every dynamically
   * rendered statement, because the expander terminates its output with `;` and
   * `TO anon, authenticated;` parsed its last role as `authenticated;`. Half the
   * denial set vanished and every test on this page was green.
   */
  it("reads the statement shapes the migration corpus actually contains", () => {
    const parse = parseGrantStatement;

    // ALL expands, PUBLIC is a role, and TABLE is optional.
    const revokeAll = parse("REVOKE ALL ON TABLE public.widgets FROM PUBLIC, anon, authenticated");
    expect(revokeAll?.kind).toBe("revoke");
    expect(revokeAll?.roles).toEqual(["public", "anon", "authenticated"]);
    expect(revokeAll?.privileges.map((p) => p.privilege)).toContain("TRUNCATE");

    // The terminator the expander adds must not eat the last role.
    expect(parse("GRANT SELECT ON public.widgets TO anon, authenticated;")?.roles).toEqual([
      "anon",
      "authenticated",
    ]);

    // Column-scoped grants keep their columns — this is the narrative-draft control.
    const columns = parse("GRANT UPDATE (status, accepted_by) ON public.widgets TO authenticated");
    expect(columns?.privileges).toEqual([{ privilege: "UPDATE", columns: ["status", "accepted_by"] }]);

    // A blanket grant reaches every table and names none.
    expect(parse("GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon")?.reach).toBe("blanket");
    expect(parse("GRANT SELECT ON public.a, public.b TO anon")?.tables).toEqual(["a", "b"]);
    expect(parse("GRANT SELECT ON TABLE widgets TO anon")?.tables).toEqual(["widgets"]);

    // Not table privileges, and not client roles: silently skipped is correct here.
    expect(parse("REVOKE ALL ON FUNCTION public.f(uuid) FROM anon")).toBeNull();
    expect(parse("GRANT USAGE, SELECT ON SEQUENCE public.s TO anon")).toBeNull();
    expect(parse("GRANT ALL ON TABLE public.widgets TO service_role")).toBeNull();
    expect(parse("CREATE TABLE public.widgets (id uuid)")).toBeNull();

    // But a table grant it cannot READ must throw rather than shrink the world.
    expect(() => parse("GRANT SELEKT ON public.widgets TO anon")).toThrow(/unknown table privilege/i);
  });

  it("distinguishes a blanket re-grant from a deliberate one (synthetic controls)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openplan-grant-inventory-"));
    const write = (name: string, sql: string) => writeFileSync(path.join(dir, name), sql, "utf8");

    // A schema for the parser's Form C expansion to bind against.
    write("0001_create.sql", "CREATE TABLE public.widgets (id uuid primary key);\nCREATE TABLE public.gadgets (id uuid primary key);\n");
    write("0002_revoke.sql", "REVOKE ALL ON TABLE public.widgets FROM anon, authenticated;\nREVOKE ALL ON TABLE public.gadgets FROM anon;\n");

    // NEGATIVE CONTROL: nothing grants it back, so nothing is held and nothing violates.
    const quiet = loadGrantInventory({ dir });
    expect(quiet.denials().length).toBeGreaterThan(0);
    expect(quiet.violations()).toEqual([]);

    // POSITIVE CONTROL: the blanket loop from 20260804000002, rendered over this
    // synthetic schema. Both tables come back, and neither by name.
    write(
      "0003_blanket.sql",
      "DO $$\nDECLARE t record;\nBEGIN\n  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP\n" +
        "    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO anon, authenticated', t.tablename);\n" +
        "  END LOOP;\nEND $$;\n"
    );
    const widened = loadGrantInventory({ dir });
    expect(widened.violations().map((v) => `${v.table}/${v.role}/${v.privilege}`).sort()).toEqual([
      "gadgets/anon/INSERT",
      "gadgets/anon/SELECT",
      "widgets/anon/INSERT",
      "widgets/anon/SELECT",
      "widgets/authenticated/INSERT",
      "widgets/authenticated/SELECT",
    ]);

    // A BY-NAME grant after the revoke is legitimate and must NOT be reported,
    // even though the blanket grant above also touched it. This is the
    // distinction the whole invariant rests on.
    write("0004_named.sql", "GRANT SELECT ON TABLE public.widgets TO authenticated;\n");
    const named = loadGrantInventory({ dir });
    expect(named.violations().map((v) => `${v.table}/${v.role}/${v.privilege}`)).not.toContain(
      "widgets/authenticated/SELECT"
    );
    expect(named.violations().map((v) => `${v.table}/${v.role}/${v.privilege}`)).toContain(
      "widgets/authenticated/INSERT"
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("requires every public view to run as its invoker", () => {
    // A view without `security_invoker` executes as its OWNER, so a client
    // reading it bypasses RLS on the base tables. `census_tracts_map` selects
    // from a table whose writes are revoked; without this the view would be a
    // way around that. Zero exceptions today, so it can be an absolute rule.
    //
    // This REPLAYS rather than reading one statement, and the difference is not
    // academic: `census_tracts_computed` and `lodes_by_tract` are created bare in
    // 20260219000003 and only made invoker-run by an ALTER in 20260420000063. A
    // version of this test that read CREATE alone reported both as defects — the
    // same "assert on a copy of the artifact" mistake in miniature, caught here
    // only because the live catalog disagreed with it.
    const invoker = new Map<string, { value: boolean; file: string }>();

    // STATEMENTS ARE APPLIED IN SOURCE ORDER, and that is not a detail.
    //
    // This loop used to run all the CREATEs in a file, then all the ALTERs,
    // then all the DROPs. A migration that drops a view and recreates it in the
    // same file — the only way to change a `SELECT *` view's column list, since
    // CREATE OR REPLACE can only append — therefore had its recreation ERASED
    // by its own DROP, and the view disappeared from the inventory. Found
    // 2026-08-07 by 20260805000010, which does exactly that to
    // `census_tracts_computed` and `census_tracts_map`. Replaying a corpus out
    // of order answers a question about a database that never existed.
    type Statement = { at: number; apply: () => void };

    for (const file of migrationFiles()) {
      const sql = blankComments(readMigration(file));
      const statements: Statement[] = [];

      for (const match of sql.matchAll(
        /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?([A-Za-z0-9_]+)"?([\s\S]*?)\bAS\b/gi
      )) {
        const name = match[1].toLowerCase();
        const options = match[2];
        statements.push({
          at: match.index ?? 0,
          apply: () =>
            invoker.set(name, {
              value: /security_invoker\s*=\s*(?:true|on)/i.test(options),
              file,
            }),
        });
      }

      for (const match of sql.matchAll(
        /ALTER\s+VIEW\s+(?:public\.)?"?([A-Za-z0-9_]+)"?\s+(SET|RESET)\s*\(([^)]*)\)/gi
      )) {
        const name = match[1].toLowerCase();
        const verb = match[2].toUpperCase();
        const options = match[3];
        if (!/security_invoker/i.test(options)) continue;
        statements.push({
          at: match.index ?? 0,
          apply: () =>
            invoker.set(name, {
              value: verb === "SET" && /security_invoker\s*=\s*(?:true|on)/i.test(options),
              file,
            }),
        });
      }

      for (const match of sql.matchAll(/DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?/gi)) {
        const name = match[1].toLowerCase();
        statements.push({ at: match.index ?? 0, apply: () => invoker.delete(name) });
      }

      for (const statement of statements.sort((a, b) => a.at - b.at)) statement.apply();
    }

    expect(invoker.size).toBeGreaterThanOrEqual(6);
    expect(
      [...invoker.entries()]
        .filter(([, state]) => !state.value)
        .map(([name, state]) => `${name} (last set in ${state.file})`)
    ).toEqual([]);
  });
});
