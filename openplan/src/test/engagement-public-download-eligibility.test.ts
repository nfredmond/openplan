import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCampaignReviewWorkbook, type EngagementReviewSnapshot } from "@/lib/engagement/review-export";
const m = vi.hoisted(() => ({ service: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: m.service }));
import { downloadEngagementReview } from "@/lib/engagement/review-export-download";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const campaignId = "10000000-0000-4000-8000-000000000001", workspaceId = "20000000-0000-4000-8000-000000000002";
const response = { id: "30000000-0000-4000-8000-000000000003", campaign_id: campaignId, status: "published", category_id: null,
  theme_title: "SYNTHETIC theme", you_said: "SYNTHETIC reviewed input", we_did: "SYNTHETIC retained answer", source_item_ids: [],
  ai_assisted: false, sort_order: 0, published_at: "2026-09-27", created_at: "2026-09-27", updated_at: "2026-09-27" };
const snapshot: EngagementReviewSnapshot = { schema: 1, capturedAt: "2026-09-27T12:00:00Z", scope: "public", filters: {},
  campaign: { id: campaignId, title: "SYNTHETIC public report", summary: null, configurationVersionId: null },
  items: [], sessions: [], answers: [], responses: [response], definitions: [] };
const jobId = "40000000-0000-4000-8000-000000000004", reportId = "50000000-0000-4000-8000-000000000005";
let raw: string, bytes: Buffer, checksum: string, eligible: boolean, failed: boolean, visible: Record<string, unknown>;
let reads: Array<[string, string]>;
let download: ReturnType<typeof vi.fn>;
let job: { id: string; report_id: string; campaign_id: string; workspace_id: string; scope: string; status: string;
  snapshot_sha256: string; artifacts_json: { format: string; path: string; checksum: string; contentType: string; byteLength: number }[] };
const query = (table: string, data: unknown) => ({ select(columns: string) {
  reads.push([table, columns]);
  const builder = { eq: () => builder, maybeSingle: async () => ({ data, error: null }) }; return builder;
} });
const caller = { from: (table: string) => query(table, job) } as unknown as SupabaseClient;
const call = () => downloadEngagementReview(caller, jobId, "xlsx", { campaignId, reportId });

beforeEach(async () => {
  vi.clearAllMocks(); reads = []; eligible = true; failed = false; visible = { ...response };
  raw = JSON.stringify(snapshot); bytes = await buildCampaignReviewWorkbook(snapshot, hash(raw)); checksum = hash(bytes);
  job = { id: jobId, report_id: reportId, campaign_id: campaignId, workspace_id: workspaceId, scope: "public", status: "complete",
    snapshot_sha256: hash(raw), artifacts_json: [{ format: "xlsx", path: `${workspaceId}/${reportId}/${jobId}/${checksum}.xlsx`,
      checksum, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteLength: bytes.length }] };
  download = vi.fn(async (path: string) => { expect(path).toBe(job.artifacts_json[0].path); return { data: new Blob([new Uint8Array(bytes)]), error: null }; });
  m.service.mockReturnValue({
    from: (table: string) => { expect(table).toBe("engagement_report_jobs"); return query(table, { snapshot_text: raw }); },
    async rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe("read_engagement_response_snapshot"); expect(args).toEqual({ p_campaign: campaignId, p_published_only: true });
      return { data: { campaignId, publishedOnly: true, count: eligible ? 1 : 0, entries: eligible ? [visible] : [] },
        error: failed ? { message: "SYNTHETIC interrupted current-state read" } : null };
    },
    storage: { from: (bucket: string) => { expect(bucket).toBe("report-artifacts"); return { download }; } },
  });
});

describe("public retained XLSX download eligibility", () => {
  it("delivers original checksummed workbook bytes through the real currentness helper", async () => {
    const result = await call(); expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes); expect(result.headers.get("X-Content-SHA256")).toBe(checksum);
    expect(result.headers.get("Content-Disposition")).toContain(".xlsx");
    expect(reads).toEqual([["engagement_report_jobs", "id,workspace_id,campaign_id,report_id,scope,status,artifacts_json,snapshot_sha256"], ["engagement_report_jobs", "snapshot_text"]]);
  });
  it("denies ineligible published rows before storage and recovers the same original bytes", async () => {
    const original = Buffer.from(bytes), originalRaw = raw;
    eligible = false;
    expect((await call()).status).toBe(404); expect(download).not.toHaveBeenCalled();
    eligible = true;
    const recovered = await call(); expect(recovered.status).toBe(200);
    expect(Buffer.from(await recovered.arrayBuffer())).toEqual(original); expect(hash(bytes)).toBe(checksum); expect(raw).toBe(originalRaw);
  });
  it("denies corrected wording without changing the original workbook", async () => {
    const original = Buffer.from(bytes);
    visible = { ...response, we_did: "SYNTHETIC corrected answer" };
    expect((await call()).status).toBe(404); expect(download).not.toHaveBeenCalled();
    expect(bytes).toEqual(original); expect(hash(bytes)).toBe(checksum);
  });
  it("refuses an interrupted eligibility read even with valid stale data and permits retry", async () => {
    failed = true;
    expect((await call()).status).toBe(404); expect(download).not.toHaveBeenCalled();
    failed = false;
    const retried = await call(); expect(retried.status).toBe(200);
    expect(hash(Buffer.from(await retried.arrayBuffer()))).toBe(checksum);
  });
});
