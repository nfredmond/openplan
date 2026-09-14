import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadSynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { loadSynthesisReview, retainSynthesisReview } from "@/lib/engagement/synthesis-review-server";
import type { SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const campaignId = "10c5cdd7-16c6-4b91-b9c0-d2f67598a54f", workspaceId = "d51d566d-28c6-49d2-95d2-3a7a2f0902e1";
const actorId = "13466ed2-dcb7-4861-a528-68cc5579eea9", sourceId = "d0000000-0000-4000-8000-000000000002";
const reviewId = "f0000000-0000-4000-8000-000000000001", correctionId = "f0000000-0000-4000-8000-000000000002";
const literal = (value: unknown) => value === null ? "NULL" : "'" + String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''") + "'";

/** Keep one transaction open across actual TypeScript calls; even candidate schema and injected faults roll back. */
function connection() {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const process = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: process.stdout });
  let stderr = "", serial = 0;
  let pending: { marker: string; lines: string[]; resolve: (lines: string[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  process.stderr.on("data", bytes => { stderr += String(bytes); });
  lines.on("line", line => {
    if (!pending) return;
    if (line === pending.marker) { const done = pending; pending = null; clearTimeout(done.timer); done.resolve(done.lines); }
    else if (line) pending.lines.push(line);
  });
  const ended = new Promise<void>((resolve, reject) => {
    process.once("error", reject);
    process.once("close", code => {
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Native review connection ended: ${stderr}`)); pending = null; }
      if (code === 0) resolve(); else reject(new Error(`Native review connection failed: ${stderr}`));
    });
  });
  // Query failures are reported to their awaiting caller; cleanup still waits for the same process.
  void ended.catch(() => undefined);
  async function query(sql: string) {
    if (pending) throw new Error("Concurrent SQL on the native review connection");
    return new Promise<string[]>((resolve, reject) => {
      const marker = `review-join-query-${++serial}`;
      const timer = setTimeout(() => { process.kill("SIGTERM"); reject(new Error("Native review SQL timed out")); }, 40_000);
      pending = { marker, lines: [], resolve, reject, timer };
      process.stdin.write(sql + `\n\\echo ${marker}\n`);
    });
  }
  const signatures: Record<string, string[]> = {
    read_engagement_synthesis_sources: ["p_campaign", "p_request"],
    read_engagement_synthesis_review: ["p_campaign", "p_review", "p_revision"],
    retain_engagement_synthesis_review: ["p_campaign", "p_actor", "p_workspace", "p_intent", "p_source", "p_source_sha256", "p_preparation_text", "p_content_text"],
  };
  function client(role: "authenticated" | "service_role") {
    return { rpc: async (name: string, args: Record<string, unknown>) => {
      const keys = signatures[name]; if (!keys) throw new Error("Unexpected native review RPC");
      const rows = await query(`SET LOCAL ROLE ${role}; SELECT COALESCE(public.${name}(${keys.map(key => literal(args[key])).join(",")})::text,'null'); RESET ROLE;`);
      return { data: JSON.parse(rows.at(-1) ?? "null") as unknown, error: null };
    } } as unknown as Pick<SupabaseClient, "rpc">;
  }
  return { query, client, close: async () => { process.stdin.end("ROLLBACK;\n\\q\n"); await ended; lines.close(); } };
}

describe.skipIf(!LIVE_RLS)("native retained review TypeScript join", () => {
  it.each(["baseline", "harmless SQL comment", "corrupt retained command result"])("creates, corrects and reopens complete real RPC bytes: %s", async control => {
    const database = connection();
    try {
      const migration = process.env.OPENPLAN_SYNTHESIS_REVIEW_CANDIDATE === "1" ? readFileSync("supabase/migrations/20261014000027_engagement_synthesis_reviews.sql", "utf8") : "";
      await database.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${migration}\n${readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8")}\n-- ${control}\nSELECT set_config('request.jwt.claim.sub',${literal(actorId)},true);`);
      const client = database.client("authenticated"), service = database.client("service_role");
      const source = await loadSynthesisSource(client, { campaignId, workspaceId, requestId: sourceId });
      expect(source.snapshot.items.length + source.snapshot.answers.length).toBe(303);
      const create: SynthesisReviewIntent = { operation: "create", requestId: reviewId, actorId, workspaceId, sourceId, sourceSha256: source.snapshotSha256 };
      const first = await retainSynthesisReview(client, service, campaignId, create);
      expect(first).toMatchObject({ requestId: reviewId, revisionNo: 1, replayed: false });
      const original = await loadSynthesisReview(client, { campaignId, workspaceId, reviewId });
      expect(original?.content.assignedSourceCount).toBe(303);
      const notes = "SYNTHETIC full Unicode é and apostrophe ' ".repeat(80) + "NATIVE NOTE TAIL";
      const correct: SynthesisReviewIntent = { operation: "correct", requestId: correctionId, actorId, workspaceId, reviewId,
        expectedRevisionId: reviewId, expectedRevisionSha256: first.revisionSha256, reason: "SYNTHETIC complete native staff correction",
        change: { kind: "notes", title: "SYNTHETIC native reviewed title", notes } };
      if (control === "corrupt retained command result") {
        await database.query(`RESET ROLE; DO $fault$ DECLARE body text; BEGIN
          body=pg_get_functiondef('public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text)'::regprocedure);
          IF position('content:=p_content_text::jsonb;' IN body)=0 THEN RAISE EXCEPTION 'Missing native review fault seam'; END IF;
          EXECUTE replace(body,'content:=p_content_text::jsonb;', 'p_content_text:=jsonb_set(p_content_text::jsonb,''{notes}'',''"SYNTHETIC lost staff note"''::jsonb)::text; content:=p_content_text::jsonb;');
        END $fault$;`);
        await expect(retainSynthesisReview(client, service, campaignId, correct)).rejects.toThrow("Saved review receipt differs");
        await expect(loadSynthesisReview(client, { campaignId, workspaceId, reviewId })).rejects.toThrow("Saved review content differs from its command");
      } else {
        const second = await retainSynthesisReview(client, service, campaignId, correct);
        expect(second).toMatchObject({ requestId: correctionId, revisionNo: 2, replayed: false });
        const revised = await loadSynthesisReview(client, { campaignId, workspaceId, reviewId });
        expect(revised?.content.notes).toBe(notes); expect(revised?.content.assignedSourceCount).toBe(303);
        expect(revised?.revision.parentSha256).toBe(first.revisionSha256);
        expect(await retainSynthesisReview(client, service, campaignId, create)).toEqual({ ...first, replayed: true });
        expect(await retainSynthesisReview(client, service, campaignId, correct)).toEqual({ ...second, replayed: true });
      }
      const reopened = await loadSynthesisReview(client, { campaignId, workspaceId, reviewId, revisionId: reviewId });
      expect(reopened?.revision.contentText).toBe(original?.revision.contentText);
      expect(reopened?.preparationText).toBe(original?.preparationText); expect(reopened?.source.snapshotText).toBe(source.snapshotText);
    } finally { await database.close(); }
  }, 60_000);
});
