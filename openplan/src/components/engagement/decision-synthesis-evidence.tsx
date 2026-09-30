import type { DecisionLinkContext } from "@/lib/engagement/decision-links";
import { decisionSynthesisDetails, decisionSynthesisLegacyNotice, decisionSynthesisEmptyNotice, decisionSynthesisAuthorityNotice } from "@/lib/engagement/decision-synthesis-display";

/** The calling decision reader verifies the private packet before passing it to this display. */
export function DecisionSynthesisEvidence({ context }: { context: DecisionLinkContext }) {
  const histories = decisionSynthesisDetails(context);
  return <section className="min-w-0 space-y-2 break-words" aria-label="Retained synthesis evidence">
    <h4 className="font-medium">Retained synthesis evidence</h4>
    {histories === null ? <p>{decisionSynthesisLegacyNotice}</p> : histories.length === 0 ? <p>{decisionSynthesisEmptyNotice}</p> : <>
      <p>{histories.length} review-group histories, {histories.reduce((sum, row) => sum + row.events.length, 0)} saved response-link actions.</p>
      <p>{decisionSynthesisAuthorityNotice}</p>
      {histories.map(history => <details className="min-w-0 rounded border p-2" key={`${history.reviewId}:${history.groupId}`}>
        <summary className="cursor-pointer">{history.events.at(-1)!.group.label} · {history.events.length} actions · last recorded action: {history.events.at(-1)!.intent.operation}</summary>
        <p className="break-all text-xs">Review {history.reviewId} · Group {history.groupId}</p>
        {history.events.map(event => <details className="mt-2 min-w-0 rounded border p-2" key={event.intent.requestId}>
          <summary className="cursor-pointer">Action {event.eventNo}: {event.intent.operation} · review revision {event.retained.revision.number}</summary>
          <p>Recorded {event.createdAt}</p><p className="whitespace-pre-wrap">Link reason: {event.intent.reason}</p>
          <p className="break-all text-xs">Link actor: {event.intent.actorId}</p>
          <h5 className="mt-2 font-medium">Retained review</h5><p>{event.content.title}</p>
          <p className="whitespace-pre-wrap">{event.group.label}: {event.group.summary || "No group summary."}</p>
          <p>Staff sentiment: {event.group.sentiment}.</p><p className="whitespace-pre-wrap">Review notes: {event.content.notes || "None recorded."}</p>
          <h5 className="mt-2 font-medium">Recorded approval</h5><p>Approved revision {event.approval.intent.revisionNo} at {event.approval.createdAt}.</p>
          <p className="whitespace-pre-wrap">Approval reason: {event.approval.intent.reason}</p><p className="break-all text-xs">Approval actor: {event.approval.intent.actorId}</p>
          <h5 className="mt-2 font-medium">Response at this action</h5><p>Revision {event.retained.responseHistory.revision}: {event.response.theme_title} · {event.response.status}</p>
          <p className="whitespace-pre-wrap">You said: {event.response.you_said}</p><p className="whitespace-pre-wrap">Agency response: {event.response.we_did}</p>
          <details className="mt-2"><summary className="cursor-pointer">{event.members.length} retained source references</summary>
            <p>Source captured {event.source.capturedAt}. Selection: {JSON.stringify(event.source.selection)}.</p>
            <ol className="space-y-3">{event.members.map(member => <li key={member.key} className="mt-2">
              <p className="font-medium">{member.kind === "item" ? "Contribution" : "Survey answer"}: {member.title}</p>
              <p className="whitespace-pre-wrap">{member.text || "No answer text or structured value recorded."}</p>
              <p className="break-all text-xs">{member.key} · Original configuration: {member.configurationAvailability}</p>
              {member.definition && <details><summary className="cursor-pointer">Original configuration definition</summary><pre className="whitespace-pre-wrap break-all text-xs">{member.definition.definitionText}</pre></details>}
            </li>)}</ol>
          </details>
          <details className="mt-2"><summary className="cursor-pointer">Exact retained action packet</summary><pre className="whitespace-pre-wrap break-all text-xs">{event.eventText}</pre></details>
          <p className="break-all text-xs">Action SHA-256: {event.eventSha256}</p>
        </details>)}
      </details>)}
    </>}
  </section>;
}
