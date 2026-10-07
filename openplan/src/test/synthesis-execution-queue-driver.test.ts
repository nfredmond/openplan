// @vitest-environment node
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const schedules = vi.hoisted(() => ({ segment: vi.fn(), context: vi.fn(), thematic: vi.fn() }));
vi.mock("../lib/engagement/synthesis-generation-scheduler", () => ({ runSynthesisGenerationSchedule: schedules.segment }));
vi.mock("../lib/engagement/synthesis-context-scheduler", () => ({ runSynthesisContextSchedule: schedules.context }));
vi.mock("../lib/engagement/synthesis-thematic-scheduler", () => ({ runSynthesisThematicSchedule: schedules.thematic }));
import { runQueuedSynthesisSchedule } from "../lib/engagement/synthesis-execution-queue-driver";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture(stage = "segment") {
  const intent_text = JSON.stringify({ sourceId: id(7), sourceSha256: "a".repeat(64) });
  const grant = { id: id(2), request_id: id(3), intent_text: "{}", intent_sha256: hash("{}") };
  const request = { id: id(3), campaign_id: id(4), workspace_id: id(5), actor_id: id(6), source_id: id(7), intent_text, intent_sha256: hash(intent_text) };
  const command = { schemaVersion: 1, queueId: id(1), authorizationId: grant.id, authorizationIntentSha256: grant.intent_sha256,
    requestId: request.id, campaignId: request.campaign_id, workspaceId: request.workspace_id, actorId: request.actor_id,
    sourceId: request.source_id, sourceSha256: "a".repeat(64), requestIntentSha256: request.intent_sha256, stage };
  const commandText = JSON.stringify(command);
  const receipt = { schemaVersion: 1, queueId: command.queueId, commandText, commandSha256: hash(commandText), createdAt: "2026-10-07T23:00:00Z" };
  const calls: Array<[string, string]> = [];
  const from = vi.fn((table: string) => ({ select: (projection: string) => {
    calls.push([table, projection]); return { eq: (_key: string, _value: string) => ({ abortSignal: (_signal: AbortSignal) => ({ single: async () => ({ data: table.endsWith("authorizations") ? grant : request, error: null }) }) }) };
  } }));
  return { grant, request, calls, args: { service: { from } as unknown as Pick<SupabaseClient, "from" | "rpc">,
    target: "http://127.0.0.1:29821", root: "/synthetic/worker", receipt, commandText, signal: new AbortController().signal } };
}
beforeEach(() => { for (const fn of Object.values(schedules)) fn.mockReset().mockResolvedValue({ state: "grant_drained" }); });
describe("queue to retained scheduler binding", () => {
  it.each(["segment", "context", "thematic"] as const)("uses canonical CLI directories for %s", async stage => {
    const f = fixture(stage); await runQueuedSynthesisSchedule(f.args);
    expect(schedules[stage]).toHaveBeenCalledExactlyOnceWith({ service: f.args.service, target: f.args.target,
      authorizationId: f.grant.id, directory: join(f.args.root, hash(f.args.target), f.grant.id), signal: f.args.signal });
    expect(Object.values(schedules).reduce((n, fn) => n + fn.mock.calls.length, 0)).toBe(1);
    expect(f.calls).toEqual([["engagement_synthesis_generation_authorizations", "id,request_id,intent_text,intent_sha256"],
      ["engagement_synthesis_generation_requests", "id,campaign_id,workspace_id,actor_id,source_id,intent_text,intent_sha256"]]);
  });
  it.each(["id", "campaign_id", "workspace_id", "actor_id", "source_id", "intent_sha256"] as const)("refuses changed request %s", async field => {
    const f = fixture(); f.request[field] = field === "intent_sha256" ? "f".repeat(64) : id(99);
    await expect(runQueuedSynthesisSchedule(f.args)).rejects.toThrow("differs"); expect(schedules.segment).not.toHaveBeenCalled();
  });
  it("refuses changed authorization bytes before scheduling", async () => {
    const f = fixture(); f.grant.intent_text = "{ }";
    await expect(runQueuedSynthesisSchedule(f.args)).rejects.toThrow("differs"); expect(schedules.segment).not.toHaveBeenCalled();
  });
});
