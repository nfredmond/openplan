import type { DecisionLinkContext } from "./decision-links";
import { readSynthesisResponseLinkHistory } from "./synthesis-response-records-server";

/** Server and export boundaries also recompute preparation and validate every retained source member. */
export async function verifyDecisionSynthesisSources(context: DecisionLinkContext) {
  if (context.schema === 1) return;
  for (const history of context.synthesisHistory.histories) {
    await readSynthesisResponseLinkHistory(history, {
      campaignId: context.campaign.id, workspaceId: context.campaign.workspaceId,
      responseId: context.response.id, reviewId: history.reviewId, groupId: history.groupId,
    });
  }
}
