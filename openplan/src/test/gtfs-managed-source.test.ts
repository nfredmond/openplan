// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGtfsCatalogRedirect } from "@/lib/gtfs/catalog";
import { authorizeManagedGtfsSubmission, resolveManagedGtfsSubmission, gtfsSubmissionIntentSchema } from "@/lib/gtfs/managed-source";
import type { GtfsSavedSubmission } from "@/lib/gtfs/managed-admission";
import { GTFS_FEED_REFRESH_SOURCE_COLUMNS } from "@/lib/gtfs/route-projections";
vi.mock("@/lib/gtfs/catalog", () => ({ resolveGtfsCatalogRedirect: vi.fn() }));
const catalog = vi.mocked(resolveGtfsCatalogRedirect), id = (n: number) => `ea000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = "http://127.0.0.1:54321", workspaceId = id(1), actorId = id(2), feedId = id(3), url = "https://example.invalid/original.zip";
const saved: GtfsSavedSubmission = { binding: { schemaVersion: 1, target, installationId: id(4), requestId: id(5), workspaceId, actorId, intent: { source: "url", workspaceId, url } }, resolved: null, response: null, archive: null };
const feed = { id: feedId, workspace_id: workspaceId, agency_name: "Saved agency", source_kind: "url", feed_url: url, catalog_provider: null, catalog_source_id: null };
function fixture(rows: unknown[], status = 200) {
 const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(rows.shift()), { status, headers: { "content-type": "application/json" } }));
 const service = createClient(target, "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
 return { service, transport, query: (index = 0) => new URL(String(transport.mock.calls[index][0])).searchParams };
}
afterEach(() => vi.clearAllMocks());
describe("managed GTFS source resolution", () => {
 it("resolves normalized URL identity with an explicit workspace and projection", async () => {
  const f = fixture([null]), result = await resolveManagedGtfsSubmission(f.service, saved.binding.intent, null);
  expect(result).toMatchObject({ feedId: null, source: { kind: "url", sourceUrl: url, normalizedSourceUrl: url } });
  expect(f.query().get("select")).toBe("id,agency_name"); expect(f.query().get("workspace_id")).toBe(`eq.${workspaceId}`); expect(f.query().get("normalized_source_url")).toBe(`eq.${url}`); expect(catalog).not.toHaveBeenCalled();
 });
 it("preserves an existing scoped feed and its display name", async () => {
  const f = fixture([{ id: feedId, agency_name: "Existing agency" }]); expect(await resolveManagedGtfsSubmission(f.service, saved.binding.intent, null)).toMatchObject({ feedId, source: { provisionalName: "Existing agency" } });
 });
 it("does not treat a failed feed lookup as a new feed", async () => {
  const f = fixture([{ code: "XX000", message: "Synthetic lookup unavailable" }], 500); await expect(resolveManagedGtfsSubmission(f.service, saved.binding.intent, null)).rejects.toThrow();
 });
 it("refuses unsupported URL protocols before feed reads", async () => {
  const f = fixture([null]); await expect(resolveManagedGtfsSubmission(f.service, { source: "url", workspaceId, url: "ftp://example.invalid/feed.zip" }, null)).rejects.toThrow("http:// or https://"); expect(f.transport).not.toHaveBeenCalled();
 });
 it("takes catalog source identity and address from the resolved row", async () => {
  catalog.mockResolvedValue({ status: "live", entry: { catalogId: "successor", downloadUrl: url, provider: "Publisher", name: "Published feed", status: "active" }, supersededIds: ["old"] } as unknown as Awaited<ReturnType<typeof resolveGtfsCatalogRedirect>>);
  const f = fixture([null]), result = await resolveManagedGtfsSubmission(f.service, { source: "catalog", workspaceId, catalogId: "old" }, null);
  expect(catalog).toHaveBeenCalledWith("old"); expect(result.source).toMatchObject({ kind: "catalog", catalogProvider: "Publisher", catalogSourceId: "successor", catalogRowStatus: "active", sourceUrl: url });
  expect(f.query().get("catalog_source_id")).toBe("eq.successor"); expect(result).not.toHaveProperty("coverage");
 });
 it.each(["catalog_unavailable", "refused"] as const)("keeps catalog %s separate from a feed identity", async status => {
  catalog.mockResolvedValue({ status, detail: "Synthetic refusal", reason: "requires_api_key" } as unknown as Awaited<ReturnType<typeof resolveGtfsCatalogRedirect>>);
  const f = fixture([null]); await expect(resolveManagedGtfsSubmission(f.service, { source: "catalog", workspaceId, catalogId: "old" }, null)).rejects.toMatchObject({ status: status === "refused" ? 422 : 503 }); expect(f.transport).not.toHaveBeenCalled();
 });
 it("refuses a catalog row without a download URL", async () => {
  catalog.mockResolvedValue({ status: "live", entry: { downloadUrl: null } } as unknown as Awaited<ReturnType<typeof resolveGtfsCatalogRedirect>>);
  const f = fixture([null]); await expect(resolveManagedGtfsSubmission(f.service, { source: "catalog", workspaceId, catalogId: "old" }, null)).rejects.toMatchObject({ status: 422 }); expect(f.transport).not.toHaveBeenCalled();
 });
 it("binds uploaded bytes and filename without a publisher request", async () => {
  const f = fixture([]), archive = { sha256: "a".repeat(64), bytes: 42 };
  expect(await resolveManagedGtfsSubmission(f.service, { source: "upload", workspaceId, filename: "C:\\feeds\\agency.zip" }, archive)).toEqual({ feedId: null, source: { kind: "upload", provisionalName: "agency", uploadSha256: archive.sha256, uploadBytes: 42 } });
  expect(f.transport).not.toHaveBeenCalled(); expect(catalog).not.toHaveBeenCalled();
 });
 it("checks uploaded replacement feed scope and exact id projection", async () => {
  const f = fixture([{ id: feedId }]); expect(await resolveManagedGtfsSubmission(f.service, { source: "upload", workspaceId, feedId, label: "Replacement" }, { sha256: "a".repeat(64), bytes: 42 })).toMatchObject({ feedId, source: { provisionalName: "Replacement" } });
  expect(f.query().get("select")).toBe("id"); expect(f.query().get("workspace_id")).toBe(`eq.${workspaceId}`); expect(f.query().get("id")).toBe(`eq.${feedId}`);
 });
 it("refuses a missing retained archive before an upload feed lookup", async () => { const f = fixture([]); await expect(resolveManagedGtfsSubmission(f.service, { source: "upload", workspaceId, feedId }, null)).rejects.toMatchObject({ status: 409 }); expect(f.transport).not.toHaveBeenCalled(); });
 it.each([null, { id: id(90) }])("refuses a missing or mismatched replacement feed %j", async row => { await expect(resolveManagedGtfsSubmission(fixture([row]).service, { source: "upload", workspaceId, feedId }, { sha256: "a".repeat(64), bytes: 42 })).rejects.toThrow(); });
 it("refreshes the selected feed from scoped stored metadata", async () => {
  const f = fixture([feed, { id: id(90), agency_name: "Other registered source" }]), result = await resolveManagedGtfsSubmission(f.service, { source: "refresh", workspaceId, feedId }, null);
  expect(result).toMatchObject({ feedId, source: { sourceUrl: url, provisionalName: "Saved agency" } }); expect(f.query().get("select")).toBe(GTFS_FEED_REFRESH_SOURCE_COLUMNS.replaceAll(" ", ""));
  expect(f.query().get("workspace_id")).toBe(`eq.${workspaceId}`); expect(f.query().get("id")).toBe(`eq.${feedId}`);
 });
 it.each([{ ...feed, workspace_id: id(90) }, { ...feed, id: id(90) }, { ...feed, source_kind: "upload" }, { ...feed, feed_url: null }, null])("refuses unavailable or mismatched refresh source %j", async row => {
  const f = fixture([row, null]); await expect(resolveManagedGtfsSubmission(f.service, { source: "refresh", workspaceId, feedId }, null)).rejects.toThrow(); expect(f.transport).toHaveBeenCalledTimes(1);
 });
 it("refuses caller source overrides and unknown intent fields", () => {
  expect(() => gtfsSubmissionIntentSchema.parse({ source: "refresh", workspaceId, feedId, url })).toThrow(); expect(() => gtfsSubmissionIntentSchema.parse({ source: "catalog", workspaceId, catalogId: "old", url })).toThrow();
 });
});
describe("retained submission original authority", () => {
 it.each(["owner", "admin", "member"])("permits current original actor role %s with exact scoped role projection", async role => {
  const f = fixture([{ role }]); await authorizeManagedGtfsSubmission(f.service, saved, new AbortController().signal);
  expect(f.query().get("select")).toBe("role"); expect(f.query().get("workspace_id")).toBe(`eq.${workspaceId}`); expect(f.query().get("user_id")).toBe(`eq.${actorId}`); expect(f.transport.mock.calls[0][1]?.signal).toBeDefined();
 });
 it.each([{ role: "viewer" }, { role: "unknown" }, null])("refuses unavailable writer authority %j", async row => { await expect(authorizeManagedGtfsSubmission(fixture([row]).service, saved, new AbortController().signal)).rejects.toThrow("writer access"); });
 it("refuses a failed membership lookup", async () => { await expect(authorizeManagedGtfsSubmission(fixture([{ code: "XX000", message: "Synthetic unavailable" }], 500).service, saved, new AbortController().signal)).rejects.toThrow("writer access"); });
 it("stops before a pre-cancelled membership read", async () => { const f = fixture([]), stopping = new AbortController(); stopping.abort(); await expect(authorizeManagedGtfsSubmission(f.service, saved, stopping.signal)).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled(); });
 it("bounds cancelled membership acknowledgement when a transport ignores its signal", async () => {
  const f = fixture([]), stopping = new AbortController(); f.transport.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 150)); return Response.json({ role: "owner" }); });
  const start = Date.now(), running = authorizeManagedGtfsSubmission(f.service, saved, stopping.signal); setTimeout(() => stopping.abort(), 10);
  await expect(running).rejects.toThrow(); expect(Date.now() - start).toBeLessThan(100);
 });
});
