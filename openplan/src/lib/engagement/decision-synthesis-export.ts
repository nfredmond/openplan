import type { VerifiedDecisionLink } from "./decision-links";
import { decisionSynthesisDetails, decisionSynthesisLegacyNotice, decisionSynthesisEmptyNotice, decisionSynthesisAuthorityNotice, type DecisionSynthesisDetails } from "./decision-synthesis-display";

type Cell = string | number;
type ExportRow = Record<string, Cell>;
type Member = DecisionSynthesisDetails[number]["events"][number]["members"][number];
type TextRenderer = { escape: (value: unknown) => string; narrative: (value: unknown, record: unknown) => string };

/** Source words appear once in a keyed appendix; each retained action lists its exact reviewed membership. */
export function decisionSynthesisReport(rows: VerifiedDecisionLink[], { escape, narrative }: TextRenderer) {
  const sources = new Map<string, { anchor: string; member: Member; sourceId: string; sourceSha256: string; capturedAt: string }>();
  const sections = new Map<string, string>();
  for (const row of rows) {
    const histories = decisionSynthesisDetails(row.context);
    let html = `<h4>Retained synthesis evidence</h4>`;
    if (histories === null) html += `<p>${decisionSynthesisLegacyNotice}</p>`;
    else if (!histories.length) html += `<p>${decisionSynthesisEmptyNotice}</p>`;
    else {
      html += `<p>${histories.length} review-group histories, ${histories.reduce((sum, history) => sum + history.events.length, 0)} saved response-link actions. ${decisionSynthesisAuthorityNotice}</p>`;
      for (const history of histories) for (const event of history.events) {
        const references = event.members.map(member => {
          const key = `${event.retained.sourceId}-${event.retained.sourceSha256}-${member.key.replace(":", "-")}`;
          // Keep PDF destination names short while the map retains the full custody key.
          const anchor = sources.get(key)?.anchor ?? `synthesis-source-${sources.size + 1}`;
          sources.set(key, { anchor, member, sourceId: event.retained.sourceId, sourceSha256: event.retained.sourceSha256, capturedAt: event.source.capturedAt });
          return `<li><a href="#${anchor}">${escape(member.key)}: ${escape(member.title)}</a></li>`;
        }).join("");
        html += `<section><h4>Response-link action ${event.eventNo}: ${event.intent.operation}</h4>
          <p class="meta">Action ${escape(event.intent.requestId)} | Recorded ${escape(event.createdAt)} | Actor ${escape(event.intent.actorId)}<br>Review ${escape(history.reviewId)} | Group ${escape(history.groupId)}<br>Action SHA-256 ${event.eventSha256}</p>
          <h4>Reason for this link action</h4>${narrative(event.intent.reason, event.intent.requestId)}
          <h4>Retained review revision ${event.retained.revision.number}: ${escape(event.content.title)}</h4>
          <p>${escape(event.group.label)} | Staff sentiment: ${escape(event.group.sentiment)}</p>${narrative(event.group.summary || "No group summary.", event.retained.revision.id)}
          <h4>Review notes</h4>${narrative(event.content.notes || "None recorded.", event.retained.revision.id)}
          <h4>Recorded approval</h4><p>Revision ${event.approval.intent.revisionNo} approved at ${escape(event.approval.createdAt)}.</p>
          <p class="meta">Approval ${escape(event.approval.intent.requestId)} | Actor ${escape(event.approval.intent.actorId)}<br>Approval SHA-256 ${event.retained.approval.eventSha256}</p>${narrative(event.approval.intent.reason, event.approval.intent.requestId)}
          <h4>Response at this action</h4><p>Revision ${event.retained.responseHistory.revision}: ${escape(event.response.theme_title)} | ${escape(event.response.status)}</p>
          <h4>You said</h4>${narrative(event.response.you_said, event.retained.responseHistory.id)}<h4>Agency response</h4>${narrative(event.response.we_did, event.retained.responseHistory.id)}
          <h4>${event.members.length} retained source references</h4><p>Source captured ${escape(event.source.capturedAt)}. The references below link to the retained words in the synthesis source appendix.</p><ul>${references}</ul></section>`;
      }
    }
    sections.set(row.id, html);
  }
  const appendix = sources.size ? `<h2 id="synthesis-sources">Retained synthesis source appendix</h2><p>${sources.size} distinct source references across the captured decision evidence. Repeated references to the same retained source version share one entry. These are historical words, not current source or publication status. Exact source records, survey sessions and configuration definitions remain in the workbook and portable snapshot.</p>${[...sources.values()].map(value => {
    const { member } = value;
    return `<section id="${value.anchor}"><h3>${member.kind === "item" ? "Contribution" : "Survey answer"}: ${escape(member.title)}</h3>
      <p class="meta">${escape(member.key)}<br>Source ${escape(value.sourceId)} | Captured ${escape(value.capturedAt)}<br>Source SHA-256 ${value.sourceSha256}</p>
      ${narrative(member.text || "No answer text or structured value recorded.", member.key)}
      <p>Original configuration: ${member.configurationAvailability}${member.configurationId ? ` (${escape(member.configurationId)})` : ""}.</p>
      ${member.definition ? `<p class="meta">Definition SHA-256 ${member.definition.sha256}</p>` : ""}</section>`;
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
