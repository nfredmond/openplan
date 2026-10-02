import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisResponseContext, SynthesisResponseLinkError } from "./synthesis-response-links-server";
import { readSynthesisResponseContext } from "./synthesis-response-context-server";
import {
  readSynthesisResponseLinkEvent, readSynthesisResponseLinkHistory, readSynthesisResponseLinkReceipt,
  synthesisResponseLinkIntentSchema, SynthesisResponseLinkConflictError, type SynthesisResponseLinkIntent, type SynthesisResponseLinkScope,
} from "./synthesis-response-records-server";

import type { SynthesisReviewEvidenceService } from "./synthesis-thematic-import-server";

type Client = Pick<SupabaseClient, "rpc">;
type Actor = { actorId: string; workspaceId: string; campaignId: string };
const addressSchema = z.object({ campaignId: z.string().uuid(), workspaceId: z.string().uuid(),
  reviewId: z.string().uuid(), responseId: z.string().uuid(), groupId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict();
const writeSchema = z.object({ intent: synthesisResponseLinkIntentSchema, contextText: z.string().nullable() }).strict();
function address(intent: SynthesisResponseLinkIntent): SynthesisResponseLinkScope {
  return { campaignId: intent.campaignId, workspaceId: intent.workspaceId, reviewId: intent.reviewId,
    responseId: intent.responseId, groupId: intent.groupId };
}
function databaseError(code: string) {
  return new SynthesisResponseLinkError(code === "42501" ? "forbidden" : code === "PT409" ? "conflict" : code === "22023" ? "invalid" : "unavailable",
    "The saved synthesis response link could not be confirmed");
}
function readFailure(error: unknown): never {
  if (error instanceof SynthesisResponseLinkError) throw error;
  if (error instanceof SynthesisResponseLinkConflictError) throw new SynthesisResponseLinkError("conflict", "This request belongs to a different response link command");
  throw new SynthesisResponseLinkError("unavailable", "The retained synthesis response records could not be verified");
}

/** Staff reads remain necessary when recovering an old request after other evidence changes. */
export async function loadSynthesisResponseLinkRequest(client: Client, rawAddress: unknown, rawRequest: unknown) {
  const parsed = addressSchema.safeParse(rawAddress), request = z.string().uuid().safeParse(rawRequest);
  if (!parsed.success || !request.success) throw new SynthesisResponseLinkError("invalid", "Select the exact saved response link request");
  try {
    const result = await client.rpc("read_engagement_synthesis_response_link", { p_campaign: parsed.data.campaignId, p_request: request.data });
    if (result.error) throw databaseError(result.error.code);
    if (result.data === null) return null;
    const event = await readSynthesisResponseLinkEvent(result.data, parsed.data);
    if (event.intent.requestId !== request.data) throw new Error("Retained response link request identity differs");
    return event;
  } catch (error) { readFailure(error); }
}

/** A missing or failed complete-history response never becomes an empty editable history. */
export async function loadSynthesisResponseLinkHistory(client: Client, rawAddress: unknown) {
  const parsed = addressSchema.safeParse(rawAddress);
  if (!parsed.success) throw new SynthesisResponseLinkError("invalid", "Select the saved review group and response");
  const scope = parsed.data;
  try {
    const result = await client.rpc("read_engagement_synthesis_response_links", { p_campaign: scope.campaignId,
      p_review: scope.reviewId, p_response: scope.responseId, p_group: scope.groupId });
    if (result.error) throw databaseError(result.error.code);
    return await readSynthesisResponseLinkHistory(result.data, scope);
  } catch (error) { readFailure(error); }
}

/** Raw packet callers preserve their submitted context bytes, including noncanonical outer JSON. */
export async function retainSynthesisResponseLink(client: Client, service: SynthesisReviewEvidenceService, actor: Actor, raw: unknown) {
  const parsed = writeSchema.safeParse(raw);
  if (!parsed.success) throw new SynthesisResponseLinkError("invalid", "Review the synthesis response link command");
  if ((parsed.data.intent.operation === "withdraw") !== (parsed.data.contextText === null)) {
    throw new SynthesisResponseLinkError("invalid", "Use the exact context for this link operation");
  }
  return retainLink(client, service, actor, parsed.data.intent, parsed.data.contextText);
}

/** Compact browser commands recover saved requests before resolving their expected context on the server. */
export async function retainSynthesisResponseLinkCommand(client: Client, service: SynthesisReviewEvidenceService, actor: Actor, raw: unknown) {
  const parsed = synthesisResponseLinkIntentSchema.safeParse(raw);
  if (!parsed.success) throw new SynthesisResponseLinkError("invalid", "Review the synthesis response link command");
  return retainLink(client, service, actor, parsed.data, parsed.data.operation === "withdraw" ? null : undefined);
}

async function retainLink(client: Client, service: SynthesisReviewEvidenceService, actor: Actor, intent: SynthesisResponseLinkIntent, contextText: string | null | undefined) {
  const scope = address(intent);
  if (intent.actorId !== actor.actorId || intent.workspaceId !== actor.workspaceId || intent.campaignId !== actor.campaignId) {
    throw new SynthesisResponseLinkError("forbidden", "Synthesis response link actor or consultation differs");
  }
  const recover = async () => {
    const old = await loadSynthesisResponseLinkRequest(client, scope, intent.requestId);
    if (!old) return null;
    if (!isDeepStrictEqual(old.intent, intent) || (contextText !== undefined && intent.operation !== "withdraw" && old.context.contextText !== contextText)) {
      throw new SynthesisResponseLinkError("conflict", "This request belongs to a different response link command");
    }
    return { event: old, replayed: true };
  };
  const old = await recover(); if (old) return old;
  const history = await loadSynthesisResponseLinkHistory(client, scope);
  if (intent.predecessorId !== (history.head?.intent.requestId ?? null) || intent.predecessorSha256 !== (history.head?.eventSha256 ?? null)) {
    const raced = await recover(); if (raced) return raced;
    throw new SynthesisResponseLinkError("conflict", "Open the current response link history before changing it");
  }
  if (intent.operation === "withdraw") {
    if (!history.head || history.head.intent.operation === "withdraw") throw new SynthesisResponseLinkError("conflict", "There is no active response link to withdraw");
  } else {
    let submitted: Awaited<ReturnType<typeof readSynthesisResponseContext>> | undefined;
    if (contextText !== undefined) {
      try {
        const { groupId, ...contextScope } = scope;
        submitted = await readSynthesisResponseContext({ contextText, contextSha256: intent.expectedContextSha256 }, contextScope);
        if (submitted.context.groupId !== groupId) throw new Error("Context differs");
      } catch { throw new SynthesisResponseLinkError("invalid", "The submitted response evidence could not be verified"); }
    }
    try {
      const current = await loadSynthesisResponseContext(client, scope, service);
      if (contextText === undefined) {
        if (current.packet.contextSha256 !== intent.expectedContextSha256) throw new SynthesisResponseLinkError("conflict", "The reviewed response evidence has changed");
        contextText = current.packet.contextText;
      } else if (!submitted || !isDeepStrictEqual(submitted.context, current.context)) {
        throw new SynthesisResponseLinkError("conflict", "The reviewed response evidence has changed");
      }
    } catch (error) {
      if (error instanceof SynthesisResponseLinkError && error.kind === "conflict") {
        const raced = await recover(); if (raced) return raced;
      }
      readFailure(error);
    }
  }
  let result: { data: unknown; error: { code: string } | null };
  try {
    result = await service.rpc("retain_engagement_synthesis_response_link", { p_campaign: actor.campaignId,
      p_actor: actor.actorId, p_workspace: actor.workspaceId, p_intent: intent, p_context_text: contextText ?? null });
  } catch {
    const raced = await recover(); if (raced) return raced;
    throw new SynthesisResponseLinkError("unavailable", "The synthesis response link save could not be confirmed");
  }
  if (result.error) {
    if (result.error.code === "PT409" || result.error.code === "PT503") { const raced = await recover(); if (raced) return raced; }
    throw databaseError(result.error.code);
  }
  try {
    const receipt = await readSynthesisResponseLinkReceipt(result.data, intent);
    const packet = { eventText: receipt.event.eventText, eventSha256: receipt.event.eventSha256 };
    await readSynthesisResponseLinkHistory({ ...scope, eventCount: history.entries.length + 1,
      headId: intent.requestId, headSha256: packet.eventSha256,
      entries: [...history.entries.map(({ eventText, eventSha256 }) => ({ eventText, eventSha256 })), packet] }, scope);
    return receipt;
  } catch (error) { readFailure(error); }
}
