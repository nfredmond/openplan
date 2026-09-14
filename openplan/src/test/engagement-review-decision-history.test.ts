import { createHash } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import native from "./fixtures/decision-link-native.json";
import nativeQueue from "./fixtures/engagement-review-decision-history-native.json";
import { parseReviewSnapshot, buildCampaignReviewHtml, buildCampaignReviewWorkbook, renderCampaignReviewFiles } from "@/lib/engagement/review-export";
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: async () => ({ engine: "chrome", bytes: new Uint8Array([37,80,68,70]) }) }));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const legacy = { schema: 1, capturedAt: "2026-09-14T12:00:00Z", scope: "internal", filters: { status: "approved" }, campaign: { id: native.scope.campaignId, title: "SYNTHETIC history export", summary: null, configurationVersionId: null }, items: [], sessions: [], answers: [], responses: [], definitions: [] };
const archive = () => ({ ...legacy, schema: 2, workspaceId: native.scope.workspaceId, decisionLinkHistoryScope: "campaign", decisionLinkCount: native.withdrawn.entryCount, decisionLinks: structuredClone(native.withdrawn.entries) });
const parse = (value: unknown, expected?: Parameters<typeof parseReviewSnapshot>[2]) => { const raw = JSON.stringify(value); return parseReviewSnapshot(raw, hash(raw), expected); };

describe("private decision history in engagement exports", () => {
  it("reads the actual native queue snapshot after correction and source deletion", async () => {
    expect(nativeQueue.synthetic).toBe(true);
    const saved = await parseReviewSnapshot(nativeQueue.snapshotText, nativeQueue.snapshotSha256, nativeQueue);
    expect(saved.items).toEqual([]);
    expect(saved.decisionLinks?.map(row => row.operation)).toEqual(["link", "refresh", "withdraw"]);
    expect(saved.decisionLinks?.[0].context.decision.rationale).toBe("SYNTHETIC private rationale");
    expect(saved.decisionLinks?.[1].context.decision.rationale).toBe("SYNTHETIC corrected rationale");
    expect(saved.decisionLinks?.[2].context_text).toBe(saved.decisionLinks?.[1].context_text);
  });
  it("verifies native originals and withdrawals without requiring current sources", async () => {
    const saved = await parse(archive(), { ...native.scope, scope: "internal" });
    expect(saved.schema).toBe(2);
    expect(saved.decisionLinks?.map(row => row.operation)).toEqual(["link", "withdraw"]);
    expect(saved.decisionLinks?.[1].context_text).toBe(native.withdrawn.entries[1].context_text);
    expect(saved.decisionLinks?.[0].context.decision.rationale).toBe("SYNTHETIC private rationale");
  });
  it("keeps legacy internal and public snapshots readable without inventing zero history", async () => {
    const internal = await parse(legacy);
    expect(buildCampaignReviewHtml(internal, "test")).toContain("missing evidence, not a count of zero");
    const publicCopy = await parse({ ...legacy, scope: "public" });
    expect(buildCampaignReviewHtml(publicCopy, "test")).not.toContain("Private decision history");
    expect(buildCampaignReviewHtml(publicCopy, "test")).not.toContain("SYNTHETIC private rationale");
  });
  it.each(["workspaceId", "decisionLinkHistoryScope", "decisionLinkCount", "decisionLinks"])("rejects private %s even when empty in a public schema-1 snapshot", async field => {
    await expect(parse({ ...legacy, scope: "public", [field]: field === "decisionLinks" ? [] : null })).rejects.toThrow("Private decision history");
  });
  it("rejects schema-2 public output and unknown history scope", async () => {
    await expect(parse({ ...archive(), scope: "public" })).rejects.toThrow("history scope differs");
    await expect(parse({ ...archive(), decisionLinkHistoryScope: "selection" })).rejects.toThrow("history scope differs");
  });
  it("matches campaign, workspace and disclosure scope to the authenticated job", async () => {
    const expected = { ...native.scope, scope: "internal" };
    await expect(parse(archive(), { ...expected, campaignId: "40000000-0000-4000-8000-000000000004" })).rejects.toThrow("snapshot scope differs");
    await expect(parse(archive(), { ...expected, workspaceId: "40000000-0000-4000-8000-000000000004" })).rejects.toThrow("history scope differs");
    await expect(parse(archive(), { ...expected, scope: "public" })).rejects.toThrow("snapshot scope differs");
  });
  it("refuses incomplete inventories and orphan withdrawals", async () => {
    await expect(parse({ ...archive(), decisionLinkCount: 3 })).rejects.toThrow("inventory is incomplete");
    await expect(parse({ ...archive(), decisionLinks: [native.withdrawn.entries[1]], decisionLinkCount: 1 })).rejects.toThrow("Invalid decision link predecessor");
  });
  it("refuses altered exact bytes even when the outer snapshot hash is recomputed", async () => {
    for (const field of ["payload_text", "context_text"] as const) {
      const changed = archive(); changed.decisionLinks[0][field] += " ";
      await expect(parse(changed)).rejects.toThrow("checksum differs");
    }
  });
  it("discloses campaign-wide private history and renders the original source positions", async () => {
    const html = buildCampaignReviewHtml(await parse(archive()), "test");
    expect(html).toContain("2 saved actions across the entire consultation");
    expect(html).toContain("date filters above do not filter this history");
    expect(html).toContain("Original link"); expect(html).toContain("Withdrawn link");
    expect(html).toContain("Source 1:"); expect(html).not.toContain("Source 6:");
    expect(html).toContain("SYNTHETIC private rationale");
    expect(html).toContain("Source content was unavailable");
  });
  it("retains all operations and exact context text through workbook continuation rows", async () => {
    const book = XLSX.read(await buildCampaignReviewWorkbook(await parse(archive()), "test"), { type: "buffer", cellFormula: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Decision history"]);
    expect(rows.map(row => row.operation)).toEqual(["link", "withdraw"]);
    const sources = XLSX.utils.sheet_to_json(book.Sheets["Decision sources"]);
    expect(sources).toHaveLength(10);
    expect(book.Sheets.Summary["!autofilter"]?.ref).toBe("A1:B6");
    expect(book.Sheets.Summary.B6).toMatchObject({ t: "n", v: 2, f: "COUNTA(\'Decision history\'!A2:A3)" });
    const parts = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Long text"]);
    for (const entry of native.withdrawn.entries) {
      const context = parts.filter(row => row["Record ID"] === entry.id && row.Field === "context_text");
      expect(context.map(row => row.Text).join("")).toBe(entry.context_text);
      expect(context.map(row => row.Part)).toEqual(context.map((_, index) => index + 1));
    }
  });
  it("retains exact snapshot bytes and an operation CSV in the internal ZIP only", async () => {
    const raw = JSON.stringify(archive());
    const files = await renderCampaignReviewFiles(raw, hash(raw));
    const zip = await JSZip.loadAsync(files.find(file => file.format === "zip")!.bytes);
    expect(await zip.file("snapshot.json")!.async("string")).toBe(raw);
    expect(await zip.file("decision-history.csv")!.async("string")).toContain(native.withdrawn.entries[1].id);
    const publicRaw = JSON.stringify({ ...legacy, scope: "public" });
    const publicFiles = await renderCampaignReviewFiles(publicRaw, hash(publicRaw));
    const publicZip = await JSZip.loadAsync(publicFiles.find(file => file.format === "zip")!.bytes);
    expect(publicZip.file("decision-history.csv")).toBeNull();
    expect(await publicZip.file("snapshot.json")!.async("string")).not.toContain("decisionLinks");
  });
});
