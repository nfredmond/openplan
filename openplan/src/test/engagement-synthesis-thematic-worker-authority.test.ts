// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { synthesisThematicAuthorityFixture as fixture } from "./fixtures/engagement/synthesis-thematic-authority";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";


describe("thematic scheduler historical authority", () => {
  it("reads immutable identity without current scope or provider credentials", async () => {
    const f = await fixture(); f.options.failRpc = "read_engagement_synthesis_thematic_plan";
    const result = await f.load();
    expect(result).toMatchObject({ grant: f.grant, scope: f.f.scope, header: f.plan.header, headerText: f.plan.headerText,
      headerSha256: f.plan.headerSha256, authorization: f.grantIntent });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.trace.map(row => [row.table, row.columns, row.filters])).toEqual([
      ["engagement_synthesis_generation_authorizations", "id,request_id,intent_text,intent_sha256,credential_sha256", { id: f.args.authorizationId }],
      ["engagement_synthesis_generation_requests", "id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256,created_at", { id: f.f.scope.requestId }],
      ["engagement_synthesis_thematic_requests", "request_id,parent_request_id,thematic_text,thematic_sha256,created_at", { request_id: f.f.scope.requestId }],
      ["engagement_synthesis_thematic_input_seals", "request_id,manifest_text,manifest_sha256,receipt_text,receipt_sha256", { request_id: f.f.scope.requestId }],
      ["engagement_synthesis_generation_plans", "request_id,header_text,header_sha256", { request_id: f.f.scope.requestId }],
      ["engagement_synthesis_generation_plan_seals", "request_id,receipt_text,receipt_sha256", { request_id: f.f.scope.requestId }],
    ]);
  });
  it("retains expired authorization identity for delivery recovery", async () => {
    const f = await fixture(); f.grantIntent.expiresAt = "2000-01-01T00:00:00Z"; f.resealGrant();
    expect((await f.load()).authorization.expiresAt).toBe("2000-01-01T00:00:00Z"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("retains an explicit one-frame retry", async () => {
    const f = await fixture(); f.grantIntent.retryTaskIndex = 1; f.grantIntent.retryOfAttemptId = randomUUID(); f.grantIntent.maxAttempts = 1; f.resealGrant();
    expect((await f.load()).authorization.retryTaskIndex).toBe(1);
  });
  it.each([
    ["engagement_synthesis_generation_authorizations", "id"], ["engagement_synthesis_generation_requests", "id"],
    ["engagement_synthesis_thematic_requests", "request_id"], ["engagement_synthesis_generation_plans", "request_id"],
    ["engagement_synthesis_generation_plan_seals", "request_id"], ["engagement_synthesis_thematic_input_seals", "request_id"],
    ["engagement_synthesis_generation_requests", "source_id"], ["engagement_synthesis_generation_requests", "configuration_revision_id"],
  ])("refuses a wrong returned %s %s", async (table, field) => {
    const f = await fixture(); f.options.returnedPatch = { table, key: table === "engagement_synthesis_generation_authorizations" || table === "engagement_synthesis_generation_requests" ? "id" : "request_id", value: table === "engagement_synthesis_generation_authorizations" ? f.args.authorizationId : f.f.scope.requestId, patch: { [field]: randomUUID() } };
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each(["grant", "request", "thematic", "plan", "seal", "input-manifest", "input-seal"])("refuses corrupt original %s checksums", async target => {
    const f = await fixture();
    if (target === "grant") f.grant.intent_sha256 = "0".repeat(64);
    if (target === "request") f.requestRow.intent_sha256 = "0".repeat(64);
    if (target === "thematic") f.thematicRow.thematic_sha256 = "0".repeat(64);
    if (target === "plan") {
      f.planRow.header_sha256 = "0".repeat(64);
      f.grantIntent.headerSha256 = f.planRow.header_sha256; f.resealGrant();
      f.sealRow.receipt_text = JSON.stringify({ ...JSON.parse(f.sealRow.receipt_text), headerSha256: f.planRow.header_sha256 });
      f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    }
    if (target === "seal") f.sealRow.receipt_sha256 = "0".repeat(64);
    if (target === "input-manifest") f.resealInputCustody({ manifestSha256: "0".repeat(64) });
    if (target === "input-seal") f.resealInputCustody({ receiptSha256: "0".repeat(64) });
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each([
    ["schemaVersion", 2], ["purpose", "private_synthesis_generation_plan"], ["requestId", randomUUID()], ["actorId", randomUUID()],
    ["intentSha256", "1".repeat(64)], ["thematicRequestSha256", "1".repeat(64)], ["recipeId", "wrong"], ["recipeSha256", "1".repeat(64)],
    ["continuationHeaderSha256", "1".repeat(64)], ["contentManifestSha256", "1".repeat(64)], ["inputManifestSha256", "1".repeat(64)], ["inputSealSha256", "1".repeat(64)],
    ["campaignId", randomUUID()], ["workspaceId", randomUUID()], ["taskCount", 0], ["taskByteLimit", 8192], ["frameByteLimit", 8192], ["unexpected", true],
  ])("refuses internally hashed header drift %s", async (field, value) => {
    const f = await fixture();
    expect(JSON.parse(f.planRow.header_text)[String(field)]).not.toEqual(value);
    f.changeHeader({ [String(field)]: value });
    if(field === "contentManifestSha256") {
      // Keep downstream references consistent so only exact header reconstruction
      // can detect the unchanged continuation hash in the altered header.
      const receipt = JSON.parse(f.sealRow.receipt_text), reference = JSON.parse(receipt.proposalReferenceText);
      reference.contentManifestSha256 = value;
      reference.continuationHeaderSha256 = hash(JSON.stringify({ ...f.plan.continuation.header, contentManifestSha256: value }));
      receipt.proposalReferenceText = JSON.stringify(reference); receipt.proposalReferenceSha256 = hash(receipt.proposalReferenceText);
      f.sealRow.receipt_text = JSON.stringify(receipt); f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    }
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each(["requestId", "headerSha256", "frameCount", "taskCount", "frameBytes", "tailSha256", "proposalReferenceSha256"])("refuses rehashed seal drift %s", async field => {
    const f = await fixture(), original = JSON.parse(f.sealRow.receipt_text);
    original[field] = typeof original[field] === "number" ? original[field] + 1 : field === "requestId" ? randomUUID() : "1".repeat(64);
    f.sealRow.receipt_text = JSON.stringify(original); f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    await expect(f.load()).rejects.toThrow();
  });
  it.each(["header", "allowance", "missing-retry-index", "missing-retry-attempt", "retry-index", "retry-budget"])("refuses invalid grant %s", async mode => {
    const f = await fixture();
    if (mode === "header") f.grantIntent.headerSha256 = "0".repeat(64);
    if (mode === "allowance") f.grantIntent.maxAttempts = f.plan.header.taskCount + 1;
    if (mode.startsWith("retry") || mode === "missing-retry-index") f.grantIntent.retryOfAttemptId = randomUUID();
    if (mode.startsWith("retry") || mode === "missing-retry-attempt") f.grantIntent.retryTaskIndex = mode === "retry-index" ? f.plan.header.taskCount : 0;
    if (mode === "retry-index") f.grantIntent.maxAttempts = 1;
    f.resealGrant(); await expect(f.load()).rejects.toThrow("differs");
  });
  it("refuses failed reads and an already aborted request", async () => {
    const f = await fixture(); f.options.failTable = "engagement_synthesis_generation_plans";
    await expect(f.load()).rejects.toThrow("unavailable");
    f.controller.abort(); f.from.mockClear(); await expect(f.load()).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled();
  });
  it("retains an explicit final-proposal retry", async () => {
    const f = await fixture(); f.grantIntent.retryTaskIndex = f.plan.header.frameCount;
    f.grantIntent.retryOfAttemptId = randomUUID(); f.grantIntent.maxAttempts = 1; f.resealGrant();
    expect((await f.load()).authorization.retryTaskIndex).toBe(f.plan.header.taskCount - 1);
  });
  it.each(["schemaVersion", "purpose", "campaignId", "workspaceId", "requestId", "actorId", "intentSha256", "thematicSha256", "sourceId", "sourceSha256", "seedSha256", "unexpected"])("refuses rehashed original input manifest drift %s", async field => {
    const f = await fixture(), manifest = JSON.parse(f.inputSealRow.manifest_text);
    manifest[field] = field === "schemaVersion" ? 2 : field === "unexpected" ? true : field === "purpose" ? "wrong" : field.endsWith("Id") ? randomUUID() : "0".repeat(64);
    f.inputSealRow.manifest_text = JSON.stringify(manifest); f.resealInputCustody();
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each(["schemaVersion", "purpose", "requestId", "manifestSha256", "sealedAt", "unexpected"])("refuses rehashed original input seal drift %s", async field => {
    const f = await fixture(), receipt = JSON.parse(f.inputSealRow.receipt_text);
    receipt[field] = field === "schemaVersion" ? 2 : field === "unexpected" ? true : field === "requestId" ? randomUUID() : field === "manifestSha256" ? "0".repeat(64) : "wrong";
    f.inputSealRow.receipt_text = JSON.stringify(receipt);
    f.resealInputCustody({ preserveReceiptManifest: field === "manifestSha256" });
    await expect(f.load()).rejects.toThrow();
  });
  it.each(["schemaVersion", "purpose", "taskIndex", "inputManifestSha256", "inputSealSha256", "continuationHeaderSha256", "contentManifestSha256", "frameTailSha256", "unexpected"])("refuses rehashed final proposal reference drift %s", async field => {
    const f = await fixture(), receipt = JSON.parse(f.sealRow.receipt_text), reference = JSON.parse(receipt.proposalReferenceText);
    reference[field] = field === "schemaVersion" ? 2 : field === "unexpected" ? true : field === "taskIndex" ? reference.taskIndex + 1 : field === "purpose" ? "wrong" : "0".repeat(64);
    receipt.proposalReferenceText = JSON.stringify(reference); receipt.proposalReferenceSha256 = hash(receipt.proposalReferenceText);
    f.sealRow.receipt_text = JSON.stringify(receipt); f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    await expect(f.load()).rejects.toThrow();
  });
  it("checks the final original reference bytes independently of its declared digest", async () => {
    const f = await fixture(), receipt = JSON.parse(f.sealRow.receipt_text);
    receipt.proposalReferenceText = " " + receipt.proposalReferenceText;
    f.sealRow.receipt_text = JSON.stringify(receipt); f.sealRow.receipt_sha256 = hash(f.sealRow.receipt_text);
    await expect(f.load()).rejects.toThrow("differs");
  });
  it.each(["inputCount", "outputBytes"])("refuses empty historical input %s", async field => {
    const f = await fixture(); f.inputSealRow.manifest_text = JSON.stringify({ ...JSON.parse(f.inputSealRow.manifest_text), [field]: 0 });
    f.resealInputCustody(); await expect(f.load()).rejects.toThrow();
  });
  it("stops after an interrupted immutable identity read", async () => {
    const f = await fixture(); f.options.abortTable = "engagement_synthesis_generation_plan_seals";
    await expect(f.load()).rejects.toMatchObject({ name: "AbortError" });
  });

});
