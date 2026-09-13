import { describe, expect, it, vi } from "vitest";
import { createResponseSchema, updateResponseSchema, removeResponseSchema, writeResponse } from "@/lib/engagement/response-write";

const campaignId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const version = "2026-09-13T06:00:00.123456+00:00";
const edit = { requestId, expectedUpdatedAt: version, reason: "Correct the retained wording" };
const entry = { id: entryId, campaign_id: campaignId, category_id: null, theme_title: "Crossings",
  you_said: "Original words", we_did: "Reviewed response", status: "draft", ai_assisted: false,
  source_item_ids: [], sort_order: 0, published_at: null, created_at: version, updated_at: version };
const receipt = { entry, entryId, requestId, removed: false, replayed: false, becamePublished: false };

describe("response write intents", () => {
  it("requires caller-retained request identity for creates, including accepted AI drafts", () => {
    expect(createResponseSchema.parse({ requestId, themeTitle: " Crossings ", aiAssisted: true, sourceItemIds: [entryId] }))
      .toEqual({ requestId, themeTitle: "Crossings", aiAssisted: true, sourceItemIds: [entryId] });
    expect(createResponseSchema.safeParse({ themeTitle: "Crossings" }).success).toBe(false);
  });
  it("requires a reason and original microsecond version for correction and removal", () => {
    expect(updateResponseSchema.parse({ ...edit, weDid: " Corrected wording " }))
      .toEqual({ ...edit, weDid: "Corrected wording" });
    expect(removeResponseSchema.parse(edit)).toEqual(edit);
    for (const missing of ["requestId", "expectedUpdatedAt", "reason"] as const) {
      const body: Record<string, unknown> = { ...edit }; delete body[missing];
      expect(updateResponseSchema.safeParse({ ...body, weDid: "Correction" }).success).toBe(false);
      expect(removeResponseSchema.safeParse(body).success).toBe(false);
    }
    expect(updateResponseSchema.safeParse({ ...edit, reason: "  ", weDid: "Correction" }).success).toBe(false);
    expect(updateResponseSchema.safeParse(edit).success).toBe(false);
  });
  it("refuses extra authority and identity fields instead of silently dropping them", () => {
    expect(createResponseSchema.safeParse({ requestId, themeTitle: "Crossings", created_by: entryId }).success).toBe(false);
    expect(updateResponseSchema.safeParse({ ...edit, weDid: "Correction", campaignId: entryId }).success).toBe(false);
    expect(removeResponseSchema.safeParse({ ...edit, weDid: "Hidden update" }).success).toBe(false);
  });
});

describe("response transaction client", () => {
  it("sends create provenance to the RPC without direct table writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const body = createResponseSchema.parse({ requestId, themeTitle: "Crossings", aiAssisted: true, sourceItemIds: [entryId] });
    expect((await writeResponse({ rpc } as never, campaignId, { operation: "create", body })).result).toEqual(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("write_engagement_response", {
      p_campaign: campaignId, p_request: requestId, p_operation: "create", p_response: null,
      p_expected_updated_at: null, p_reason: null,
      p_changes: { theme_title: "Crossings", ai_assisted: true, source_item_ids: [entryId] },
    });
  });
  it("keeps exact correction identity, original timestamp and explicit null on retry", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    const body = updateResponseSchema.parse({ ...edit, categoryId: null, weDid: "Corrected" });
    const intent = { operation: "update" as const, entryId, body };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await writeResponse({ rpc } as never, campaignId, intent)).result?.replayed).toBe(true);
    }
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0]).toEqual(["write_engagement_response", {
      p_campaign: campaignId, p_request: requestId, p_operation: "update", p_response: entryId,
      p_expected_updated_at: version, p_reason: edit.reason, p_changes: { category_id: null, we_did: "Corrected" },
    }]);
  });
  it("recovers the committed removal receipt without needing a current response row", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt, removed: true, replayed: true }, error: null });
    expect((await writeResponse({ rpc } as never, campaignId, { operation: "remove", entryId, body: edit })).result?.removed).toBe(true);
    expect(rpc).toHaveBeenCalledWith("write_engagement_response", {
      p_campaign: campaignId, p_request: requestId, p_operation: "remove", p_response: entryId,
      p_expected_updated_at: version, p_reason: edit.reason, p_changes: {},
    });
  });
  it.each([
    ["40001", 409, "conflict"], ["23505", 409, "conflict"], ["P0002", 404, "missing"],
    ["42501", 403, "forbidden"], ["22023", 400, "invalid"], ["22P02", 400, "invalid"],
    ["P0001", 503, "unavailable"], ["08006", 503, "unavailable"],
  ])("distinguishes database %s from an unconfirmed save", async (code, status, kind) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: "Private database detail" } });
    const result = await writeResponse({ rpc } as never, campaignId, { operation: "update", entryId, body: { ...edit, weDid: "Correction" } });
    expect(result.result).toBeNull();
    expect(result.error).toMatchObject({ status, kind });
    expect(result.error?.message).not.toContain("Private database detail");
  });
  it.each([
    { ...receipt, requestId: entryId }, { ...receipt, entryId: requestId },
    { ...receipt, entry: { ...entry, campaign_id: entryId } }, { ...receipt, removed: true },
    { ...receipt, becamePublished: true }, { ...receipt, entry: { ...entry, id: requestId }, entryId: requestId },
    { ...receipt, replayed: "true" }, { ...receipt, entry: { ...entry, status: "not-a-status" } },
    { entryId }, null,
  ])("refuses an invalid or mismatched receipt without reporting an unsaved action", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const result = await writeResponse({ rpc } as never, campaignId, { operation: "update", entryId, body: { ...edit, weDid: "Correction" } });
    expect(result).toMatchObject({ result: null, error: { status: 503, kind: "unavailable" } });
    expect(result.error?.message).toContain("retry the same request");
  });
  it("preserves an unknown result on transport interruption", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("connection ended after commit"));
    expect(await writeResponse({ rpc } as never, campaignId, { operation: "remove", entryId, body: edit }))
      .toMatchObject({ result: null, error: { kind: "unavailable", status: 503 } });
  });
  it("recognizes the explicit publication refusal without treating every internal database exception as invalid input", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001",
      message: "Review and publish linked contributions before publishing the staff response" } });
    expect(await writeResponse({ rpc } as never, campaignId, { operation: "update", entryId, body: { ...edit, status: "published" } }))
      .toMatchObject({ result: null, error: { kind: "invalid", status: 400 } });
  });
});
