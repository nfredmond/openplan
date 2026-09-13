import { createHash, randomUUID } from "node:crypto";
import { z } from "../../../openplan/node_modules/zod";
import { translationCredentialSchema } from "../../../openplan/src/lib/integrations/translation-credentials";
import { readFileSync } from "node:fs";
import { translationGenerationBindingSchema } from "../../../openplan/src/lib/engagement/translation-generation";
import { encodeTranslationGenerationDelivery, decodeTranslationGenerationDelivery } from "../../../openplan/src/lib/engagement/translation-generation-delivery";

// Extend the existing synthetic queue fixture with actual codec output. Attempt
// placeholders are replaced by the SQL probe's claimed ids/deadline before use.
const raw: unknown = JSON.parse(readFileSync(0, "utf8"));
if (process.argv[2] === "--roundtrip") {
  process.stdout.write(JSON.stringify(encodeTranslationGenerationDelivery(decodeTranslationGenerationDelivery(raw))));
} else {
const f = z.object({
  workspaceId: z.string().uuid(), campaignId: z.string().uuid(), requestId: z.string().uuid(), source: z.string(),
  fields: z.array(z.object({ id: z.string().uuid(), packetCanonical: z.string() }).passthrough()).min(1),
  credential: translationCredentialSchema, binding: translationGenerationBindingSchema.optional(),
}).passthrough().parse(raw);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const deliveries = ["  SYNTHETIC complete output.  ", "nul\0words", "unpaired\ud800words", "😀".repeat(8001)].map((output, index) => {
  const value = { status: index === 0 ? "completed" : "incomplete", output, receipt: {
    schemaVersion: 1, provider: "anthropic", ...(f.binding ?? {
      workspaceId: f.workspaceId, campaignId: f.campaignId, requestId: f.requestId,
      fieldId: f.fields[0].id, attemptId: randomUUID(), reservationId: randomUUID(), credentialId: f.credential.credentialId,
      configurationHash: f.credential.configurationHash, packetHash: hash(f.fields[0].packetCanonical), leaseExpiresAt: "2099-01-01T00:00:00Z",
    }),
    model: f.credential.configuration.modelId, credentialSource: f.credential.source, recipeVersion: 1, targetLanguage: "es",
    sourceHash: hash(f.source), outputHash: hash(output), finishReason: "stop", responseId: "SYNTHETIC\0receipt", reportedModel: "SYNTHETIC\ud800model",
    inputTokens: null, outputTokens: 7,
  } };
  const encoded = encodeTranslationGenerationDelivery(value);
  if (decodeTranslationGenerationDelivery(encoded).output !== output) throw new Error("Synthetic codec fixture lost words");
  return encoded;
});
process.stdout.write(JSON.stringify({ ...f, deliveries }));

}
