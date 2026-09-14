// @vitest-environment node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepareTranslationCredential } from "@/lib/integrations/translation-credentials";
import { translationGenerationPacketCanonical } from "@/lib/engagement/translation-generation";
import { readTranslationGenerationRequest } from "@/lib/engagement/translation-generation-read";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const live = LIVE_RLS ? describe : describe.skip;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

live("retained translation read concurrency", () => {
  let container: string, create: string;
  const actor = randomUUID(), viewer = randomUUID(), outsider = randomUUID(), custodian = randomUUID();
  const campaignId = randomUUID(), workspaceId = randomUUID(), requestId = randomUUID(), fieldId = randomUUID();
  const source = "SYNTHETIC concurrent translation read";
  const detail = `SELECT public.read_translation_generation_request('${campaignId}','${requestId}');`;
  const catalog = `SELECT public.list_translation_generation_requests('${campaignId}');`;
  const auth = (user: string = actor, role = "authenticated") => `SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub',${quote(user)},true);`;
  const args = () => ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
  function sql(statement: string) {
    const result = spawnSync("docker", args(), { input: statement, encoding: "utf8", timeout: 12_000 });
    if (result.error) throw result.error;
    return { code: result.status, out: result.stdout.trim(), error: result.stderr };
  }
  function successful(statement: string) {
    const result = sql(statement);
    expect(result.code, result.error).toBe(0);
    return result.out;
  }
  function read(statement: string, user: string = actor, role = "authenticated") {
    return sql(`BEGIN; SET LOCAL statement_timeout='3s'; ${auth(user, role)} ${statement} ROLLBACK;`);
  }
  function requireRead(statement: string) {
    const result = read(statement);
    expect(result.code, result.error).toBe(0);
    const value = JSON.parse(result.out.split("\n").find(line => line.startsWith("{"))!);
    expect(value.campaignId).toBe(campaignId);
    if (statement === detail) {
      const decoded = readTranslationGenerationRequest(value, { campaignId, workspaceId, requestId });
      expect(decoded.fields).toHaveLength(1);
      expect(decoded.fields[0]).toMatchObject({ id: fieldId, state: "cancelled", output: null });
    } else {
      expect(value.requests).toHaveLength(1);
      expect(value.requests[0]).toMatchObject({ id: requestId, counts: { cancelled: 1, queued: 0, running: 0 } });
    }
  }
  // The first transaction stays open until every competing request has returned.
  // Readiness comes from that transaction, not a guessed delay or a stale lock file.
  async function withLock(statement: string, check: () => void) {
    const child = spawn("docker", args(), { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", error = "";
    child.stdout.on("data", data => { out += data; });
    child.stderr.on("data", data => { error += data; });
    const done = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    void done.catch(() => {});
    try {
      child.stdin.write(`BEGIN; SET LOCAL statement_timeout='5s'; ${statement} SELECT 'TRANSLATION_LOCK_READY';\n`);
      await vi.waitFor(() => {
        expect(child.exitCode, error).toBeNull();
        expect(out, error).toContain("TRANSLATION_LOCK_READY");
      }, { timeout: 8_000, interval: 25 });
      check();
      expect(child.exitCode, "The lock holder ended before the competing read returned").toBeNull();
    } finally {
      if (child.exitCode === null && !child.stdin.destroyed) child.stdin.end("ROLLBACK;\n");
      expect(await done, error).toBe(0);
    }
  }

  beforeAll(() => {
    container = resolveLocalDbContainer(); requireContractVerificationStack(container);
    let credential: ReturnType<typeof prepareTranslationCredential>;
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-CONCURRENCY-SECRET-0123456789");
    try {
      credential = prepareTranslationCredential({ workspaceId, requestId, credentialId: randomUUID(), modelId: "synthetic-concurrency-model", source: "env", apiKey: "SYNTHETIC-NO-PROVIDER-CALL" });
    } finally { vi.unstubAllEnvs(); }
    const fields = [{ id: fieldId, address: { entityType: "campaign", entityId: campaignId, field: "title",
      expectedSource: { text: source, sourceLocale: null, available: true }, expectedTranslation: null },
      packetCanonical: translationGenerationPacketCanonical({ schemaVersion: 1, workspaceId, campaignId, fieldId, sourceText: source, targetLanguage: "es" }) }];
    create = `SELECT public.create_translation_generation_request('${requestId}','${actor}','${campaignId}','es',${quote(JSON.stringify(fields))},${quote(JSON.stringify(credential))},NULL);`;
    successful(`BEGIN; SET LOCAL statement_timeout='5s';
      INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@translation-concurrency.invalid' FROM unnest(ARRAY['${actor}'::uuid,'${viewer}'::uuid,'${outsider}'::uuid,'${custodian}'::uuid]) id;
      INSERT INTO public.workspaces(id,name,slug) VALUES('${workspaceId}','SYNTHETIC translation concurrency','${workspaceId}');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspaceId}','${actor}','owner'),('${workspaceId}','${viewer}','viewer'),('${workspaceId}','${custodian}','owner');
      INSERT INTO public.engagement_campaigns(id,workspace_id,title,created_by,default_content_locale) VALUES('${campaignId}','${workspaceId}',${quote(source)},'${actor}',NULL);
      SET LOCAL ROLE service_role; ${create}
      SELECT public.stop_translation_generation_field('${fieldId}',NULL,'cancelled','synthetic_read_fixture'); COMMIT;`);
    // Immutable synthetic evidence stays in the named disposable stack. No queued
    // field is ever committed, so an unrelated worker cannot dispatch this fixture.
    requireRead(detail);
  }, 30_000);

  it.each(["detail", "catalog"])("%s readers coexist with both retained reads", async kind => {
    await withLock(auth() + (kind === "detail" ? detail : catalog), () => { requireRead(detail); requireRead(catalog); });
  });
  it("a retained reader excludes generation writes until its transaction ends", async () => {
    await withLock(auth() + detail, () => {
      const result = sql(`BEGIN; SET LOCAL ROLE service_role; ${create} ROLLBACK;`);
      expect(result.code).not.toBe(0); expect(result.error).toContain("PT503");
    });
    const result = successful(`BEGIN; SET LOCAL ROLE service_role; ${create} ROLLBACK;`);
    expect(JSON.parse(result.split("\n").find(line => line.startsWith("{"))!)).toMatchObject({ requestId, created: false });
  });
  it.each(["source", "campaign", "membership"])("%s changes exclude both readers while locks are held", async kind => {
    const statement = kind === "source" ? `SELECT pg_advisory_xact_lock(hashtextextended('engagement-response:${campaignId}',0));`
      : kind === "campaign" ? `SELECT id FROM public.engagement_campaigns WHERE id='${campaignId}' FOR UPDATE;`
      : `SELECT user_id FROM public.workspace_members WHERE workspace_id='${workspaceId}' AND user_id='${actor}' FOR UPDATE;`;
    await withLock(statement, () => {
      for (const expression of [detail, catalog]) {
        const result = read(expression); expect(result.code).not.toBe(0); expect(result.error).toContain("PT503");
      }
    });
    requireRead(detail); requireRead(catalog);
  });
  it.each(["viewer", "outsider", "anonymous"])("%s cannot read either retained record", kind => {
    for (const expression of [detail, catalog]) {
      const result = read(expression, kind === "viewer" ? viewer : kind === "outsider" ? outsider : "", kind === "anonymous" ? "anon" : "authenticated");
      expect(result.code).not.toBe(0); expect(result.error).toContain("42501");
      expect(result.out).not.toContain(source); expect(result.out).not.toContain(requestId);
    }
  });
  it("revoked staff access refuses both readers without returning saved requests", () => {
    for (const expression of [detail, catalog]) {
      const result = sql(`BEGIN; UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='${actor}'; ${auth()} ${expression} ROLLBACK;`);
      expect(result.code).not.toBe(0); expect(result.error).toContain("42501"); expect(result.out).not.toContain(requestId);
    }
    requireRead(detail);
  });
  it("callers cannot invoke the private read helper with another actor", () => {
    for (const role of ["authenticated", "anon", "service_role"]) {
      expect(successful(`SELECT has_function_privilege('${role}','public.lock_translation_generation_read_scope(uuid,uuid)','EXECUTE');`)).toBe("f");
    }
  });
});
