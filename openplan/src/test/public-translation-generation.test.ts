import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const prepare = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/workspace-keys", () => ({ prepareWorkspaceTranslationSelection: prepare }));
import { TranslationCredentialError } from "@/lib/integrations/translation-credentials";
import { publicTranslationSourceHash, queuePublicTranslationGeneration, readPublicTranslationGeneration, readPublicTranslationCache, type PublicTranslationIntent } from "@/lib/engagement/public-translation-generation";

type Service = Parameters<typeof queuePublicTranslationGeneration>[0];
type Reply = { data: unknown; error: { code: string } | null };
const workspace = "11111111-1111-4111-8111-111111111111", campaign = "22222222-2222-4222-8222-222222222222";
const item = "33333333-3333-4333-8333-333333333333", request = "44444444-4444-4444-8444-444444444444", successor = "55555555-5555-4555-8555-555555555555";
const scope = { shareToken: "SYNTHETIC-public-token", itemId: item };
const snapshot = { workspaceId: workspace, campaignId: campaign, itemId: item, title: "  SYNTHETIC original title  ", body: "SYNTHETIC original body\n" };
const intent: PublicTranslationIntent = { language: "es", sourceHash: createHash("sha256").update(JSON.stringify([snapshot.title, snapshot.body])).digest("hex") };
const result = (state = "queued", requestId = request, translated: string | null = null) => ({ requestId, language: "es", state, translated });
const ok = (data: unknown): Reply => ({ data, error: null });
const handler = vi.fn<(name: string, args: Record<string, unknown>) => Reply | Promise<Reply>>();
const signals: AbortSignal[] = [];
const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: (signal: AbortSignal) => {
  signals.push(signal); return handler(name, args);
} }));
const service = { rpc } as unknown as Service;
let created: Record<string, unknown> | null;
function defaultReply(name: string, args: Record<string, unknown>): Reply {
  if (name === "read_public_translation_source") return ok(snapshot);
  if (name === "find_public_translation_request") return ok(null);
  if (name === "create_public_translation_request" || name === "retry_public_translation_request") {
    created = args; return ok({ requestId: args.p_request, created: true });
  }
  if (name === "read_public_translation_request") return ok(result("queued", String(args.p_request)));
  throw new Error(`Unexpected RPC ${name}`);
}
function override(name: string, data: unknown) {
  handler.mockImplementation((method, args) => method === name ? ok(data) : defaultReply(method, args));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); signals.length = 0; created = null; handler.mockImplementation(defaultReply);
  prepare.mockImplementation(async ({ workspaceId, requestId, credentialId, modelId }) => ({
    credential: { workspaceId, requestId, credentialId, source: "env", configuration: { provider: "anthropic", recipeVersion: 1, modelId },
      configurationHash: "a".repeat(64), credentialCiphertext: "SYNTHETIC sealed credential" }, selectedKeyCiphertextHash: null,
  }));
});

describe("public translation durable server queue", () => {
  it("captures the exact original and one credential after conclusive discovery", async () => {
    const value = await queuePublicTranslationGeneration(service, scope, intent);
    expect(value).toEqual({ ...result("queued", String(created?.p_request)), created: true });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["read_public_translation_source", "find_public_translation_request", "create_public_translation_request", "read_public_translation_request"]);
    expect(rpc.mock.calls[0][1]).toEqual({ p_share_token: scope.shareToken, p_item: item });
    expect(rpc.mock.calls[1][1]).toEqual({ p_share_token: scope.shareToken, p_item: item, p_locale: "es", p_previous: null, p_snapshot: snapshot });
    expect(created).toMatchObject({ p_share_token: scope.shareToken, p_item: item, p_locale: "es", p_snapshot: snapshot, p_selected_hash: null });
    expect(created?.p_field).not.toEqual(created?.p_request);
    expect(JSON.parse(String(created?.p_packet_canonical))).toEqual({ schemaVersion: 1, workspaceId: workspace, campaignId: campaign,
      fieldId: created?.p_field, sourceText: `${snapshot.title}\n\n${snapshot.body}`, targetLanguage: "es" });
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: workspace, requestId: created?.p_request, client: service, signal: expect.any(AbortSignal) }));
    expect(created?.p_credential).toMatchObject({ workspaceId: workspace, requestId: created?.p_request, credentialCiphertext: "SYNTHETIC sealed credential" });
    expect(signals).toHaveLength(4); expect(signals.every(signal => signal === signals[0])).toBe(true);
  });
  it("recovers retained output without selecting a replacement credential", async () => {
    override("find_public_translation_request", result("completed", request, "  SINTÉTICO conservado\n"));
    prepare.mockRejectedValue(new TranslationCredentialError("translation_credential_unavailable"));
    await expect(queuePublicTranslationGeneration(service, scope, intent)).resolves.toEqual({ ...result("completed", request, "  SINTÉTICO conservado\n"), created: false });
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it("pins the displayed snapshot in exact receipt recovery", async () => {
    await readPublicTranslationGeneration(service, scope, intent, request);
    expect(rpc.mock.calls[1]).toEqual(["read_public_translation_request", { p_request: request, p_share_token: scope.shareToken, p_item: item, p_snapshot: snapshot }]);
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it("returns a missing lookup without creating paid work", async () => {
    await expect(readPublicTranslationGeneration(service, scope, intent)).resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it("preserves null and empty title as different original identities", () => {
    expect(publicTranslationSourceHash({ title: null, body: "same" })).not.toBe(publicTranslationSourceHash({ title: "", body: "same" }));
    expect(publicTranslationSourceHash(snapshot)).toBe(intent.sourceHash);
  });
  it("refuses a changed displayed original before looking for a job", async () => {
    override("read_public_translation_source", { ...snapshot, body: "SYNTHETIC newer original" });
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(rpc).toHaveBeenCalledOnce(); expect(prepare).not.toHaveBeenCalled();
  });
  it("refuses a source from another item", async () => {
    override("read_public_translation_source", { ...snapshot, itemId: request });
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind: "unavailable" });
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([null, { ...snapshot, workspaceId: "invalid" }, { ...snapshot, secret: "unexpected" }])("refuses malformed source %j", async value => {
    override("read_public_translation_source", value);
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind: "unavailable" }); expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    { language: "nv", sourceHash: intent.sourceHash }, { language: "es", sourceHash: "unknown" },
    { ...intent, retryOf: "invalid" }, { ...intent, extra: true },
  ])("refuses invalid or unsupported intent before database access %j", async value => {
    await expect(queuePublicTranslationGeneration(service, scope, value as PublicTranslationIntent)).rejects.toMatchObject({ kind: "invalid", status: 400 });
    expect(rpc).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
  it.each(["", "short"]) ("refuses invalid share token %s", async shareToken => {
    await expect(queuePublicTranslationGeneration(service, { ...scope, shareToken }, intent)).rejects.toMatchObject({ kind: "invalid" }); expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an invalid exact request identity before database access", async () => {
    await expect(readPublicTranslationGeneration(service, scope, intent, "bad")).rejects.toMatchObject({ kind: "invalid" }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["", " ", "界".repeat(11000)])("refuses untranslatable source before selecting a credential (%#)", async body => {
    const current = { ...snapshot, title: null, body }; override("read_public_translation_source", current);
    await expect(queuePublicTranslationGeneration(service, scope, { ...intent, sourceHash: publicTranslationSourceHash(current) })).rejects.toMatchObject({ kind: "invalid" });
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it.each(["failed", "interrupted", "incomplete", "cancelled"])("creates one explicit successor for %s", async state => {
    handler.mockImplementation((name, args) => name === "read_public_translation_request" && args.p_request === request ? ok(result(state)) : defaultReply(name, args));
    await expect(queuePublicTranslationGeneration(service, scope, { ...intent, retryOf: request })).resolves.toMatchObject({ created: true });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_previous: request, p_snapshot: snapshot });
    expect(created).toMatchObject({ p_previous: request });
    expect(rpc.mock.calls.some(([name]) => name === "create_public_translation_request")).toBe(false);
  });
  it.each(["queued", "reserved", "running", "completed"])("recovers rather than retries %s", async state => {
    override("read_public_translation_request", result(state, request, state === "completed" ? "SINTÉTICO" : null));
    await expect(queuePublicTranslationGeneration(service, scope, { ...intent, retryOf: request })).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it("recovers the exact successor after retry acknowledgement loss without new credentials", async () => {
    override("find_public_translation_request", result("interrupted", successor));
    await expect(queuePublicTranslationGeneration(service, scope, { ...intent, retryOf: request })).resolves.toEqual({ ...result("interrupted", successor), created: false });
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it.each([
    { ...result(), language: "vi" }, { ...result(), state: "mystery" }, { ...result(), private: "credential" },
    result("queued", request, "SYNTHETIC incomplete"), result("completed"), result("completed", request, " "),
    result("completed", request, "a".repeat(8001)), result("completed", request, "\0"), result("completed", request, "\ud800"),
  ])("refuses an invalid retained public DTO (%#)", async value => {
    override("find_public_translation_request", value);
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind: "unavailable" }); expect(prepare).not.toHaveBeenCalled();
  });
  it("refuses an exact receipt for another request", async () => {
    override("read_public_translation_request", result("queued", successor));
    await expect(readPublicTranslationGeneration(service, scope, intent, request)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it.each([["PT409", "conflict", 409], ["42501", "forbidden", 404], ["PT429", "rate_limited", 429], ["22023", "invalid", 400], ["PT503", "unavailable", 503], ["UNKNOWN", "unavailable", 503]])("does not treat failed discovery %s as an empty queue", async (code, kind, status) => {
    handler.mockImplementation((name, args) => name === "find_public_translation_request" ? { data: null, error: { code: String(code) } } : defaultReply(name, args));
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind, status }); expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it("refuses an unverified credential without creating a request", async () => {
    prepare.mockRejectedValue(new TranslationCredentialError("translation_credential_unavailable"));
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind: "credential_unavailable" }); expect(created).toBeNull();
  });
  it("recovers a competing creator's exact retained request", async () => {
    handler.mockImplementation((name, args) => name === "create_public_translation_request" ? ok({ requestId: successor, created: false }) : defaultReply(name, args));
    await expect(queuePublicTranslationGeneration(service, scope, intent)).resolves.toEqual({ ...result("queued", successor), created: false });
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_request: successor, p_snapshot: snapshot });
  });
  it("refuses a created acknowledgement with a different identity", async () => {
    override("create_public_translation_request", { requestId: successor, created: true });
    await expect(queuePublicTranslationGeneration(service, scope, intent)).rejects.toMatchObject({ kind: "unavailable" });
    expect(rpc.mock.calls.some(([name]) => name === "read_public_translation_request")).toBe(false);
  });
  it("never returns a translation after the caller has left", async () => {
    const controller = new AbortController(), pending = deferred<Reply>();
    handler.mockImplementation((name, args) => name === "find_public_translation_request" ? pending.promise : defaultReply(name, args));
    const operation = queuePublicTranslationGeneration(service, scope, intent, controller.signal);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2)); controller.abort(); pending.resolve(ok(result("completed", request, "SINTÉTICO tardío")));
    await expect(operation).rejects.toMatchObject({ name: "AbortError" }); expect(prepare).not.toHaveBeenCalled();
  });
  it("does not create work after credential preparation is interrupted", async () => {
    const controller = new AbortController();
    prepare.mockImplementation(async () => { controller.abort(); return { credential: {}, selectedKeyCiphertextHash: null }; });
    await expect(queuePublicTranslationGeneration(service, scope, intent, controller.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(created).toBeNull();
  });
});


describe("public legacy translation cache", () => {
  it("reads a valid cache with the exact original and no credential", async () => {
    override("read_public_translation_cache", "  SINTÉTICO cache\n");
    await expect(readPublicTranslationCache(service, scope, intent)).resolves.toBe("  SINTÉTICO cache\n");
    expect(rpc.mock.calls[1]).toEqual(["read_public_translation_cache", { p_share_token: scope.shareToken, p_item: item, p_locale: "es", p_snapshot: snapshot }]);
    expect(prepare).not.toHaveBeenCalled(); expect(created).toBeNull();
  });
  it.each([null, "", " ", "a".repeat(8001), { secret: "SYNTHETIC invalid" }])("leaves invalid or absent legacy cache unused (%#)", async value => {
    override("read_public_translation_cache", value);
    await expect(readPublicTranslationCache(service, scope, intent)).resolves.toBeNull(); expect(prepare).not.toHaveBeenCalled();
  });
  it("does not call a failed cache read a cache miss", async () => {
    handler.mockImplementation((name, args) => name === "read_public_translation_cache" ? { data: null, error: { code: "PT503" } } : defaultReply(name, args));
    await expect(readPublicTranslationCache(service, scope, intent)).rejects.toMatchObject({ kind: "unavailable" }); expect(prepare).not.toHaveBeenCalled();
  });
});
