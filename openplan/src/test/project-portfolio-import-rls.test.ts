import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

type Fixture = {
  workspaceA: string;
  workspaceB: string;
  ownerA: string;
  viewerA: string;
  outsiderB: string;
  sourceA: string;
  sourceHashA: string;
};

function client(url: string, key: string, name: string) {
  return liveClient(url, key, name);
}

function reviewedRow(input: {
  fingerprint?: string;
  name?: string;
  decision?: "create" | "skip";
  state?: "clean" | "created_before";
  canCreate?: boolean;
  location?: string;
  cost?: boolean;
}) {
  return {
    rowNumber: 2,
    fingerprint: input.fingerprint ?? "c".repeat(64),
    name: input.name ?? "RLS imported project",
    sourceId: "SRC-1",
    description: "RLS reviewed description",
    sourceLocationText: input.location ?? "Unverified source location",
    estimatedCost:
      input.cost === false
        ? null
        : { amount: "12500000", currency: "USD", priceYear: 2025 },
    planType: "capital_program",
    status: "draft",
    deliveryPhase: "programming",
    decision: input.decision ?? "create",
    state: input.state ?? "clean",
    canCreate: input.canCreate ?? true,
    errors: [],
    warnings: [],
  };
}

function rpcArgs(fixture: Fixture, sourceId: string, sourceHash: string, rows: unknown[]) {
  return {
    p_workspace_id: fixture.workspaceA,
    p_actor_id: fixture.ownerA,
    p_source_document_id: sourceId,
    p_original_workbook_document_id: null,
    p_source_hash: sourceHash,
    p_preview_hash: "b".repeat(64),
    p_mapping: { name: 1, sourceId: 0 },
    p_defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming" },
    p_rows: rows,
  };
}

function workbookRow(input: {
  worksheetIndex: number;
  rowNumber?: number;
  fingerprint: string;
  name: string;
  sourceId: string;
  formula?: boolean;
}) {
  return {
    worksheetIndex: input.worksheetIndex,
    worksheetName: `Sheet ${input.worksheetIndex + 1}`,
    headerRow: 1,
    rowNumber: input.rowNumber ?? 2,
    fingerprint: input.fingerprint,
    name: input.name,
    sourceId: input.sourceId,
    description: "Reviewed workbook row",
    sourceLocationText: "Unverified workbook location",
    estimatedCost: { amount: "250", currency: "USD", priceYear: 2026 },
    planType: "capital_program",
    status: "draft",
    deliveryPhase: "programming",
    decision: "create",
    state: input.formula ? "warning" : "clean",
    canCreate: true,
    confirmNameMatch: false,
    confirmFormula: Boolean(input.formula),
    formulaFields: input.formula ? ["estimatedCost"] : [],
    errors: [],
    warnings: input.formula ? [{ code: "formula_value" }] : [],
  };
}

function workbookRpcArgs(fixture: Fixture, sourceId: string, sourceHash: string, rows: unknown[]) {
  return {
    p_workspace_id: fixture.workspaceA,
    p_actor_id: fixture.ownerA,
    p_source_document_id: sourceId,
    p_original_workbook_document_id: null,
    p_source_hash: sourceHash,
    p_source_format: "csv",
    p_preview_hash: "7".repeat(64),
    p_sheet_configurations: [
      { worksheetIndex: 0, worksheetName: "Sheet 1", headerRow: 1, mapping: { sourceId: 0, name: 1 }, defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming" } },
      { worksheetIndex: 1, worksheetName: "Sheet 2", headerRow: 1, mapping: { sourceId: 0, name: 1 }, defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming" } },
    ],
    p_rows: rows,
  };
}

async function insertCsvSource(
  service: SupabaseClient,
  workspaceId: string,
  hash: string,
  projectId: string | null = null
) {
  const id = randomUUID();
  const result = await service.from("kb_documents").insert({
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    title: `Portfolio CSV ${hash.slice(0, 6)}`,
    source_kind: "uploaded_spreadsheet",
    original_filename: "portfolio.csv",
    content_type: "text/csv",
    byte_size: 50,
    storage_ref: `storage://kb-documents/${workspaceId}/${id}/portfolio.csv`,
    checksum: hash,
    status: "ready",
    extraction_source: "spreadsheet_parse",
  });
  if (result.error) throw new Error(`Could not seed CSV source: ${result.error.message}`);
  return id;
}

liveDescribe("reviewed portfolio import live authorization and transaction", () => {
  let env: ReturnType<typeof getLocalSupabaseEnv>;
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let viewer: SupabaseClient;
  let outsider: SupabaseClient;
  let fixture: Fixture;
  const password = "PortfolioRls!2026";

  beforeAll(async () => {
    env = getLocalSupabaseEnv();
    service = client(env.API_URL, env.SERVICE_ROLE_KEY, "portfolio-import-service");
    owner = client(env.API_URL, env.ANON_KEY, "portfolio-import-owner");
    viewer = client(env.API_URL, env.ANON_KEY, "portfolio-import-viewer");
    outsider = client(env.API_URL, env.ANON_KEY, "portfolio-import-outsider");

    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const users = await Promise.all(
      ["owner", "viewer", "outsider"].map((role) =>
        service.auth.admin.createUser({
          email: `portfolio-${role}-${suffix}@example.test`,
          password,
          email_confirm: true,
        })
      )
    );
    for (const created of users) {
      if (created.error || !created.data.user) {
        throw new Error(`Could not create portfolio RLS user: ${created.error?.message ?? "missing"}`);
      }
    }

    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const ownerA = users[0].data.user!.id;
    const viewerA = users[1].data.user!.id;
    const outsiderB = users[2].data.user!.id;
    fixture = {
      workspaceA,
      workspaceB,
      ownerA,
      viewerA,
      outsiderB,
      sourceA: "",
      sourceHashA: "a".repeat(64),
    };

    for (const row of [
      { id: workspaceA, name: `Portfolio A ${suffix}`, slug: `portfolio-a-${suffix}` },
      { id: workspaceB, name: `Portfolio B ${suffix}`, slug: `portfolio-b-${suffix}` },
    ]) {
      const result = await service.from("workspaces").insert(row);
      if (result.error) throw new Error(`Could not seed workspace: ${result.error.message}`);
    }
    for (const row of [
      { workspace_id: workspaceA, user_id: ownerA, role: "owner" },
      { workspace_id: workspaceA, user_id: viewerA, role: "viewer" },
      { workspace_id: workspaceB, user_id: outsiderB, role: "owner" },
    ]) {
      const result = await service.from("workspace_members").insert(row);
      if (result.error) throw new Error(`Could not seed membership: ${result.error.message}`);
    }

    await owner.auth.signInWithPassword({ email: `portfolio-owner-${suffix}@example.test`, password });
    await viewer.auth.signInWithPassword({ email: `portfolio-viewer-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `portfolio-outsider-${suffix}@example.test`, password });
    fixture.sourceA = await insertCsvSource(service, workspaceA, fixture.sourceHashA);
  }, 60_000);

  afterAll(async () => {
    await owner?.auth.signOut();
    await viewer?.auth.signOut();
    await outsider?.auth.signOut();
    if (service && fixture) {
      const removed = await service
        .from("workspaces")
        .delete()
        .in("id", [fixture.workspaceA, fixture.workspaceB]);
      if (removed.error) throw new Error(`Portfolio RLS workspace cleanup failed: ${removed.error.message}`);
      for (const userId of [fixture.ownerA, fixture.viewerA, fixture.outsiderB]) {
        const memberships = await service
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", userId);
        for (const row of (memberships.data ?? []) as Array<{ workspace_id: string }>) {
          const workspace = await service.from("workspaces").delete().eq("id", row.workspace_id);
          if (workspace.error) {
            throw new Error(`Portfolio RLS personal workspace cleanup failed: ${workspace.error.message}`);
          }
        }
        const result = await service.auth.admin.deleteUser(userId);
        if (result.error) {
          throw new Error(`Portfolio RLS user cleanup failed: ${JSON.stringify(result.error)}`);
        }
      }
    }
  }, 60_000);

  it("restricts direct writes and function execution to the service role", async () => {
    const direct = await owner.from("project_portfolio_import_batches").insert({
      workspace_id: fixture.workspaceA,
      source_document_id: fixture.sourceA,
      source_sha256: fixture.sourceHashA,
      preview_sha256: "b".repeat(64),
      mapping_json: {},
      defaults_json: {},
      row_count: 1,
      created_count: 0,
      skipped_count: 1,
      conflicted_count: 0,
      invalid_count: 0,
      previously_created_count: 0,
      imported_by: fixture.ownerA,
    });
    expect(direct.error?.message ?? "").toMatch(/permission denied|row-level security/i);

    const called = await owner.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [reviewedRow({})])
    );
    expect(called.error?.message ?? "").toMatch(/permission denied|function/i);
    expect(called.data).toBeNull();

    const calledV2 = await owner.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [
        workbookRow({ worksheetIndex: 0, fingerprint: "8".repeat(64), name: "Denied", sourceId: "DENIED" }),
      ])
    );
    expect(calledV2.error?.message ?? "").toMatch(/permission denied|function/i);
    expect(calledV2.data).toBeNull();
  });

  it("rechecks viewer, cross-workspace actor, and project-scoped source refusals", async () => {
    const viewerCall = await service.rpc("commit_project_portfolio_import", {
      ...rpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [reviewedRow({})]),
      p_actor_id: fixture.viewerA,
    });
    expect(viewerCall.error?.code).toBe("42501");

    const viewerCallV2 = await service.rpc("commit_project_portfolio_import_v2", {
      ...workbookRpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [
        workbookRow({ worksheetIndex: 0, fingerprint: "1".repeat(64), name: "Viewer denied", sourceId: "VIEWER" }),
      ]),
      p_actor_id: fixture.viewerA,
    });
    expect(viewerCallV2.error?.code).toBe("42501");

    const outsiderCall = await service.rpc("commit_project_portfolio_import", {
      ...rpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [reviewedRow({})]),
      p_actor_id: fixture.outsiderB,
    });
    expect(outsiderCall.error?.code).toBe("42501");

    const outsiderCallV2 = await service.rpc("commit_project_portfolio_import_v2", {
      ...workbookRpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [
        workbookRow({ worksheetIndex: 0, fingerprint: "2".repeat(64), name: "Outsider denied", sourceId: "OUTSIDER" }),
      ]),
      p_actor_id: fixture.outsiderB,
    });
    expect(outsiderCallV2.error?.code).toBe("42501");

    const parent = await service
      .from("projects")
      .insert({ workspace_id: fixture.workspaceA, name: "Source parent", created_by: fixture.ownerA })
      .select("id")
      .single();
    expect(parent.error).toBeNull();
    const projectSource = await insertCsvSource(
      service,
      fixture.workspaceA,
      "d".repeat(64),
      parent.data!.id
    );
    const scopedCall = await service.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, projectSource, "d".repeat(64), [reviewedRow({ fingerprint: "e".repeat(64) })])
    );
    expect(scopedCall.error?.code).toBe("22023");

    const scopedCallV2 = await service.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, projectSource, "d".repeat(64), [
        workbookRow({ worksheetIndex: 0, fingerprint: "f".repeat(64), name: "Scoped denied", sourceId: "SCOPED" }),
      ])
    );
    expect(scopedCallV2.error?.code).toBe("22023");
  });

  it("creates exact cost provenance atomically and leaves location as import provenance", async () => {
    const committed = await service.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [reviewedRow({})])
    );
    expect(committed.error).toBeNull();
    expect(committed.data).toMatchObject({ created: 1, skipped: 0 });

    const projectId = (committed.data as { projectIds: string[] }).projectIds[0];
    const project = await service
      .from("projects")
      .select(
        "id, estimated_cost_amount, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_by"
      )
      .eq("id", projectId)
      .single();
    expect(project.error).toBeNull();
    expect(Number(project.data?.estimated_cost_amount)).toBe(12_500_000);
    expect(project.data).toMatchObject({
      estimated_cost_currency: "USD",
      estimated_cost_basis_year: 2025,
      estimated_cost_source_document_id: fixture.sourceA,
      estimated_cost_recorded_by: fixture.ownerA,
    });

    const row = await owner
      .from("project_portfolio_import_rows")
      .select("source_location_text, created_project_id, outcome")
      .eq("created_project_id", projectId)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      source_location_text: "Unverified source location",
      created_project_id: projectId,
      outcome: "created",
    });

    const foreignRead = await outsider
      .from("project_portfolio_import_rows")
      .select("id")
      .eq("workspace_id", fixture.workspaceA);
    expect(foreignRead.error).toBeNull();
    expect(foreignRead.data).toEqual([]);
  });

  it("locks an exact rerun to skip while allowing a previously skipped row to be reconsidered", async () => {
    const rerun = await service.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, fixture.sourceA, fixture.sourceHashA, [
        reviewedRow({ decision: "skip", state: "created_before", canCreate: false }),
      ])
    );
    expect(rerun.error).toBeNull();
    expect(rerun.data).toMatchObject({ created: 0, previouslyCreated: 1 });

    const skippedHash = "f".repeat(64);
    const skippedSource = await insertCsvSource(service, fixture.workspaceA, skippedHash);
    const first = await service.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, skippedSource, skippedHash, [
        reviewedRow({ fingerprint: "1".repeat(64), decision: "skip", canCreate: true, cost: false }),
      ])
    );
    expect(first.error).toBeNull();
    const reconsidered = await service.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, skippedSource, skippedHash, [
        reviewedRow({ fingerprint: "1".repeat(64), name: "Reconsidered row", cost: false }),
      ])
    );
    expect(reconsidered.error).toBeNull();
    expect(reconsidered.data).toMatchObject({ created: 1 });
  });

  it.each([1, 2])("retains an unknown price year through the v%s transaction without losing cost provenance", async (version) => {
    const sourceHash = randomUUID().replaceAll("-", "").repeat(2);
    const source = await insertCsvSource(service, fixture.workspaceA, sourceHash);
    const baseRow = version === 1
      ? reviewedRow({ name: `Unknown year v${version}` })
      : workbookRow({ worksheetIndex: 0, fingerprint: "b".repeat(64), name: `Unknown year v${version}`, sourceId: "UNKNOWN-YEAR" });
    const row = {
      ...baseRow,
      estimatedCost: { amount: "4200000", currency: "USD", priceYear: null },
      state: "warning", warnings: [{ code: "unknown_price_year", message: "Price year is unknown." }],
    };
    const committed = await service.rpc(
      version === 1 ? "commit_project_portfolio_import" : "commit_project_portfolio_import_v2",
      version === 1 ? rpcArgs(fixture, source, sourceHash, [row]) : workbookRpcArgs(fixture, source, sourceHash, [row])
    );
    expect(committed.error).toBeNull();
    expect(committed.data).toMatchObject({ created: 1 });
    const projectId = (committed.data as { projectIds: string[] }).projectIds[0];
    const project = await owner.from("projects")
      .select("estimated_cost_amount,estimated_cost_currency,estimated_cost_basis_year,estimated_cost_source_document_id")
      .eq("id", projectId).single();
    expect(project.error).toBeNull();
    expect(Number(project.data?.estimated_cost_amount)).toBe(4_200_000);
    expect(project.data).toMatchObject({ estimated_cost_currency: "USD", estimated_cost_basis_year: null, estimated_cost_source_document_id: source });
  });

  it("rolls back the whole batch on malformed row data and on a concurrent identity race", async () => {
    const rollbackHash = "2".repeat(64);
    const rollbackSource = await insertCsvSource(service, fixture.workspaceA, rollbackHash);
    const beforeProjects = await service
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", fixture.workspaceA);
    const beforeBatches = await service
      .from("project_portfolio_import_batches")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", fixture.workspaceA);
    const malformed = {
      ...reviewedRow({ fingerprint: "3".repeat(64), name: "Malformed second" }),
      rowNumber: 3,
      planType: "",
    };
    const failed = await service.rpc(
      "commit_project_portfolio_import",
      rpcArgs(fixture, rollbackSource, rollbackHash, [
        reviewedRow({ fingerprint: "4".repeat(64), name: "Would roll back" }),
        malformed,
      ])
    );
    expect(failed.error?.code).toBe("22023");
    const afterProjects = await service
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", fixture.workspaceA);
    const afterBatches = await service
      .from("project_portfolio_import_batches")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", fixture.workspaceA);
    expect(afterProjects.count).toBe(beforeProjects.count);
    expect(afterBatches.count).toBe(beforeBatches.count);

    const raceHash = "5".repeat(64);
    const raceSource = await insertCsvSource(service, fixture.workspaceA, raceHash);
    const raceArgs = rpcArgs(fixture, raceSource, raceHash, [
      reviewedRow({ fingerprint: "6".repeat(64), name: "Race winner", cost: false }),
    ]);
    const race = await Promise.all([
      service.rpc("commit_project_portfolio_import", raceArgs),
      service.rpc("commit_project_portfolio_import", raceArgs),
    ]);
    expect(race.filter((result) => result.error === null), JSON.stringify(race)).toHaveLength(1);
    expect(race.filter((result) => result.error?.code === "23505"), JSON.stringify(race)).toHaveLength(1);

    const raceProjects = await service
      .from("project_portfolio_import_rows")
      .select("created_project_id")
      .eq("source_sha256", raceHash)
      .eq("outcome", "created");
    expect(raceProjects.error).toBeNull();
    expect(raceProjects.data).toHaveLength(1);
  });

  it("keeps provenance immutable and names the source dependency at the database boundary", async () => {
    const batch = await service
      .from("project_portfolio_import_batches")
      .select("id")
      .eq("source_document_id", fixture.sourceA)
      .limit(1)
      .single();
    expect(batch.error).toBeNull();

    const rewrite = await service
      .from("project_portfolio_import_batches")
      .update({ preview_sha256: "9".repeat(64) })
      .eq("id", batch.data!.id);
    expect(rewrite.error?.message ?? "").toContain("immutable");
    const removeRow = await service
      .from("project_portfolio_import_rows")
      .delete()
      .eq("batch_id", batch.data!.id);
    expect(removeRow.error?.message ?? "").toContain("immutable");
    const removeSource = await service.from("kb_documents").delete().eq("id", fixture.sourceA);
    expect(removeSource.error?.code).toBe("23503");
  });

  it("atomically commits v2 sheet identity, rechecks formulas and cross-sheet IDs, and races per sheet row", async () => {
    const sourceHash = "7".repeat(64);
    const source = await insertCsvSource(service, fixture.workspaceA, sourceHash);
    const twoSheets = [
      workbookRow({ worksheetIndex: 0, fingerprint: "8".repeat(64), name: "Workbook north", sourceId: "WB-N", formula: true }),
      workbookRow({ worksheetIndex: 1, fingerprint: "9".repeat(64), name: "Workbook south", sourceId: "WB-S" }),
    ];
    const committed = await service.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, source, sourceHash, twoSheets)
    );
    expect(committed.error).toBeNull();
    expect(committed.data).toMatchObject({ created: 2 });

    const provenance = await owner
      .from("project_portfolio_import_rows")
      .select("source_format,worksheet_index,worksheet_name,header_row,source_row_number,formula_warning_fields,source_location_text,created_project_id")
      .eq("source_sha256", sourceHash)
      .order("worksheet_index");
    expect(provenance.error).toBeNull();
    expect(provenance.data).toMatchObject([
      { source_format: "csv", worksheet_index: 0, worksheet_name: "Sheet 1", header_row: 1, source_row_number: 2, formula_warning_fields: ["estimatedCost"], source_location_text: "Unverified workbook location" },
      { source_format: "csv", worksheet_index: 1, worksheet_name: "Sheet 2", header_row: 1, source_row_number: 2, formula_warning_fields: [] },
    ]);

    const noFormulaConfirmation = {
      ...workbookRow({ worksheetIndex: 0, rowNumber: 3, fingerprint: "a".repeat(64), name: "Unconfirmed formula", sourceId: "WB-F", formula: true }),
      confirmFormula: false,
    };
    const formulaRefusal = await service.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, source, sourceHash, [noFormulaConfirmation])
    );
    expect(formulaRefusal.error?.code).toBe("22023");

    const wrongSheetName = {
      ...workbookRow({ worksheetIndex: 0, rowNumber: 6, fingerprint: "6".repeat(64), name: "Wrong sheet identity", sourceId: "WB-SHEET" }),
      worksheetName: "Forged sheet name",
    };
    const sheetIdentityRefusal = await service.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, source, sourceHash, [wrongSheetName])
    );
    expect(sheetIdentityRefusal.error?.code).toBe("22023");

    const duplicateRows = [
      workbookRow({ worksheetIndex: 0, rowNumber: 4, fingerprint: "b".repeat(64), name: "Duplicate one", sourceId: "DUP" }),
      workbookRow({ worksheetIndex: 1, rowNumber: 4, fingerprint: "c".repeat(64), name: "Duplicate two", sourceId: " dup " }),
    ];
    const duplicateRefusal = await service.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, source, sourceHash, duplicateRows)
    );
    expect(duplicateRefusal.error?.code).toBe("22023");

    const rollbackHash = "3".repeat(64);
    const rollbackSource = await insertCsvSource(service, fixture.workspaceA, rollbackHash);
    const beforeRollbackProjects = await service
      .from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", fixture.workspaceA);
    const beforeRollbackBatches = await service
      .from("project_portfolio_import_batches").select("id", { count: "exact", head: true }).eq("workspace_id", fixture.workspaceA);
    const malformedSecond = {
      ...workbookRow({ worksheetIndex: 1, rowNumber: 5, fingerprint: "4".repeat(64), name: "Will become empty", sourceId: "ROLLBACK-2" }),
      name: "",
    };
    const rollback = await service.rpc(
      "commit_project_portfolio_import_v2",
      workbookRpcArgs(fixture, rollbackSource, rollbackHash, [
        workbookRow({ worksheetIndex: 0, rowNumber: 5, fingerprint: "5".repeat(64), name: "Must roll back", sourceId: "ROLLBACK-1" }),
        malformedSecond,
      ])
    );
    expect(rollback.error?.code).toBe("22023");
    const afterRollbackProjects = await service
      .from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", fixture.workspaceA);
    const afterRollbackBatches = await service
      .from("project_portfolio_import_batches").select("id", { count: "exact", head: true }).eq("workspace_id", fixture.workspaceA);
    expect(afterRollbackProjects.count).toBe(beforeRollbackProjects.count);
    expect(afterRollbackBatches.count).toBe(beforeRollbackBatches.count);

    const raceHash = "d".repeat(64);
    const raceSource = await insertCsvSource(service, fixture.workspaceA, raceHash);
    const raceArgs = workbookRpcArgs(fixture, raceSource, raceHash, [
      workbookRow({ worksheetIndex: 0, fingerprint: "e".repeat(64), name: "Workbook race", sourceId: "RACE" }),
    ]);
    const race = await Promise.all([
      service.rpc("commit_project_portfolio_import_v2", raceArgs),
      service.rpc("commit_project_portfolio_import_v2", raceArgs),
    ]);
    expect(race.filter((result) => result.error === null), JSON.stringify(race)).toHaveLength(1);
    expect(race.filter((result) => ["23505", "22023"].includes(result.error?.code ?? "")), JSON.stringify(race)).toHaveLength(1);
    const raceRows = await service
      .from("project_portfolio_import_rows")
      .select("created_project_id")
      .eq("workspace_id", fixture.workspaceA)
      .eq("source_sha256", raceHash)
      .eq("outcome", "created");
    expect(raceRows.error).toBeNull();
    expect(raceRows.data).toHaveLength(1);
  });
});
