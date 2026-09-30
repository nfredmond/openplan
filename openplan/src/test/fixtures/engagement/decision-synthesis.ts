import { createHash } from "node:crypto";
import native from "../decision-link-native.json";
import { chain, history, scope } from "./synthesis-response-link";
import type { DecisionLinkContext } from "@/lib/engagement/decision-links";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const address = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, responseId: scope.responseId, decisionId: native.initial.entries[0].decision_id };
export function makeContext() {
  const values = chain(), retained = values.revised.responseHistory;
  const context = JSON.parse(native.initial.entries[0].context_text);
  context.schema = 2; context.campaign.id = scope.campaignId; context.campaign.workspaceId = scope.workspaceId;
  context.project.workspaceId = scope.workspaceId; context.relationship.workspace_id = scope.workspaceId; context.relationship.campaign_id = scope.campaignId;
  context.response = JSON.parse(retained.recordText);
  context.responseHistory = { id: retained.id, revision: retained.revision, event: retained.event,
    actorId: retained.actor_id, recordedAt: retained.recorded_at, recordText: retained.recordText, recordSha256: retained.record_sha256 };
  context.sources = []; context.sourceCount = 0; context.configurations = []; context.configurationCount = 0;
  context.synthesisHistory = { observation: "retained_at_link_preview", historyCount: 1, eventCount: 3,
    histories: [history([values.first, values.second, values.third])] };
  return context as Extract<DecisionLinkContext, { schema: 2 }>;
}
export const packet = (context: DecisionLinkContext) => { const contextText = JSON.stringify(context); return { contextText, contextSha256: hash(contextText) }; };
export function row(context = makeContext()) {
  const saved = structuredClone(native.initial.entries[0]), text = packet(context);
  saved.campaign_id = address.campaignId; saved.workspace_id = address.workspaceId; saved.response_id = address.responseId;
  saved.context_text = text.contextText; saved.context_sha256 = text.contextSha256;
  saved.payload_json.campaignId = address.campaignId; saved.payload_json.responseId = address.responseId; saved.payload_json.expectedContextSha256 = text.contextSha256;
  saved.payload_text = JSON.stringify(saved.payload_json); saved.payload_sha256 = hash(saved.payload_text);
  return saved;
}

/** Keep review wording, approval binding and every event/predecessor checksum consistent. */
export function withReviewWords(context = makeContext()) {
  for (const history of context.synthesisHistory.histories) {
    let previous: string | null = null;
    for (const packet of history.entries) {
      const event = JSON.parse(packet.eventText), retained = JSON.parse(event.context.contextText);
      const content = JSON.parse(retained.revision.contentText);
      content.groups[0].summary = "SYNTHETIC retained staff interpretation of the issue";
      content.notes = "SYNTHETIC retained review notes and unresolved concern";
      retained.revision.contentText = JSON.stringify(content); retained.revision.contentSha256 = hash(retained.revision.contentText);
      const approval = JSON.parse(retained.approval.eventText); approval.intent.revisionSha256 = retained.revision.contentSha256;
      retained.approval.eventText = JSON.stringify(approval); retained.approval.eventSha256 = hash(retained.approval.eventText);
      event.context.contextText = JSON.stringify(retained); event.context.contextSha256 = hash(event.context.contextText);
      if (event.intent.operation !== "withdraw") event.intent.expectedContextSha256 = event.context.contextSha256;
      event.intent.predecessorSha256 = previous;
      packet.eventText = JSON.stringify(event); packet.eventSha256 = hash(packet.eventText); previous = packet.eventSha256;
    }
    history.headSha256 = previous!;
  }
  return context;
}
