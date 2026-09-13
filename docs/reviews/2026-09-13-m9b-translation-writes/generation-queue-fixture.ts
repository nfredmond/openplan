import { randomUUID, createHash } from "node:crypto";
import { prepareTranslationCredential } from "../../../openplan/src/lib/integrations/translation-credentials";
import { encryptIntegrationKey } from "../../../openplan/src/lib/integrations/key-crypto";
import { translationGenerationPacketCanonical } from "../../../openplan/src/lib/engagement/translation-generation";

// Synthetic fixture only. Do not read deployment credentials or call a model.
process.env.OPENPLAN_INTEGRATION_KEY_SECRET = "SYNTHETIC-QUEUE-PROBE-SECRET-0123456789";
const workspaceId = randomUUID(), campaignId = randomUUID(), actorId = randomUUID(), viewerId = randomUUID(), outsiderId = randomUUID(), requestId = randomUUID();
const source = "  SYNTHETIC queue source\nKeep the final words.  ";
const keyCiphertext = encryptIntegrationKey("SYNTHETIC-QUEUE-PROVIDER-KEY");
const credential = prepareTranslationCredential({ workspaceId, requestId, credentialId: randomUUID(), modelId: "synthetic-queue-model", source: "workspace", apiKey: "SYNTHETIC-QUEUE-PROVIDER-KEY" });
const fields = ["title", "summary"].map(field => {
  const id = randomUUID();
  return { id, address: { entityType: "campaign", entityId: campaignId, field,
    expectedSource: { text: source, sourceLocale: null, available: true }, expectedTranslation: null },
    packetCanonical: translationGenerationPacketCanonical({ schemaVersion: 1, workspaceId, campaignId, fieldId: id, sourceText: source, targetLanguage: "es" }) };
});
process.stdout.write(JSON.stringify({ workspaceId, campaignId, actorId, viewerId, outsiderId, requestId, source, fields, credential, keyCiphertext,
  selectedKeyHash: createHash("sha256").update(keyCiphertext).digest("hex") }));
