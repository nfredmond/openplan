import { readFileSync } from "node:fs";
import { readTranslationPublicationResult, translationPublicationIntentSchema } from "../../../openplan/src/lib/engagement/translation-publication";
import { readTranslationGenerationRequest } from "../../../openplan/src/lib/engagement/translation-generation-read";
const { fixture, result, generation } = JSON.parse(readFileSync(0, "utf8"));
const retained = readTranslationGenerationRequest(generation, { campaignId: fixture.campaignId, workspaceId: fixture.workspaceId, requestId: fixture.entry.generation.requestId });
const intent = translationPublicationIntentSchema.parse({ requestId: fixture.writeRequest, operation: "publish_generated", locale: "es", reason: "SYNTHETIC retained publication decision", entries: [fixture.entry] });
const confirmed = readTranslationPublicationResult(result, { campaignId: fixture.campaignId, workspaceId: fixture.workspaceId, publisherId: fixture.publisher }, intent, [retained]);
process.stdout.write(JSON.stringify({ confirmedRequest: confirmed.requestId, originalGeneration: confirmed.entries[0].generation.requestId, fields: confirmed.entries.length }));
