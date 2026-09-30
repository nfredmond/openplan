import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSynthesisResponseLinkIndex } from "@/lib/engagement/synthesis-response-index";
import { loadSynthesisResponseLinkIndex } from "@/lib/engagement/synthesis-response-index-server";
import { id, scope } from "./fixtures/engagement/synthesis-response-link";
const review = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId };
const rows = Array.from({ length: 302 }, (_, n) => ({ responseId: id(1000 + n), groupId: "retained_group" }));
const index = { ...review, entryCount: rows.length, entries: rows };
function client(data: unknown, error: { code: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error }); return { rpc, db: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}
describe("private retained response link index", () => {
  it("reads a complete index above 300 addresses and distinguishes an empty retained review from missing review", async () => {
    const full = client(index); expect(await loadSynthesisResponseLinkIndex(full.db, review)).toEqual(index);
    expect(full.rpc).toHaveBeenCalledExactlyOnceWith("list_engagement_synthesis_response_links", { p_campaign: review.campaignId, p_review: review.reviewId });
    const empty = { ...review, entryCount: 0, entries: [] }; expect(await loadSynthesisResponseLinkIndex(client(empty).db, review)).toEqual(empty);
    expect(await loadSynthesisResponseLinkIndex(client(null).db, review)).toBeNull();
  });
  it.each(["campaignId", "workspaceId", "reviewId"] as const)("rejects another %s", field => {
    expect(() => readSynthesisResponseLinkIndex({ ...index, [field]: id(99) }, review)).toThrow(/scope/);
  });
  it("requires exact count, unique ordered addresses and strict fields", () => {
    for (const raw of [{ ...index, entryCount: 301 }, { ...index, entries: rows.slice(0, 300) },
      { ...index, entries: [rows[0], ...rows.slice(0, -1)] }, { ...index, entries: [...rows].reverse() },
      { ...index, extra: true }, { ...index, entries: [{ ...rows[0], extra: true }, ...rows.slice(1)] }, { ...index, entryCount: -1 }]) {
      expect(() => readSynthesisResponseLinkIndex(raw, review)).toThrow();
    }
  });
  it("retains distinct groups on the same response in native byte order", () => {
    const entries = ["A", "Z", "a", "z"].map(groupId => ({ responseId: id(1), groupId }));
    expect(readSynthesisResponseLinkIndex({ ...review, entryCount: 4, entries }, review).entries).toEqual(entries);
  });
  it("refuses invalid scope before RPC", async () => {
    const c = client(index);
    await expect(loadSynthesisResponseLinkIndex(c.db, { ...review, extra: true })).rejects.toMatchObject({ kind: "invalid" });
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "forbidden"], ["XX000", "unavailable"]])("does not accept valid data accompanying error %s", async (code, kind) => {
    await expect(loadSynthesisResponseLinkIndex(client(index, { code }).db, review)).rejects.toMatchObject({ kind });
  });
  it("keeps unavailable and incomplete reads distinct from an empty index", async () => {
    for (const data of [undefined, { ...index, entryCount: 303 }]) await expect(loadSynthesisResponseLinkIndex(client(data).db, review)).rejects.toMatchObject({ kind: "unavailable" });
    const c = client(index); c.rpc.mockRejectedValue(new Error("SYNTHETIC private transport detail"));
    await expect(loadSynthesisResponseLinkIndex(c.db, review)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(loadSynthesisResponseLinkIndex(c.db, review)).rejects.not.toThrow(/private transport/);
  });
});
