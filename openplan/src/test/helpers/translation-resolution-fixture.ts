import { createHash } from "node:crypto";
import type { GenerationEditorScope } from "@/lib/engagement/translation-generation-editor";
import { translationGenerationResolutionIntentSchema } from "@/lib/engagement/translation-generation-resolution";

/** Synthetic absent-request receipt for browser-controller transport tests. */
export function resolutionTestPacket(scope: GenerationEditorScope, rawIntent: unknown, replayed = false) {
  const intent = translationGenerationResolutionIntentSchema.parse(rawIntent);
  const bound = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: scope.userId };
  const payloadText = JSON.stringify({ schema: 1, ...bound, ...intent });
  const resultText = JSON.stringify({ schema: 1, ...bound, resolutionId: intent.resolutionId, requestId: intent.requestId,
    requestExisted: false, fields: [], resolvedAt: "2026-09-13T12:00:00.000Z" });
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return { payloadText, payloadSha256: hash(payloadText), resultText, resultSha256: hash(resultText), replayed };
}
