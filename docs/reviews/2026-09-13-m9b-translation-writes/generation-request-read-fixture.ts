import { readFileSync } from "node:fs";
import { readTranslationGenerationRequest } from "../../../openplan/src/lib/engagement/translation-generation-read";
const raw = JSON.parse(readFileSync(0, "utf8"));
const result = readTranslationGenerationRequest(raw, { requestId: raw.requestId, campaignId: raw.campaignId, workspaceId: raw.workspaceId });
process.stdout.write(JSON.stringify({ requestId: result.requestId, fields: result.fields.map(field => ({ id: field.id, state: field.state,
  hasOutput: field.output !== null, deliveryDigest: field.output?.deliveryDigest ?? null })) }));
