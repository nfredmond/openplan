import { createHash } from "node:crypto";
import type { DecisionResolutionScope } from "@/lib/engagement/decision-request-resolution";
import { decisionResolutionIntentSchema } from "@/lib/engagement/decision-request-resolution";

/** Synthetic absent-request receipt for browser-controller transport tests. */
export function resolutionTestPacket(scope: DecisionResolutionScope, rawIntent: unknown, replayed = false) {
  const intent = decisionResolutionIntentSchema.parse(rawIntent);
  const bound = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: scope.actorId };
  const payloadText = JSON.stringify({ schema: 1, ...bound, ...intent });
  const resultText = JSON.stringify({ schema: 1, ...bound, resolutionId: intent.resolutionId, requestId: intent.requestId,
    state: "cancelled", link: null, resolvedAt: "2026-09-13T12:00:00.000Z" });
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return { payloadText, payloadSha256: hash(payloadText), resultText, resultSha256: hash(resultText), replayed };
}
