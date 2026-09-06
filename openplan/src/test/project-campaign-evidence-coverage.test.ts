import { describe, expect, it } from "vitest";
import { loadProjectCampaignsForEvidence } from "@/lib/engagement/campaign-projects";
import { loadPublishableProjectEngagementGeometry } from "@/lib/project-evidence-bundles/engagement-export-privacy";

type Row = Record<string, unknown>;

function fixture(options: { failLinked?: boolean; alteredDuplicate?: boolean; failItems?: boolean; unpublished?: boolean; missingDate?: boolean } = {}) {
  const campaign = (id: string, projectId: string, workspaceId = "workspace") => ({
    id, project_id: projectId, workspace_id: workspaceId, status: "active", share_token: `token-${id}`,
    allow_public_submissions: false, submissions_closed_at: "2026-09-01", updated_at: "2026-09-06",
  });
  const campaigns = [campaign("lead", "project"), campaign("shared", "other-project"),
    campaign("unrelated", "other-project"), campaign("foreign", "project", "foreign-workspace")];
  if (options.unpublished) campaigns[1].status = "draft";
  const link = (id: string, workspaceId = "workspace") => ({
    campaign_id: id, project_id: "project", workspace_id: workspaceId,
    engagement_campaigns: campaigns.find((row) => row.id === id),
  });
  const tables: Record<string, Row[]> = {
    engagement_campaigns: campaigns,
    engagement_campaign_projects: [link("lead"), link("shared"), link("foreign", "foreign-workspace")],
    engagement_items: [
      { id: "public-lead", campaign_id: "lead", source_type: "public", status: "approved" },
      { id: "public-shared", campaign_id: "shared", source_type: "public", status: "approved" },
      { id: "private", campaign_id: "shared", source_type: "public", status: "approved", metadata_json: { visibility: "private" } },
      { id: "internal", campaign_id: "shared", source_type: "internal", status: "approved" },
      { id: "pending", campaign_id: "shared", source_type: "public", status: "pending" },
      { id: "foreign-item", campaign_id: "foreign", source_type: "public", status: "approved" },
    ].map((row) => ({ title: "Never export title", body: "Private text", submitted_by: "Private name", longitude: 0, latitude: 0, geometry: null, created_at: options.missingDate ? null : "2026-09-06", ...row })),
  };
  const calls: Array<{ table: string; select: string; order: string | null; from: number }> = [];
  const client = { from(table: string) { return { select(columns: string) {
    const filters: Array<[string, string]> = [];
    const inFilters: Array<[string, string[]]> = [];
    let order: string | null = null;
    const builder = {
      eq(column: string, value: string) { filters.push([column, value]); return builder; },
      in(column: string, values: string[]) { inFilters.push([column, values]); return builder; },
      order(column: string) { order = column; return builder; },
      async range(from: number, _to: number) {
        calls.push({ table, select: columns, order, from });
        if (options.failLinked && table === "engagement_campaign_projects") return { data: null, error: { message: "permission denied" } };
        if (options.failItems && table === "engagement_items" && from > 0) return { data: null, error: { message: "connection lost" } };
        const selected = (tables[table] ?? []).filter((row) => filters.every(([column, value]) => {
          const path = column.split(".");
          return (path.length === 1 ? row[column] : (row[path[0]] as Row)?.[path[1]]) === value;
        }) && inFilters.every(([column, values]) => values.includes(String(row[column])))).sort((a, b) => String(a[order ?? "id"]).localeCompare(String(b[order ?? "id"])));
        // Simulate an operator-configured server cap smaller than the request.
        const data = selected.slice(from, from + 1).map((row) => {
          if (table !== "engagement_campaign_projects") return Object.fromEntries(columns.split(",").map((key) => [key.trim(), row[key.trim()]]));
          const embeddedFields = columns.match(/engagement_campaigns!inner\(([^)]+)\)/)?.[1];
          if (!embeddedFields) return { campaign_id: row.campaign_id };
          const original = row.engagement_campaigns as Row;
          // Embedded JSON may order keys differently from top-level rows.
          const embedded = Object.fromEntries(embeddedFields.split(",").reverse().map((key) => [key.trim(), original[key.trim()]]));
          if (options.alteredDuplicate && row.campaign_id === "lead") embedded.status = "draft";
          return { campaign_id: row.campaign_id, engagement_campaigns: embedded };
        });
        return { data, error: null };
      },
    }; return builder;
  } }; } };
  return { client, calls };
}

describe("project campaign evidence coverage", () => {
  it("excludes a shared campaign whose public page is unavailable", async () => {
    const result = await loadPublishableProjectEngagementGeometry(fixture({ unpublished: true }).client, { id: "project", workspace_id: "workspace" });
    expect(result.error).toBeNull();
    expect(result.data?.map((row) => row.id)).toEqual(["public-lead"]);
  });

  it("refuses missing recorded dates rather than inventing one", async () => {
    const result = await loadPublishableProjectEngagementGeometry(fixture({ missingDate: true }).client, { id: "project", workspace_id: "workspace" });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("missing its recorded date");
  });
  it("pages comments, removes private and pending records, and exports geometry without personal fields", async () => {
    const { client } = fixture();
    const result = await loadPublishableProjectEngagementGeometry(client, { id: "project", workspace_id: "workspace" });
    expect(result.error).toBeNull();
    expect(result.data).toEqual(["public-lead", "public-shared"].map((id) => ({ id, geometry: null, longitude: 0, latitude: 0, sourceType: "public", createdAt: "2026-09-06" })));
    expect(JSON.stringify(result.data)).not.toMatch(/Private|Never export|metadata|submitted_by|body/);
  });

  it("discards a partial comment read when a later page fails", async () => {
    const { client } = fixture({ failItems: true });
    const result = await loadPublishableProjectEngagementGeometry(client, { id: "project", workspace_id: "workspace" });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("could not be fully read");
  });
  it("reads every server-capped page, includes shared coverage once and excludes unrelated workspaces", async () => {
    const { client, calls } = fixture();
    const result = await loadProjectCampaignsForEvidence(client, { id: "project", workspace_id: "workspace" });
    expect(result.error).toBeNull();
    expect(result.data?.map((row) => row.id)).toEqual(["lead", "shared"]);
    expect(result.data?.[1]).toMatchObject({ status: "active", share_token: "token-shared", allow_public_submissions: false, submissions_closed_at: "2026-09-01", updated_at: "2026-09-06" });
    expect(calls.filter((call) => call.table === "engagement_campaign_projects").map((call) => call.from)).toEqual([0, 1, 2]);
    expect(calls.every((call) => call.order === (call.table === "engagement_campaign_projects" ? "campaign_id" : "id"))).toBe(true);
  });

  it("refuses the whole export coverage when linked records cannot be read", async () => {
    const { client } = fixture({ failLinked: true });
    const result = await loadProjectCampaignsForEvidence(client, { id: "project", workspace_id: "workspace" });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("complete project campaign coverage");
  });

  it("refuses conflicting publication states instead of picking one duplicate", async () => {
    const { client } = fixture({ alteredDuplicate: true });
    const result = await loadProjectCampaignsForEvidence(client, { id: "project", workspace_id: "workspace" });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("changed during the read");
  });
});
