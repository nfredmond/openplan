import { z } from "zod";
import type { DecisionLinkContext } from "./decision-links";
import { synthesisResponseLinkEventSchema } from "./synthesis-response-link";
import { responseLinkContextPreviewSchema } from "./synthesis-response-link-reader";
import { synthesisReviewContentSchema } from "./synthesis-review";
import { synthesisApprovalIntentSchema } from "./synthesis-approval";
import { synthesisSourceSnapshotSchema } from "./synthesis-sources";
import { closeLoopEntrySchema } from "./close-loop";

export const decisionSynthesisLegacyNotice = "This earlier decision packet did not capture synthesis history. This is missing evidence, not a count of zero.";
export const decisionSynthesisEmptyNotice = "No synthesis response links were recorded when this decision evidence was captured.";
export const decisionSynthesisAuthorityNotice = "These are retained versions from each response-link action. Recorded approval does not establish current approval, publication, decision adoption or representative support.";
const sourcePacket = z.object({ snapshotText: z.string() }).passthrough();
const approvalPacket = z.object({ createdAt: z.string(), intent: synthesisApprovalIntentSchema }).passthrough();

/** Present an already verified context. Authenticated readers and export parsing own checksum and custody checks. */
export function decisionSynthesisDetails(context: DecisionLinkContext) {
  if (context.schema === 1) return null;
  return context.synthesisHistory.histories.map(history => ({
    reviewId: history.reviewId, groupId: history.groupId,
    events: history.entries.map(packet => {
      const event = synthesisResponseLinkEventSchema.parse(JSON.parse(packet.eventText));
      const retained = responseLinkContextPreviewSchema.parse(JSON.parse(event.context.contextText));
      const content = synthesisReviewContentSchema.parse(JSON.parse(retained.revision.contentText));
      const group = content.groups.find(row => row.id === history.groupId);
      if (!group) throw new Error("Retained decision synthesis group is unavailable");
      const source = synthesisSourceSnapshotSchema.parse(JSON.parse(sourcePacket.parse(retained.source).snapshotText));
      const approval = approvalPacket.parse(JSON.parse(retained.approval.eventText));
      const response = closeLoopEntrySchema.parse(JSON.parse(retained.responseHistory.recordText));
      const members = group.sourceIds.map(key => {
        const [kind, id] = key.split(":");
        const record = kind === "item" ? source.items.find(row => row.id === id) : source.answers.find(row => row.id === id);
        if (!record) throw new Error("Retained decision synthesis member is unavailable");
        const answer = kind === "answer" ? source.answers.find(row => row.id === id)! : null;
        const item = kind === "item" ? source.items.find(row => row.id === id)! : null;
        const session = answer ? source.sessions.find(row => row.id === answer.session_id) : null;
        if (answer && !session) throw new Error("Retained decision synthesis session is unavailable");
        const configurationId = item?.configuration_version_id ?? session?.configuration_version_id ?? null;
        const definition = source.definitions.find(row => row.id === configurationId) ?? null;
        return { key, kind, id, record, session: session ?? null, definition, configurationId,
          configurationAvailability: configurationId === null ? "unknown" : definition ? "available" : "unavailable",
          title: item ? item.title ?? "Untitled contribution" : answer!.question_prompt_snapshot ?? "Retained question wording unavailable",
          text: item ? item.body : [answer!.answer_text, Object.keys(answer!.answer_json).length ? JSON.stringify(answer!.answer_json) : null].filter(value => value !== null).join("\n") };
      });
      return { ...packet, ...event, retained, content, group, source, approval, response, members };
    }),
  }));
}
export type DecisionSynthesisDetails = NonNullable<ReturnType<typeof decisionSynthesisDetails>>;
