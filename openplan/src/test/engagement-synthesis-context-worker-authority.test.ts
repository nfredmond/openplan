// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSynthesisContextScheduleAuthority } from "@/lib/engagement/synthesis-context-worker-authority";
import { synthesisContextJobFixture } from "./fixtures/engagement/synthesis-context-job";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

function fixture() {
  const f = synthesisContextJobFixture(0);
  const plan = { request_id: f.f.scope.requestId, header_text: f.plan.headerText, header_sha256: f.plan.headerSha256 };
  const seal = { request_id: f.f.scope.requestId, receipt_text: f.state.seal!.receiptText, receipt_sha256: f.state.seal!.receiptSha256 };
  for (const [table, row] of [["engagement_synthesis_generation_plans", plan], ["engagement_synthesis_generation_plan_seals", seal]] as const) {
    f.rows.set(table, [...(f.rows.get(table) ?? []), row]);
  }
  function grant() { f.grant.intent_text = JSON.stringify(f.grantIntent); f.grant.intent_sha256 = hash(f.grant.intent_text); }
  function changeHeader(patch: Record<string, unknown>) {
    plan.header_text = JSON.stringify({ ...JSON.parse(plan.header_text), ...patch }); plan.header_sha256 = hash(plan.header_text);
    f.grantIntent.headerSha256 = plan.header_sha256; grant();
    seal.receipt_text = JSON.stringify({ ...JSON.parse(seal.receipt_text), headerSha256: plan.header_sha256 }); seal.receipt_sha256 = hash(seal.receipt_text);
  }
  const load = () => loadSynthesisContextScheduleAuthority(f.service, f.args.authorizationId, f.controller.signal);
  return { ...f, planRow: plan, sealRow: seal, resealGrant: grant, changeHeader, load };
}

describe("context scheduler historical authority", () => {
  it("reads immutable identity without current scope or provider credentials", async () => {
    const f = fixture(); f.options.failRpc = "read_engagement_synthesis_context_plan";
    const result = await f.load();
    expect(result).toMatchObject({ grant: f.grant, scope: f.f.scope, header: f.plan.header, headerText: f.plan.headerText,
      headerSha256: f.plan.headerSha256, authorization: f.grantIntent });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.trace.map(row => [row.table, row.columns, row.filters])).toEqual([
      ["engagement_synthesis_generation_authorizations", "id,request_id,intent_text,intent_sha256,credential_sha256", { id: f.args.authorizationId }],
      ["engagement_synthesis_generation_requests", "id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256,created_at", { id: f.f.scope.requestId }],
      ["engagement_synthesis_context_requests", "request_id,parent_request_id,context_text,context_sha256,created_at", { request_id: f.f.scope.requestId }],
      ["engagement_synthesis_generation_plans", "request_id,header_text,header_sha256", { request_id: f.f.scope.requestId }],
      ["engagement_synthesis_generation_plan_seals", "request_id,receipt_text,receipt_sha256", { request_id: f.f.scope.requestId }],
    ]);
  });
  it("retains expired authorization identity for delivery recovery", async () => {
    const f = fixture(); f.grantIntent.expiresAt = "2000-01-01T00:00:00Z"; f.resealGrant();
    expect((await f.load()).authorization.expiresAt).toBe("2000-01-01T00:00:00Z"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("retains an explicit one-frame retry", async () => {
    const f = fixture(); f.grantIntent.retryTaskIndex = 1; f.grantIntent.retryOfAttemptId = randomUUID(); f.grantIntent.maxAttempts = 1; f.resealGrant();
    expect((await f.load()).authorization.retryTaskIndex).toBe(1);
  });
  it.each([
    ["engagement_synthesis_generation_authorizations", "id"], ["engagement_synthesis_generation_requests", "id"],
    ["engagement_synthesis_context_requests", "request_id"], ["engagement_synthesis_generation_plans", "request_id"],
    ["engagement_synthesis_generation_plan_seals", "request_id"],
    ["engagement_synthesis_generation_requests", "source_id"], ["engagement_synthesis_generation_requests", "configuration_revision_id"],
  ])("refuses a wrong returned %s %s", async (table, field) => {
    const f = fixture(); f.options.returnedPatch = { table, patch: { [field]: randomUUID() } };
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each(["grant", "request", "context", "plan", "seal"])("refuses corrupt original %s checksums", async target => {
    const f = fixture();
    if (target === "grant") f.grant.intent_sha256 = "0".repeat(64);
    if (target === "request") f.requestRow.intent_sha256 = "0".repeat(64);
    if (target === "context") f.contextRow.context_sha256 = "0".repeat(64);
    if (target === "plan") {
      f.planRow.header_sha256 = "0".repeat(64);
      f.grantIntent.headerSha256 = f.planRow.header_sha256; f.resealGrant();
      f.sealRow.receipt_text = JSON.stringify({ ...JSON.parse(f.sealRow.receipt_text), headerSha256: f.planRow.header_sha256 });
      f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    }
    if (target === "seal") f.sealRow.receipt_sha256 = "0".repeat(64);
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each([
    ["schemaVersion", 2], ["purpose", "private_synthesis_generation_plan"], ["requestId", randomUUID()], ["actorId", randomUUID()],
    ["intentSha256", "1".repeat(64)], ["contextRequestSha256", "1".repeat(64)], ["recipeId", "wrong"], ["recipeSha256", "1".repeat(64)],
    ["continuationHeaderSha256", "1".repeat(64)], ["contentManifestSha256", "1".repeat(64)], ["contextManifestSha256", "1".repeat(64)],
    ["targetRecordId", `item:${randomUUID()}`], ["frameByteLimit", 8192], ["unexpected", true],
  ])("refuses internally hashed header drift %s", async (field, value) => {
    const f = fixture();
    expect(JSON.parse(f.planRow.header_text)[String(field)]).not.toEqual(value);
    f.changeHeader({ [String(field)]: value }); await expect(f.load()).rejects.toThrow("differs");
  });
  it.each(["requestId", "headerSha256", "frameCount", "frameBytes", "tailSha256"])("refuses rehashed seal drift %s", async field => {
    const f = fixture(), original = JSON.parse(f.sealRow.receipt_text);
    original[field] = typeof original[field] === "number" ? original[field] + 1 : field === "requestId" ? randomUUID() : "1".repeat(64);
    f.sealRow.receipt_text = JSON.stringify(original); f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    await expect(f.load()).rejects.toThrow();
  });
  it.each(["header", "allowance", "missing-retry-index", "missing-retry-attempt", "retry-index", "retry-budget"])("refuses invalid grant %s", async mode => {
    const f = fixture();
    if (mode === "header") f.grantIntent.headerSha256 = "0".repeat(64);
    if (mode === "allowance") f.grantIntent.maxAttempts = f.plan.entries.length + 1;
    if (mode.startsWith("retry") || mode === "missing-retry-index") f.grantIntent.retryOfAttemptId = randomUUID();
    if (mode.startsWith("retry") || mode === "missing-retry-attempt") f.grantIntent.retryTaskIndex = mode === "retry-index" ? f.plan.entries.length : 0;
    if (mode === "retry-index") f.grantIntent.maxAttempts = 1;
    f.resealGrant(); await expect(f.load()).rejects.toThrow("differs");
  });
  it("refuses failed reads and an already aborted request", async () => {
    const f = fixture(); f.options.failTable = "engagement_synthesis_generation_plans";
    await expect(f.load()).rejects.toThrow("unavailable");
    f.controller.abort(); f.from.mockClear(); await expect(f.load()).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled();
  });
});
