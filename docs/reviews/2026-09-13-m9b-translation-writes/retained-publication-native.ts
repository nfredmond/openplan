import { readFileSync } from "node:fs";
import { readTranslationPublicationResult, translationPublicationIntentSchema } from "../../../openplan/src/lib/engagement/translation-publication";
import { readTranslationGenerationRequest } from "../../../openplan/src/lib/engagement/translation-generation-read";
import { loadTranslationHistory } from "../../../openplan/src/lib/engagement/translation-history-server";
async function main() {
  const { fixture, result, generation, secondGeneration, history } = JSON.parse(readFileSync(0, "utf8"));
  const retained = readTranslationGenerationRequest(generation, { campaignId: fixture.campaignId, workspaceId: fixture.workspaceId, requestId: fixture.entry.generation.requestId });
  const intent = translationPublicationIntentSchema.parse({ requestId: fixture.writeRequest, operation: "publish_generated", locale: "es", reason: "SYNTHETIC retained publication decision", entries: [fixture.entry] });
  const confirmed = readTranslationPublicationResult(result, { campaignId: fixture.campaignId, workspaceId: fixture.workspaceId, publisherId: fixture.publisher }, intent, [retained]);
  let calls = 0;
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls++;
    if (args.p_campaign !== fixture.campaignId) throw new Error("History requested a different campaign");
    let data: unknown;
    if (name === "read_engagement_translation_history") data = history;
    else if (name === "read_translation_generation_request") {
      data = [generation, secondGeneration].find(value => value.requestId === args.p_request);
      if (!data) throw new Error("History requested unrelated generation");
    } else throw new Error("Unexpected history RPC");
    const reply = Promise.resolve({ data, error: null });
    return Object.assign(reply, { abortSignal: (signal: AbortSignal) => { signal.throwIfAborted(); return reply; } });
  };
  const loaded = await loadTranslationHistory({ rpc } as never, fixture.campaignId, fixture.workspaceId);
  if (loaded.error || loaded.rows.length !== 4 || calls !== 3 || loaded.rows.some(row => row.actor_id !== fixture.publisher || (row.change?.operation === "publish_generated" && row.change.generation?.actorId !== fixture.actorId) || row.record.translated_text !== fixture.words)) {
    throw new Error("Native publication history lost exact words or provenance: " + JSON.stringify({ error: loaded.error, rows: loaded.rows.length, calls, schema: history.schema, receiptCount: history.receiptCount }));
  }
  if (loaded.rows.map(row => row.event).join(",") !== "created,corrected,accepted,removed" || loaded.rows.slice(2).some(row => row.change?.generation !== undefined)) {
    throw new Error("Native history lost publication acceptance or withdrawal custody");
  }
  process.stdout.write(JSON.stringify({ confirmedRequest: confirmed.requestId, originalGeneration: confirmed.entries[0].generation.requestId, fields: confirmed.entries.length, historyRevisions: loaded.rows.map(row => row.revision), historyRequests: loaded.rows.map(row => row.change?.requestId), rpcCalls: calls }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
