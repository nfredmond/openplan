// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepareTranslationCredential } from "@/lib/integrations/translation-credentials";
import { translationGenerationPacketCanonical } from "@/lib/engagement/translation-generation";
import { encodeTranslationGenerationDelivery } from "@/lib/engagement/translation-generation-delivery";
import { verifyTranslationGenerationResolution } from "@/lib/engagement/translation-generation-resolution-server";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const live = LIVE_RLS ? describe : describe.skip;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const candidate = process.env.OPENPLAN_TRANSLATION_RESOLUTION_CANDIDATE === "1";

live("durable translation resolution in PostgreSQL", () => {
  let container: string, migration: string, seed: string, create: string, running: string, deliver: string;
  const actorId = randomUUID(), staff = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  const campaignId = randomUUID(), workspaceId = randomUUID(), requestId = randomUUID(), fieldId = randomUUID();
  const attemptId = randomUUID(), reservationId = randomUUID();
  const source = "SYNTHETIC resolution source", output = "SYNTHETIC retained output";
  const scope = { campaignId, workspaceId, actorId };
  const intent = { resolutionId: randomUUID(), requestId, copyJson: JSON.stringify("damaged \0 \ud800 browser's copy"), reason: "Resolve this synthetic interrupted request" };
  const auth = (user: string = actorId, role = "authenticated") => `RESET ROLE; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub',${quote(user)},true);`;
  const resolve = (change: Partial<typeof intent> = {}) => {
    const value = { ...intent, ...change };
    return `SELECT public.resolve_translation_generation_request('${value.resolutionId}','${value.requestId}','${campaignId}',${quote(value.copyJson)},${quote(value.reason)});`;
  };
  function run(statements: string) {
    // Every fixture and candidate DDL rolls back on success or connection exit.
    // No queued fixture or candidate migration is committed to the shared stack.
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
      input: `BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1s';\n${migration}\n${seed}\n${statements}\nROLLBACK;`, encoding: "utf8", timeout: 15000,
    });
    if (result.error) throw result.error;
    return { code: result.status, out: result.stdout.trim(), error: result.stderr };
  }
  function success(statements: string) {
    const result = run(statements);
    expect(result.code, result.error).toBe(0);
    return result.out.split("\n").filter(line => line.startsWith("{" )).map(line => JSON.parse(line));
  }
  function refused(statements: string, code: string, message: string) {
    const result = run(statements);
    expect(result.code).not.toBe(0);
    expect(result.error).toContain(code);
    expect(result.error).toContain(message);
  }
  const snapshot = `RESET ROLE; SELECT json_build_object('intent',r.intent,'state',f.state,'output',(SELECT row_to_json(o) FROM public.engagement_translation_generation_outputs o WHERE o.field_id=f.id)) FROM public.engagement_translation_generation_requests r JOIN public.engagement_translation_generation_fields f ON f.request_id=r.id WHERE r.id='${requestId}';`;
  beforeAll(() => {
    container = resolveLocalDbContainer(); requireContractVerificationStack(container);
    migration = candidate ? readFileSync("supabase/migrations/20261014000019_engagement_translation_generation_resolution.sql", "utf8") : "";
    let credential: ReturnType<typeof prepareTranslationCredential>;
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-RESOLUTION-SECRET-0123456789");
    try { credential = prepareTranslationCredential({ workspaceId, requestId, credentialId: randomUUID(), modelId: "synthetic-resolution-model", source: "env", apiKey: "SYNTHETIC-NO-PROVIDER-CALL" }); }
    finally { vi.unstubAllEnvs(); }
    const packetCanonical = translationGenerationPacketCanonical({ schemaVersion: 1, workspaceId, campaignId, fieldId, sourceText: source, targetLanguage: "es" });
    const fields = [{ id: fieldId, address: { entityType: "campaign", entityId: campaignId, field: "title", expectedSource: { text: source, sourceLocale: null, available: true }, expectedTranslation: null }, packetCanonical }];
    seed = `INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@resolution.invalid' FROM unnest(ARRAY['${actorId}'::uuid,'${staff}'::uuid,'${viewer}'::uuid,'${outsider}'::uuid]) id;
      INSERT INTO public.workspaces(id,name,slug) VALUES('${workspaceId}','SYNTHETIC resolution','${workspaceId}');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspaceId}','${actorId}','owner'),('${workspaceId}','${staff}','owner'),('${workspaceId}','${viewer}','viewer');
      INSERT INTO public.engagement_campaigns(id,workspace_id,title,created_by,default_content_locale) VALUES('${campaignId}','${workspaceId}',${quote(source)},'${actorId}',NULL);`;
    create = `RESET ROLE; SET LOCAL ROLE service_role; SELECT public.create_translation_generation_request('${requestId}','${actorId}','${campaignId}','es',${quote(JSON.stringify(fields))},${quote(JSON.stringify(credential))},NULL);`;
    const leaseExpiresAt = new Date(Date.now() + 86400000).toISOString();
    // A deterministic synthetic reservation lets the actual dispatch/output RPCs
    // exercise custody without invoking a provider or publishing a queued field.
    running = `RESET ROLE; UPDATE public.engagement_translation_generation_fields SET state='reserved',attempt_id='${attemptId}',reservation_id='${reservationId}',reserved_at=clock_timestamp(),lease_expires_at='${leaseExpiresAt}' WHERE id='${fieldId}'; SET LOCAL ROLE service_role; SELECT public.authorize_translation_generation_dispatch('${fieldId}','${attemptId}','${reservationId}');`;
    const delivery = encodeTranslationGenerationDelivery({ status: "completed", output, receipt: { schemaVersion: 1, provider: "anthropic", workspaceId, campaignId, requestId, fieldId, attemptId, reservationId, leaseExpiresAt,
      credentialId: credential.credentialId, configurationHash: credential.configurationHash, packetHash: hash(packetCanonical), model: "synthetic-resolution-model", credentialSource: "env", recipeVersion: 1,
      targetLanguage: "es", sourceHash: hash(source), outputHash: hash(output), finishReason: "stop", inputTokens: null, outputTokens: null, responseId: "synthetic\0response", reportedModel: "synthetic\ud800model" } });
    deliver = `RESET ROLE; SET LOCAL ROLE service_role; SELECT public.retain_translation_generation_output('${fieldId}','${attemptId}','completed',${quote(delivery.outputJson)},${quote(delivery.bindingCanonical)},${quote(delivery.providerMetadataJson)},'${delivery.digest}');`;
  });

  it("retains exact damaged bytes and replays the original receipt", () => {
    const packets = success(auth() + resolve() + resolve());
    const first = verifyTranslationGenerationResolution(packets[0], scope, intent);
    expect(first.result).toMatchObject({ requestExisted: false, fields: [] });
    expect(JSON.parse(first.payload.copyJson)).toBe("damaged \0 \ud800 browser's copy");
    expect(packets[1]).toEqual({ ...packets[0], replayed: true });
  });
  it("preserves two distinct copies without rewriting the first", () => {
    const second = { resolutionId: randomUUID(), copyJson: JSON.stringify("different damaged copy") };
    const packets = success(auth() + resolve() + resolve(second) + resolve());
    expect(verifyTranslationGenerationResolution(packets[1], scope, { ...intent, ...second }).payload.copyJson).toBe(second.copyJson);
    expect(packets[2]).toEqual({ ...packets[0], replayed: true });
  });
  it("refuses a different payload for the same resolution identity", () => {
    refused(auth() + resolve() + resolve({ copyJson: JSON.stringify("different") }), "PT409", "Resolution retry differs");
  });
  it("refuses a late create after resolving an absent request", () => {
    refused(auth() + resolve() + create, "PT409", "Generation request was resolved");
  });
  it("cancels queued work and refuses its original creation replay", () => {
    const packets = success(create + auth() + resolve() + snapshot);
    expect(verifyTranslationGenerationResolution(packets[1], scope, intent).result.fields).toEqual([{ fieldId, previousState: "queued", state: "cancelled", attemptId: null, outputRetained: false }]);
    expect(packets[2]).toMatchObject({ state: "cancelled", output: null });
    refused(create + auth() + resolve() + create, "PT409", "Generation request was resolved");
  });
  it("cancels reserved work before dispatch and preserves its attempt identity", () => {
    const reservation = running.slice(0, running.indexOf("SET LOCAL ROLE service_role;"));
    const dispatch = running.slice(running.indexOf("SET LOCAL ROLE service_role;"));
    const packets = success(create + reservation + auth() + resolve() + "RESET ROLE;" + dispatch);
    const receipt = verifyTranslationGenerationResolution(packets.find(value => value.payloadText), scope, intent);
    expect(receipt.result.fields).toEqual([{ fieldId, previousState: "reserved", state: "cancelled", attemptId, outputRetained: false }]);
    expect(packets.at(-1)).toMatchObject({ state: "cancelled", attemptId, reservationId });
  });
  it("does not let an absent resolution block another actor's request identity", () => {
    const otherCreate = create.replaceAll(actorId, staff);
    const packets = success(auth() + resolve() + otherCreate);
    expect(packets.at(-1)).toEqual({ requestId, created: true });
  });
  it("refuses an incomplete field inventory instead of confirming resolution", () => {
    refused(create + `RESET ROLE; ALTER TABLE public.engagement_translation_generation_fields DISABLE TRIGGER translation_generation_field_immutable;
      DELETE FROM public.engagement_translation_generation_fields WHERE id='${fieldId}';
      ALTER TABLE public.engagement_translation_generation_fields ENABLE TRIGGER translation_generation_field_immutable;` + auth() + resolve(), "PT503", "Resolution fields are incomplete");
  });
  it("interrupts dispatched work and retains late output without reviving it", () => {
    const packets = success(create + running + auth() + resolve() + deliver + snapshot + auth() + resolve());
    const receipt = packets.find(value => value.payloadText);
    expect(verifyTranslationGenerationResolution(receipt, scope, intent).result.fields).toEqual([{ fieldId, previousState: "running", state: "interrupted", attemptId, outputRetained: false }]);
    const saved = packets.find(value => value.intent);
    expect(saved).toMatchObject({ state: "interrupted", output: { accepted_state: "interrupted", output_json: JSON.stringify(output) } });
    expect(packets.at(-1)).toEqual({ ...receipt, replayed: true });
  });
  it("preserves completed output and the original request exactly", () => {
    const packets = success(create + running + deliver + snapshot + auth() + resolve() + snapshot);
    const snapshots = packets.filter(value => value.intent);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual(snapshots[0]);
    const receipt = verifyTranslationGenerationResolution(packets.find(value => value.payloadText), scope, intent);
    expect(receipt.result.fields).toEqual([{ fieldId, previousState: "completed", state: "completed", attemptId, outputRetained: true }]);
  });
  it.each(["staff", "viewer", "outsider", "anonymous"])("refuses %s resolution of another actor's request", kind => {
    const user = { staff, viewer, outsider, anonymous: "" }[kind]!;
    refused(create + auth(user, kind === "anonymous" ? "anon" : "authenticated") + resolve(), "42501", kind === "staff" ? "Only the original requester" : kind === "anonymous" ? "permission denied" : "Staff campaign access required");
  });
  it("hides receipt bytes from other staff and revoked original staff", () => {
    const count = `SELECT json_build_object('count',count(*)) FROM public.engagement_translation_generation_resolutions;`;
    const packets = success(auth() + resolve() + count + auth(staff) + count + `RESET ROLE; UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='${actorId}';` + auth() + count);
    expect(packets.slice(1)).toEqual([{ count: 1 }, { count: 0 }, { count: 0 }]);
  });
  it("exposes only resolution metadata to the service role", () => {
    const packets = success(auth() + resolve() + `RESET ROLE; SET LOCAL ROLE service_role; SELECT json_build_object('requestId',request_id) FROM public.engagement_translation_generation_resolutions WHERE request_id='${requestId}' AND actor_id='${actorId}';`);
    expect(packets[1]).toEqual({ requestId });
    refused(auth() + resolve() + `RESET ROLE; SET LOCAL ROLE service_role; SELECT payload_json FROM public.engagement_translation_generation_resolutions;`, "42501", "permission denied");
  });
  it("refuses direct receipt mutation even for the database owner", () => {
    refused(auth() + resolve() + `RESET ROLE; UPDATE public.engagement_translation_generation_resolutions SET request_id='${randomUUID()}';`, "23514", "Generation requests are retained unchanged");
  });
  it("refuses a claimed completed field without retained output", () => {
    refused(create + running + `RESET ROLE; UPDATE public.engagement_translation_generation_fields SET state='completed',finished_at=clock_timestamp() WHERE id='${fieldId}';` + auth() + resolve(), "PT503", "Retained generation output is incomplete");
  });
  it.each(["null", "{}", '"bad\\q"'])("refuses invalid copy encoding %s", copyJson => {
    refused(auth() + resolve({ copyJson }), "22023", "Invalid");
  });
});
