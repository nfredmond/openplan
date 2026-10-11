// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeGtfsHumanCommand, readGtfsAdoptionReview, type GtfsHumanCommand } from "@/lib/gtfs/managed-human-command";
const id = (n: number) => `e7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: id(1), versionId: id(2), actorId: id(3) }, basis = { feedId: id(4), versionId: id(2), routeCount: 14, stopCount: 287, previousVersionId: null, previousRouteCount: null, previousStopCount: null };
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); vi.clearAllMocks(); });
async function fixture(operation: "cancel" | "adopt" = "cancel") {
 const directory = await mkdtemp(join(tmpdir(), "openplan-gtfs-human-")); directories.push(directory);
 const command: GtfsHumanCommand = operation === "cancel" ? { operation, commandId: id(5), reason: "Planner cancelled the import" } : { operation, commandId: id(5), basis, acceptMaterialShrinkage: false };
 const receipt = operation === "cancel" ? { command: id(5), version: id(2), state: "cancelled", closure: { recorded: true, feedStatusChanged: true }, cleanupPending: true, closedAt: "2026-10-10T12:00:00Z" }
  : { command: id(5), version: id(2), adopted: true, alreadyCurrent: false, basis, reviewAccepted: true, humanAcceptShrinkage: false, adoptedAt: "2026-10-10T12:00:00Z" };
 const controller = new AbortController();
 const transport = vi.fn<typeof fetch>(async (_input, init) => {
  const record = JSON.parse(await readFile(join(directory, "pending.json"), "utf8")); expect(record.binding.command).toEqual(command); expect(record.binding.scope).toEqual(scope);
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-key"); expect(init?.signal).toBeDefined(); return Response.json(receipt);
 });
 const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
 const options = { directory, installationId: id(6), target: "http://127.0.0.1:54321", scope, command, service, signal: controller.signal, deadlineMs: 50 };
 return { directory, command, receipt, controller, transport, options, run: () => executeGtfsHumanCommand(options) };
}
describe("retained human GTFS commands", () => {
 it.each(["cancel", "adopt"] as const)("retains the exact %s command before RPC and rechecks SQL on replay", async operation => {
  const f = await fixture(operation); expect(await f.run()).toEqual(f.receipt); expect(await f.run()).toEqual(f.receipt); expect(f.transport).toHaveBeenCalledTimes(2);
  expect(String(f.transport.mock.calls[0][0])).toBe(`http://127.0.0.1:54321/rest/v1/rpc/${operation === "cancel" ? "cancel_gtfs_ingest" : "adopt_reviewed_gtfs_ingest"}`);
  expect(JSON.parse(String(f.transport.mock.calls[0][1]?.body))).toEqual({ p_workspace: id(1), p_version: id(2), p_actor: id(3), p_command: id(5), ...(operation === "cancel" ? { p_reason: "Planner cancelled the import" } : { p_basis: basis, p_accept_shrinkage: false }) });
 });
 it("recovers an unknown cancellation reply under the same command", async () => {
  const f = await fixture(), normal = f.transport.getMockImplementation()!; f.transport.mockImplementationOnce(async (input, init) => { await normal(input, init); throw new Error("lost reply"); });
  await expect(f.run()).rejects.toThrow("acknowledgement is unavailable"); expect(JSON.parse(await readFile(join(f.directory, "pending.json"), "utf8")).receipt).toBeNull(); expect(await f.run()).toEqual(f.receipt);
  expect(f.transport.mock.calls.map(call => JSON.parse(String(call[1]?.body)).p_command)).toEqual([id(5), id(5)]);
 });
 it.each(["installationId", "target", "actorId", "workspaceId", "versionId", "reason", "commandId"])("refuses changed %s before another dispatch", async field => {
  const f = await fixture(); await f.run(); f.transport.mockClear();
  if (field === "installationId") f.options.installationId = id(90); else if (field === "target") f.options.target = "http://other.invalid";
  else if (["actorId", "workspaceId", "versionId"].includes(field)) f.options.scope = { ...scope, [field]: id(90) };
  else f.options.command = { ...f.command, [field]: field === "reason" ? "Changed reason" : id(90) } as GtfsHumanCommand;
  await expect(f.run()).rejects.toThrow("binding differs"); expect(f.transport).not.toHaveBeenCalled();
 });
 it("refuses changed adoption acceptance and exact reviewed counts", async () => {
  const f = await fixture("adopt"); await f.run(); f.transport.mockClear(); f.options.command = { operation: "adopt", commandId: id(5), basis: { ...basis, routeCount: 13 }, acceptMaterialShrinkage: false };
  await expect(f.run()).rejects.toThrow("binding differs"); expect(f.transport).not.toHaveBeenCalled();
 });
 it.each(["command", "version"] as const)("refuses a cancellation receipt with changed %s", async field => { const f = await fixture(); f.transport.mockResolvedValue(Response.json({ ...f.receipt, [field]: id(90) })); await expect(f.run()).rejects.toThrow("receipt differs"); });
 it("refuses a response claiming failed cancellation rather than confirmed cancellation", async () => { const f = await fixture(); f.transport.mockResolvedValue(Response.json({ ...f.receipt, state: "failed" })); await expect(f.run()).rejects.toThrow(); });
 it("refuses an adoption receipt whose basis or acceptance differs", async () => { const f = await fixture("adopt"); f.transport.mockResolvedValue(Response.json({ ...f.receipt, humanAcceptShrinkage: true })); await expect(f.run()).rejects.toThrow("receipt differs"); });
 it("refuses a changed acknowledged receipt on replay", async () => {
  const f = await fixture(); await f.run(); f.transport.mockResolvedValue(Response.json({ ...f.receipt, closedAt: "2026-10-10T12:00:01Z" })); await expect(f.run()).rejects.toThrow("receipt changed");
 });
 it("refuses a tampered saved receipt before SQL replay", async () => { const f = await fixture(); await f.run(); const path = join(f.directory, "pending.json"), saved = JSON.parse(await readFile(path, "utf8")); saved.receipt.command = id(90); await writeFile(path, JSON.stringify(saved)); f.transport.mockClear(); await expect(f.run()).rejects.toThrow("receipt differs"); expect(f.transport).not.toHaveBeenCalled(); });
 it("requires acceptance for material shrinkage before dispatch", async () => { const f = await fixture("adopt"); f.options.command = { operation: "adopt", commandId: id(5), basis: { ...basis, previousVersionId: id(7), previousRouteCount: 20, previousStopCount: 500 }, acceptMaterialShrinkage: false }; await expect(f.run()).rejects.toThrow("does not match or accept"); expect(f.transport).not.toHaveBeenCalled(); });
 it("refuses missing predecessor counts before dispatch", async () => { const f = await fixture("adopt"); f.options.command = { operation: "adopt", commandId: id(5), basis: { ...basis, previousVersionId: id(7) }, acceptMaterialShrinkage: true }; await expect(f.run()).rejects.toThrow("predecessor differs"); expect(f.transport).not.toHaveBeenCalled(); });
 it("requires matching version review before dispatch", async () => { const f = await fixture("adopt"); f.options.command = { operation: "adopt", commandId: id(5), basis: { ...basis, versionId: id(90) }, acceptMaterialShrinkage: true }; await expect(f.run()).rejects.toThrow("does not match or accept"); expect(f.transport).not.toHaveBeenCalled(); });
 it("accepts explicit review of a material reduction", async () => { const f = await fixture("adopt"), smaller = { ...basis, previousVersionId: id(7), previousRouteCount: 20, previousStopCount: 500 }; f.options.command = { operation: "adopt", commandId: id(5), basis: smaller, acceptMaterialShrinkage: true }; const receipt = { ...f.receipt, basis: smaller, humanAcceptShrinkage: true }; f.transport.mockImplementation(async () => Response.json(receipt)); expect(await executeGtfsHumanCommand(f.options)).toEqual(receipt); });
 it("requires actual adoption evidence rather than an unrecorded success", async () => { const f = await fixture("adopt"); f.transport.mockResolvedValue(Response.json({ ...f.receipt, adoptedAt: null })); await expect(f.run()).rejects.toThrow("evidence differs"); });
 it("refuses a closure receipt that was not recorded", async () => { const f = await fixture(); f.transport.mockResolvedValue(Response.json({ ...f.receipt, closure: { recorded: false, feedStatusChanged: false } })); await expect(f.run()).rejects.toThrow(); });
 it("requires a private absolute command directory", async () => { const f = await fixture(); f.options.directory = "relative-human-command"; await expect(f.run()).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled(); });
 it.each(["http://user:password@example.invalid", "http://example.invalid/?secret=1", "file:///tmp/feed", "http://example.invalid/#fragment"])("refuses an invalid transport target %s", async target => { const f = await fixture(); f.options.target = target; await expect(f.run()).rejects.toThrow("target is invalid"); expect(f.transport).not.toHaveBeenCalled(); });
 it("serializes concurrent command dispatch under the private lock", async () => { const f = await fixture(); let active = 0, peak = 0; const normal = f.transport.getMockImplementation()!; f.options.deadlineMs = 500; f.transport.mockImplementation(async (input, init) => { peak = Math.max(peak, ++active); try { await new Promise(resolve => setTimeout(resolve, 20)); return await normal(input, init); } finally { active--; } }); const results = await Promise.allSettled([f.run(), f.run()]); expect(results.filter(result => result.status === "fulfilled")).toEqual([{ status: "fulfilled", value: f.receipt }]); expect(results.filter(result => result.status === "rejected")).toHaveLength(1); expect(f.transport).toHaveBeenCalledTimes(1); expect(peak).toBe(1); });
 it("bounds acknowledgement from an uncooperative transport", async () => { const f = await fixture(); f.options.deadlineMs = 20; f.transport.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 200)); return Response.json(f.receipt); }); const start = Date.now(); await expect(f.run()).rejects.toThrow("acknowledgement is unavailable"); expect(Date.now() - start).toBeLessThan(150); });
 it("stops a pre-cancelled command before files or transport", async () => { const f = await fixture(); f.controller.abort(); await expect(f.run()).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled(); await expect(readFile(join(f.directory, "pending.json"))).rejects.toMatchObject({ code: "ENOENT" }); });
});
describe("completed transit adoption review", () => {
 function review(raw: unknown) { const transport = vi.fn<typeof fetch>(async () => Response.json(raw)); const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } }); return { transport, run: () => readGtfsAdoptionReview(service, scope, new AbortController().signal) }; }
 it("reads exact completed-version scope without issuing adoption", async () => { const f = review({ basis, materialShrinkage: false, isCurrent: false }); expect(await f.run()).toEqual({ basis, materialShrinkage: false, isCurrent: false }); expect(String(f.transport.mock.calls[0][0])).toMatch(/\/read_gtfs_adoption_review$/); expect(JSON.parse(String(f.transport.mock.calls[0][1]?.body))).toEqual({ p_workspace: id(1), p_version: id(2), p_actor: id(3) }); });
 it("refuses a reviewed different version", async () => { await expect(review({ basis: { ...basis, versionId: id(90) }, materialShrinkage: false, isCurrent: false }).run()).rejects.toThrow("reviewed version"); });
 it("refuses a masked material reduction", async () => { await expect(review({ basis: { ...basis, previousVersionId: id(7), previousRouteCount: 20, previousStopCount: 500 }, materialShrinkage: false, isCurrent: false }).run()).rejects.toThrow("shrinkage differs"); });
 it("refuses a current-state claim without the same predecessor", async () => { await expect(review({ basis, materialShrinkage: false, isCurrent: true }).run()).rejects.toThrow("current version differs"); });
 it("refuses unknown private review fields", async () => { await expect(review({ basis, materialShrinkage: false, isCurrent: false, token: id(90) }).run()).rejects.toThrow(); });
});
