vi.mock("server-only", () => ({}));
import { describe, expect, it, vi } from "vitest";

import { PACKET_FRESHNESS_DETAIL, PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import {
  loadReportPacketFreshness,
  PACKET_FRESHNESS_REPORT_SELECT,
  PACKET_FRESHNESS_SAFETY_SELECT,
  type ReportPacketFreshnessEntry,
} from "@/lib/reports/packet-freshness-loader";
import {
  SS4A_SEED_STANDING_ACQUISITION_SELECT,
  SS4A_SEED_STANDING_PROJECT_SELECT,
  SS4A_SEED_STANDING_SELECT,
} from "@/lib/grants/ss4a-seed-fence-standing";
import { createFakeSupabase, FAKE_POSTGREST_MAX_ROWS, type Db } from "./helpers/fake-my-work-tables";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import {
  BASIS_REASON,
  buildFreshnessDb,
  currentArtifactMetadata,
  EARLIER,
  FRESH_P1,
  FRESH_P2,
  FRESH_WS,
  freshnessProject,
  GENERATED,
  LATER,
} from "./helpers/report-freshness-fixtures";

/**
 * The shared report-packet freshness loader, against a PostgREST fake that
 * applies projections, embeds, referenced-table order and limit, ranges and
 * the 1,000-row cap. A report's packet freshness is a public-record claim (it
 * decides whether a packet is handed off), so each rule input is varied here.
 */

async function load(db: Db = buildFreshnessDb(), options: { failures?: Record<string, string>; rule?: "registry" | "project_overview"; projectId?: string } = {}) {
  const fake = createFakeSupabase(db, options.failures);
  const result = await loadReportPacketFreshness(fake.client, { workspaceId: FRESH_WS, rule: options.rule, projectId: options.projectId });
  const byId = new Map(result.entries.map((entry) => [entry.reportId, entry]));
  return { ...fake, result, byId };
}

const standingOf = (entry: ReportPacketFreshnessEntry | undefined) => entry?.standing.state;

describe("loadReportPacketFreshness", () => {
  it("reads one row per report with only its latest artifact embedded", async () => {
    const { selects, queries } = await load();

    expect(selects.reports).toBe(PACKET_FRESHNESS_REPORT_SELECT);
    // Each column a rule reads. Dropping one would silently change a verdict.
    for (const column of [
      "metadata_json", "updated_at", "generated_at", "latest_artifact_kind", "report_type", "engagement_campaign_id",
      "rtp_basis_stale", "rtp_basis_stale_reason", "rtp_cycles(updated_at)",
      "report_artifacts!report_id(generated_at, metadata_json)", "jurisdiction_context", "place_subdivision_code",
    ]) {
      expect(selects.reports, column).toContain(column);
    }
    expect(selects.safety_crash_ingests).toBe(PACKET_FRESHNESS_SAFETY_SELECT);
    const reportRead = queries.find((query) => query.table === "reports")!;
    expect(reportRead.ops).toContainEqual({ verb: "eq", args: ["workspace_id", FRESH_WS] });
    expect(reportRead.ops).toContainEqual({ verb: "order", args: ["generated_at", { ascending: false, referencedTable: "report_artifacts" }] });
    expect(reportRead.ops).toContainEqual({ verb: "limit", args: [1, { referencedTable: "report_artifacts" }] });
    expect(reportRead.ops.some((op) => op.verb === "range")).toBe(true);
    // Every artifact ever generated is never read.
    expect(queries.some((query) => query.table === "report_artifacts")).toBe(false);
  });

  it("judges each packet by the registry rule", async () => {
    const { result, byId } = await load();

    expect(result.failures).toEqual([]);
    expect(byId.get("r-current")?.freshness.label).toBe(PACKET_FRESHNESS_LABELS.CURRENT);
    expect(standingOf(byId.get("r-current"))).toBe("current");
    expect(byId.get("r-edited")?.standing).toEqual({
      state: "stale",
      reasons: [expect.stringContaining("does not match a completed generation writeback")],
    });
    expect(byId.get("r-crash")?.standing).toEqual({ state: "stale", reasons: [PACKET_FRESHNESS_DETAIL.REFRESH_RECOMMENDED] });
    expect(standingOf(byId.get("r-none"))).toBe("no_packet");
  });

  it("adds the upstream model-run flag as its own reason without changing the page label", async () => {
    const { byId } = await load();
    const basis = byId.get("r-basis");

    expect(basis?.freshness.label).toBe(PACKET_FRESHNESS_LABELS.CURRENT);
    expect(basis?.basisStale).toEqual({ reason: BASIS_REASON, markedAt: LATER });
    expect(basis?.standing).toEqual({ state: "stale", reasons: [BASIS_REASON] });
  });

  it("keeps another workspace's reports out", async () => {
    const { byId, result } = await load();
    expect(byId.has("r-decoy")).toBe(false);
    expect(result.entries.every((entry) => entry.reportId !== "r-decoy")).toBe(true);
  });

  it("calls a packet unassessed, not current, when crash evidence could not be read", async () => {
    const { result, byId } = await load(buildFreshnessDb(), { failures: { safety_crash_ingests: "permission denied for table safety_crash_ingests" } });

    expect(result.failures).toEqual([
      { label: "project crash evidence used for packet freshness", message: "permission denied for table safety_crash_ingests", pending: false },
    ]);
    expect(byId.get("r-current")?.freshness.label).toBe("Source evidence unassessed");
    expect(byId.get("r-current")?.standing).toEqual({
      state: "unassessed",
      reasons: [expect.stringContaining("could not be checked")],
    });
    // A change seen elsewhere is still a change.
    expect(standingOf(byId.get("r-edited"))).toBe("stale");
  });

  it("returns no verdicts and names the read when the reports cannot be read", async () => {
    const { result } = await load(buildFreshnessDb(), { failures: { reports: "permission denied for table reports" } });
    expect(result.entries).toEqual([]);
    expect(result.failures).toEqual([{ label: "report packets", message: "permission denied for table reports", pending: false }]);
  });

  it("reads every report past the 1,000-row cap", async () => {
    const db = buildFreshnessDb();
    const extra = FAKE_POSTGREST_MAX_ROWS + 50;
    for (let index = 0; index < extra; index += 1) {
      (db.reports as Array<Record<string, unknown>>).push({
        id: `r-bulk-${String(index).padStart(5, "0")}`, workspace_id: FRESH_WS, project_id: null, rtp_cycle_id: null,
        engagement_campaign_id: null, title: "Bulk draft", report_type: "project_status", status: "draft",
        generated_at: null, latest_artifact_kind: null, updated_at: EARLIER, metadata_json: {},
        rtp_basis_stale: false, rtp_basis_stale_reason: null, rtp_basis_stale_marked_at: null,
      });
    }
    const { result } = await load(db);
    expect(result.entries.length).toBe(6 + extra);
  });

  it("finds a project's latest crash acquisition past the 1,000-row cap", async () => {
    const db = buildFreshnessDb();
    // Newer acquisitions for P1 fill the first thousand rows, newest first.
    // P2's only acquisition sorts after them, and it is newer than P2's packet.
    db.safety_crash_ingests = [
      ...Array.from({ length: FAKE_POSTGREST_MAX_ROWS + 100 }, (_, index) => ({
        id: `ingest-bulk-${String(index).padStart(5, "0")}`, workspace_id: FRESH_WS, project_id: FRESH_P1,
        created_at: "2026-10-20T12:30:00.000Z", evidence_revision: 1,
      })),
      { id: "ingest-p2", workspace_id: FRESH_WS, project_id: FRESH_P2, created_at: "2026-10-20T12:00:01.000Z", evidence_revision: 2 },
    ];
    const { byId } = await load(db);
    expect(byId.get("r-crash")?.standing).toEqual({ state: "stale", reasons: [PACKET_FRESHNESS_DETAIL.REFRESH_RECOMMENDED] });
  });

  it("applies the Project page's rule on request, which does not read crash acquisitions", async () => {
    const { byId, queries } = await load(buildFreshnessDb(), { rule: "project_overview", projectId: FRESH_P2 });

    // The rule difference, recorded: the registry calls this packet stale.
    expect(byId.get("r-crash")?.freshness.label).toBe(PACKET_FRESHNESS_LABELS.CURRENT);
    expect(queries.some((query) => query.table === "safety_crash_ingests")).toBe(false);
    expect([...byId.keys()]).toEqual(["r-crash"]);
  });

  it("uses the Project page's no-grace comparison for a legacy artifact", async () => {
    const db = buildFreshnessDb();
    const project = freshnessProject(FRESH_P1, FRESH_WS, "Main Street corridor");
    const legacy = currentArtifactMetadata(project, GENERATED);
    delete legacy.generationWriteback;
    db.reports = [{ ...(db.reports as Array<Record<string, unknown>>)[0], id: "r-legacy", updated_at: "2026-10-20T12:05:00.000Z" }];
    db.report_artifacts = [{ id: "a-legacy", report_id: "r-legacy", generated_at: GENERATED, metadata_json: legacy }];

    const registry = await load(db);
    const overview = await load(db, { rule: "project_overview" });
    // Five minutes after generation: inside the registry's 15-minute grace, outside the Project page's.
    expect(registry.byId.get("r-legacy")?.freshness.label).not.toBe(PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED);
    expect(overview.byId.get("r-legacy")?.freshness.label).toBe(PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED);
  });
});

describe("the freshness projections name real columns", () => {
  const schema = loadSchemaInventory();

  /** `table` columns and `embed(...)` children, checked against the migrations' own schema. */
  function unknownColumns(table: string, select: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of select) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; } else current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts.flatMap((part) => {
      const open = part.indexOf("(");
      if (open === -1) return schema.hasColumn(table, part) ? [] : [`${table}.${part}`];
      const embedded = part.slice(0, open).split("!")[0];
      return unknownColumns(embedded, part.slice(open + 1, part.lastIndexOf(")")));
    });
  }

  it.each([
    ["reports", PACKET_FRESHNESS_REPORT_SELECT],
    ["safety_crash_ingests", PACKET_FRESHNESS_SAFETY_SELECT],
    ["funding_opportunity_safety_seeds", SS4A_SEED_STANDING_SELECT],
    ["projects", SS4A_SEED_STANDING_PROJECT_SELECT],
    ["safety_crash_ingests", SS4A_SEED_STANDING_ACQUISITION_SELECT],
  ])("%s: %s", (table, select) => {
    expect(schema.columns(table)?.size ?? 0).toBeGreaterThan(0);
    expect(unknownColumns(table, select)).toEqual([]);
  });
});
