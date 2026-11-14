import type { VerifiedDecisionLink } from "./decision-links";
import { decisionSynthesisDetails, decisionSynthesisLegacyNotice, decisionSynthesisEmptyNotice, decisionSynthesisAuthorityNotice, type DecisionSynthesisDetails } from "./decision-synthesis-display";
import { reviewTime, reviewWord, type RecordIdentifiers } from "./review-pdf-words";

type Cell = string | number;
type ExportRow = Record<string, Cell>;
type Member = DecisionSynthesisDetails[number]["events"][number]["members"][number];
/** How the review PDF prints a retained value: escaped text, numbered names and the identifier appendix. */
type ReportWords = {
  escape: (value: unknown) => string;
  narrative: (value: unknown, label: string) => string;
  /** "Contribution 4", or a phrase for a contribution outside this file's selection. */
  contribution: (itemId: string) => string;
  /** "Survey answer 2", or a phrase for an answer outside this file's selection. */
  answer: (answerId: string) => string;
  /** "staff member 1": actors are numbered and their ids listed in the appendix. */
  staff: (actorId: unknown) => string;
  identifiers: RecordIdentifiers;
};

/** Printed beside every staff group, so a theme of a few comments is not read as what the public thinks. */
export const decisionSynthesisGroupCountCaveat = "Counts are records, not people. A staff group shows what these contributors wrote; it does not measure public opinion or show representative support.";

/** A retained survey answer's words. Its structured value stays in the workbook and snapshot, never as JSON in the PDF. */
function memberWords(member: Member): string {
  if (member.kind === "item") return member.text;
  const answer = member.record as { answer_text?: unknown };
  return typeof answer.answer_text === "string" && answer.answer_text.trim()
    ? answer.answer_text
    : "Structured answer. Its exact value is in the workbook and portable snapshot.";
}

/**
 * Source words appear once in a numbered appendix; each retained action lists
 * its exact reviewed membership by number. Identifiers and hashes go to the
 * report's "Record identifiers" appendix under the same numbers.
 */
export function decisionSynthesisReport(rows: VerifiedDecisionLink[], { escape, narrative, contribution, answer, staff, identifiers }: ReportWords) {
  const sources = new Map<string, { anchor: string; number: number; member: Member; sourceId: string; sourceSha256: string; capturedAt: string }>();
  const sections = new Map<string, string>();
  const memberName = (member: Member) => member.kind === "item" ? contribution(member.id) : answer(member.id);
  rows.forEach((row, rowIndex) => {
    const action = `Decision action ${rowIndex + 1}`;
    const histories = decisionSynthesisDetails(row.context);
    let html = `<h4>Retained synthesis evidence</h4>`;
    if (histories === null) html += `<p>${decisionSynthesisLegacyNotice}</p>`;
    else if (!histories.length) html += `<p>${decisionSynthesisEmptyNotice}</p>`;
    else {
      html += `<p>${histories.length} review-group histories, ${histories.reduce((sum, history) => sum + history.events.length, 0)} saved response-link actions. ${decisionSynthesisAuthorityNotice}</p>`;
      for (const history of histories) for (const event of history.events) {
        const linkAction = `${action}, response-link action ${event.eventNo}`;
        identifiers.add("Decision history", linkAction, event.intent.requestId);
        identifiers.add("Decision history", `${linkAction}, staff review`, history.reviewId);
        identifiers.add("Decision history", `${linkAction}, staff review group`, history.groupId);
        identifiers.add("Decision history", `${linkAction}, SHA-256`, event.eventSha256);
        identifiers.add("Decision history", `${linkAction}, approval`, event.approval.intent.requestId);
        identifiers.add("Decision history", `${linkAction}, approval SHA-256`, event.retained.approval.eventSha256);
        const references = event.members.map(member => {
          const key = `${event.retained.sourceId}-${event.retained.sourceSha256}-${member.key.replace(":", "-")}`;
          // Keep PDF destination names short while the map retains the full custody key.
          const known = sources.get(key);
          const number = known?.number ?? sources.size + 1;
          const anchor = known?.anchor ?? `synthesis-source-${number}`;
          sources.set(key, { anchor, number, member, sourceId: event.retained.sourceId, sourceSha256: event.retained.sourceSha256, capturedAt: event.source.capturedAt });
          return `<li><a href="#${anchor}">Synthesis source ${number}: ${escape(memberName(member))}, ${escape(member.title)}</a></li>`;
        }).join("");
        html += `<section><h4>Response-link action ${event.eventNo}: ${escape(reviewWord("operation", event.intent.operation, "operation"))}</h4>
          <p class="meta">Recorded ${escape(reviewTime(event.createdAt))} by ${escape(staff(event.intent.actorId))}</p>
          <h4>Reason for this link action</h4>${narrative(event.intent.reason, `${linkAction}, reason`)}
          <h4>Retained review revision ${event.retained.revision.number}: ${escape(event.content.title)}</h4>
          <p>${escape(event.group.label)} | ${event.members.length} ${event.members.length === 1 ? "contribution" : "contributions"} in this group | Staff sentiment: ${escape(reviewWord("sentiment", event.group.sentiment, "sentiment"))}</p><p class="meta">${decisionSynthesisGroupCountCaveat}</p>${narrative(event.group.summary || "No group summary.", `${linkAction}, group summary`)}
          <h4>Review notes</h4>${narrative(event.content.notes || "None recorded.", `${linkAction}, review notes`)}
          <h4>Recorded approval</h4><p>Revision ${event.approval.intent.revisionNo} approved ${escape(reviewTime(event.approval.createdAt))} by ${escape(staff(event.approval.intent.actorId))}.</p>
          ${narrative(event.approval.intent.reason, `${linkAction}, approval reason`)}
          <h4>Response at this action</h4><p>Revision ${event.retained.responseHistory.revision}: ${escape(event.response.theme_title)} | ${escape(reviewWord("responseStatus", event.response.status, "response status"))}</p>
          <h4>You said</h4>${narrative(event.response.you_said, `${linkAction}, you said`)}<h4>Agency response</h4>${narrative(event.response.we_did, `${linkAction}, agency response`)}
          <h4>${event.members.length} retained source references</h4><p>Source captured ${escape(reviewTime(event.source.capturedAt))}. The references below link to the retained words in the synthesis source appendix.</p><ul>${references}</ul></section>`;
      }
    }
    sections.set(row.id, html);
  });
  for (const value of sources.values()) {
    const label = `Synthesis source ${value.number}`;
    identifiers.add("Synthesis sources", `${label}, record`, value.member.key);
    identifiers.add("Synthesis sources", `${label}, source snapshot`, value.sourceId);
    identifiers.add("Synthesis sources", `${label}, source SHA-256`, value.sourceSha256);
    identifiers.add("Synthesis sources", `${label}, original campaign settings`, value.member.configurationId);
    identifiers.add("Synthesis sources", `${label}, settings definition SHA-256`, value.member.definition?.sha256);
  }
  const appendix = sources.size ? `<h2 id="synthesis-sources">Retained synthesis source appendix</h2><p>${sources.size} distinct source references across the captured decision evidence. Repeated references to the same retained source version share one entry. These are historical words, not current source or publication status. Exact source records, survey sessions and configuration definitions remain in the workbook and portable snapshot.</p>${[...sources.values()].map(value => {
    const { member } = value;
    return `<section id="${value.anchor}"><h3>Synthesis source ${value.number}: ${escape(memberName(member))}, ${escape(member.title)}</h3>
      <p class="meta">Captured ${escape(reviewTime(value.capturedAt))}</p>
      ${narrative(memberWords(member) || "No answer text or structured value recorded.", `Synthesis source ${value.number}`)}
      <p>Original campaign settings: ${escape(reviewWord("availability", member.configurationAvailability, "availability"))}.</p></section>`;
  }).join("")}` : "";
  return { sections, appendix };
}

/** Portable registers preserve each action's membership and exact event text without replacing the original snapshot. */
export function decisionSynthesisExportRows(rows: VerifiedDecisionLink[]) {
  const coverage: ExportRow[] = [], events: ExportRow[] = [], members: ExportRow[] = [];
  for (const row of rows) {
    const histories = decisionSynthesisDetails(row.context);
    coverage.push({ decision_action_id: row.id, context_schema: row.context.schema,
      availability: histories === null ? "not_captured_in_earlier_format" : "captured_at_decision_preview",
      history_count: histories === null ? "" : histories.length,
      event_count: histories === null ? "" : histories.reduce((sum, history) => sum + history.events.length, 0),
      meaning: histories === null ? decisionSynthesisLegacyNotice : histories.length ? decisionSynthesisAuthorityNotice : decisionSynthesisEmptyNotice });
    for (const history of histories ?? []) for (const event of history.events) {
      events.push({ decision_action_id: row.id, response_link_id: event.intent.requestId, event_no: event.eventNo,
        operation: event.intent.operation, review_id: history.reviewId, group_id: history.groupId,
        source_id: event.retained.sourceId, source_sha256: event.retained.sourceSha256, source_captured_at: event.source.capturedAt,
        review_revision_id: event.retained.revision.id, review_revision: event.retained.revision.number,
        review_title: event.content.title, review_notes: event.content.notes, group_label: event.group.label,
        group_summary: event.group.summary, sentiment: event.group.sentiment, group_source_count: event.members.length,
        approval_id: event.approval.intent.requestId, approval_actor_id: event.approval.intent.actorId,
        approval_recorded_at: event.approval.createdAt, approval_reason: event.approval.intent.reason,
        approval_sha256: event.retained.approval.eventSha256, response_revision: event.retained.responseHistory.revision,
        response_status: event.response.status, response_title: event.response.theme_title, you_said: event.response.you_said,
        agency_response: event.response.we_did, link_actor_id: event.intent.actorId, link_recorded_at: event.createdAt,
        link_reason: event.intent.reason, event_sha256: event.eventSha256, exact_event_text: event.eventText });
      for (const member of event.members) members.push({ decision_action_id: row.id, response_link_id: event.intent.requestId,
        source_snapshot_id: event.retained.sourceId, source_sha256: event.retained.sourceSha256,
        source_key: member.key, source_kind: member.kind, source_id: member.id, title: member.title, source_text: member.text,
        configuration_id: member.configurationId ?? "", configuration_availability: member.configurationAvailability,
        definition_sha256: member.definition?.sha256 ?? "", exact_definition_text: member.definition?.definitionText ?? "",
        original_record_json: JSON.stringify(member.record), retained_session_json: member.session ? JSON.stringify(member.session) : "" });
    }
  }
  return { coverage, events, members };
}
export const decisionSynthesisCoverageFields = ["decision_action_id", "context_schema", "availability", "history_count", "event_count", "meaning"];
export const decisionSynthesisEventFields = ["decision_action_id", "response_link_id", "event_no", "operation", "review_id", "group_id", "source_id", "source_sha256", "source_captured_at", "review_revision_id", "review_revision", "review_title", "review_notes", "group_label", "group_summary", "sentiment", "group_source_count", "approval_id", "approval_actor_id", "approval_recorded_at", "approval_reason", "approval_sha256", "response_revision", "response_status", "response_title", "you_said", "agency_response", "link_actor_id", "link_recorded_at", "link_reason", "event_sha256", "exact_event_text"];
export const decisionSynthesisMemberFields = ["decision_action_id", "response_link_id", "source_snapshot_id", "source_sha256", "source_key", "source_kind", "source_id", "title", "source_text", "configuration_id", "configuration_availability", "definition_sha256", "exact_definition_text", "original_record_json", "retained_session_json"];
