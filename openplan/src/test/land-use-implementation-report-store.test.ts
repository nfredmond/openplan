import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { executeImplementationReport } from "@/lib/land-use-plans/implementation-report-store";
import { implementationReportCommandSchema } from "@/lib/land-use-plans/implementation-report-command";
import { hashFrozenRecord, serializeFrozenRecord } from "@/lib/land-use-plans/versioning";

const id = (n: number) => `35000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { planId: id(1), workspaceId: id(2), actorId: id(3) };
const snapshot = { plan: { id: scope.planId, descriptorId: "local-unconfigured", planKindKey: "community",
  title: "SYNTHETIC adopted plan", authorityLabel: "SYNTHETIC authority", geographyLabel: "SYNTHETIC area" },
  version: { id: id(4), versionNumber: 1 }, nodes: [], relationships: [], designations: [], implementationActions: [] };
const command = { operation: "generate", commandId: id(5), versionId: id(4), expectedVersionHash: hashFrozenRecord(snapshot),
  reportingPeriodStart: "2026-01-01", reportingPeriodEnd: "2026-10-07", title: "SYNTHETIC report", summary: null };
const raw = ` \n${JSON.stringify(command)}\n`;
const receipt = { ...scope, replayed: false, commandId: command.commandId, versionId: command.versionId,
  commandSha256: createHash("sha256").update(raw).digest("hex"), adoptedVersionContentHash: command.expectedVersionHash,
  reportId: id(6), artifactId: id(7), implementationReportId: id(8), contentHash: "a".repeat(64),
  reportingPeriodStart: command.reportingPeriodStart, reportingPeriodEnd: command.reportingPeriodEnd,
  title: command.title, summary: command.summary, generatedAt: "2026-10-07T00:00:00.123456Z" };
type Row = { data: Record<string, unknown> | null; error: unknown };
let previous: Row, retained: Row;
let queries: Array<{ table: string; projection: string; filters: Array<[string, unknown]> }>;
const from = vi.fn(), rpc = vi.fn();
const client = { from, rpc } as unknown as Parameters<typeof executeImplementationReport>[0];
beforeEach(() => {
  vi.clearAllMocks(); queries = []; previous = { data: null, error: null };
  retained = { data: { id: command.versionId, workspace_id: scope.workspaceId, plan_id: scope.planId, version_number: 1,
    state: "adopted", content_hash: command.expectedVersionHash, frozen_snapshot: structuredClone(snapshot) }, error: null };
  from.mockImplementation((table: string) => {
    const query = { table, projection: "", filters: [] as Array<[string, unknown]> }; queries.push(query);
    const chain = { select: (projection: string) => { query.projection = projection; return chain; },
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
      maybeSingle: async () => {
        const row = table === "land_use_plan_implementation_report_commands" ? previous : retained;
        const fields = query.projection.split(",").map(value => value.trim());
        return { ...row, data: row.data && Object.fromEntries(Object.entries(row.data).filter(([key]) => fields.includes(key))) };
      },
    }; return chain;
  });
  rpc.mockResolvedValue({ data: structuredClone(receipt), error: null });
});

it("verifies the selected adopted source and sends exact request bytes to one transaction", async () => {
  expect(await executeImplementationReport(client, scope, raw)).toEqual(receipt);
  expect(queries).toEqual([
    { table: "land_use_plan_implementation_report_commands", projection: "command_id", filters: [["plan_id", scope.planId], ["workspace_id", scope.workspaceId], ["command_id", command.commandId]] },
    { table: "land_use_plan_versions", projection: "id, workspace_id, plan_id, version_number, state, content_hash, frozen_snapshot",
      filters: [["id", command.versionId], ["plan_id", scope.planId], ["workspace_id", scope.workspaceId]] },
  ]);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("create_land_use_plan_implementation_report", { p_plan_id: scope.planId,
    p_workspace_id: scope.workspaceId, p_actor_id: scope.actorId, p_command_id: command.commandId,
    p_command_text: raw, p_adopted_snapshot_text: serializeFrozenRecord(snapshot) });
});
it("replays without consulting a later adopted version", async () => {
  previous.data = { command_id: command.commandId }; retained = { data: null, error: Error("Later source unavailable") };
  rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
  expect(await executeImplementationReport(client, scope, raw)).toEqual({ ...receipt, replayed: true });
  expect(queries).toHaveLength(1); expect(rpc.mock.calls[0][1].p_adopted_snapshot_text).toBeNull();
});
it("accepts a concurrent exact replay after preparing the same adopted source", async () => {
  rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
  expect((await executeImplementationReport(client, scope, raw)).replayed).toBe(true);
});
it.each([{ error: Error("Read failed"), data: null }, { error: null, data: {} }, { error: null, data: { command_id: id(9) } }])(
  "refuses unavailable or mismatched receipt discovery %j", async row => {
    previous = row; await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind: "unavailable", status: 503 });
    expect(queries).toHaveLength(1); expect(rpc).not.toHaveBeenCalled();
  });
it("refuses unavailable version reads", async () => {
  retained.error = Error("Read failed"); await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind: "unavailable" });
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses missing or altered adopted sources even when a substituted version is internally consistent", async () => {
  const substituted = { ...snapshot, version: { ...snapshot.version, id: id(9) } };
  const changedHash = hashFrozenRecord(substituted);
  retained.data = { ...retained.data, id: id(9), frozen_snapshot: substituted, content_hash: changedHash };
  await expect(executeImplementationReport(client, scope, JSON.stringify({ ...command, expectedVersionHash: changedHash }))).rejects.toMatchObject({ kind: "conflict" });
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses missing or altered adopted sources when the command hash differs from a valid retained source", async () => {
  await expect(executeImplementationReport(client, scope, JSON.stringify({ ...command, expectedVersionHash: "b".repeat(64) }))).rejects.toMatchObject({ kind: "conflict" });
  expect(rpc).not.toHaveBeenCalled();
});
it.each([null, { id: id(9) }, { workspace_id: id(9) }, { plan_id: id(9) }, { version_number: 2 }, { state: "superseded" },
  { content_hash: "b".repeat(64) }, { frozen_snapshot: { ...snapshot, plan: { ...snapshot.plan, title: "Changed" } } }, { frozen_snapshot: null }])(
  "refuses missing or altered adopted sources %j", async patch => {
    retained.data = patch === null ? null : { ...retained.data, ...patch };
    await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind: "conflict", status: 409 }); expect(rpc).not.toHaveBeenCalled();
  });
it.each([["PT400", "invalid", 400], ["42501", "forbidden", 403], ["PT404", "missing", 404], ["PT409", "conflict", 409], ["XX000", "unavailable", 503]])(
  "maps native %s to %s", async (code, kind, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "Private database diagnostic" } });
    await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind, status, message: kind });
  });
it.each(["actorId", "workspaceId", "planId", "commandId", "versionId"])("refuses substituted receipt %s", async key => {
  rpc.mockResolvedValue({ data: { ...receipt, [key]: id(9) }, error: null });
  await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind: "unavailable" });
});
it.each([{ commandSha256: "b".repeat(64) }, { adoptedVersionContentHash: "b".repeat(64) }, { reportingPeriodStart: "2026-01-02" },
  { reportingPeriodEnd: "2026-10-08" }, { title: "Other title" }, { summary: "Other summary" }, { generatedAt: "invalid" },
  { reportId: "invalid" }, { artifactId: "invalid" }, { implementationReportId: "invalid" }, { contentHash: "invalid" }, { extra: true }])(
  "refuses incomplete or inconsistent receipts %j", async patch => {
    rpc.mockResolvedValue({ data: { ...receipt, ...patch }, error: null });
    await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind: "unavailable" });
  });
it("requires replay confirmation when a command was already found", async () => {
  previous.data = { command_id: command.commandId };
  await expect(executeImplementationReport(client, scope, raw)).rejects.toMatchObject({ kind: "unavailable" });
});
it.each(["{", "null", " ".repeat(98_305), raw + " ".repeat(98_304), JSON.stringify({ ...command, summary: "😀".repeat(20_001) }),
  JSON.stringify({ ...command, title: "\u0000" }), JSON.stringify({ ...command, summary: "\ud800" }),
  JSON.stringify({ ...command, title: " padded " }), JSON.stringify({ ...command, reportingPeriodStart: "0000-01-01" }),
  JSON.stringify({ ...command, reportingPeriodStart: "2026-02-30" }), JSON.stringify({ ...command, reportingPeriodEnd: "2025-12-31" }),
  JSON.stringify({ ...command, extra: true }), JSON.stringify({ ...command, title: "x".repeat(181) })])(
  "refuses invalid command before database access, case %#", async text => {
    await expect(executeImplementationReport(client, scope, text)).rejects.toMatchObject({ kind: "invalid", status: 400 });
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
it("validates server scope before database access", async () => {
  await expect(executeImplementationReport(client, { ...scope, actorId: "invalid" }, raw)).rejects.toMatchObject({ kind: "invalid" });
  expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it("accepts supported Unicode and counts Unicode code points consistently with PostgreSQL", () => {
  expect(implementationReportCommandSchema.safeParse({ ...command, title: "😀".repeat(180), summary: "😀".repeat(20_000) }).success).toBe(true);
  expect(implementationReportCommandSchema.safeParse({ ...command, title: "😀".repeat(181) }).success).toBe(false);
});
