import { describe, expect, it } from "vitest";
import { blankComments, migrationFiles, readMigration, splitTopLevel, unquoteLiteral } from "./read-migrations";
import { UnexpandableDynamicSqlError, expandDynamicPolicyStatements, stringLiteralRanges } from "./plpgsql-expansion";
import {
  classifyRoleAwareness,
  classifyWorkspaceScope,
  isWriteCommand,
  loadPolicyInventory,
  type PolicyStatement,
} from "./policy-inventory";
import { loadSchemaInventory } from "./schema-inventory";

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
  policies: 564,
  permissive: 324,
  restrictive: 240,
  permissiveWrites: 213,
  expanded: 264,
  tablesWithPolicies: 111,
  relations: 130,
  tables: 124,
  views: 6,
  rlsEnabledTables: 124,
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
