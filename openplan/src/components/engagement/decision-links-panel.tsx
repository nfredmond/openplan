"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readDecisionContext, readDecisionLinkSnapshot } from "@/lib/engagement/decision-links";
import type { DecisionLinkContext, DecisionContextPacket, DecisionLinkSnapshot } from "@/lib/engagement/decision-links";
import { readPendingDecisions, retainPendingDecision, sendPendingDecision } from "@/lib/engagement/pending-decision-link";
import type { DecisionEditorScope, PendingDecisionLink } from "@/lib/engagement/pending-decision-link";
import type { CloseLoopEntryRow } from "@/lib/engagement/close-loop";

type Props = DecisionEditorScope & { responses: CloseLoopEntryRow[]; responsesUnavailable: boolean; revision: number };
type Preview = { packet: DecisionContextPacket; context: DecisionLinkContext };
const field = "w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm";

function downloadCopy(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ContextSummary({ context }: { context: DecisionLinkContext }) {
  return <div className="space-y-2 break-words text-sm">
    <p><strong>{context.decision.title}</strong> · {context.decision.status} · {context.project.name}</p>
    <p className="whitespace-pre-wrap">{context.decision.rationale}</p>
    <p><strong>Response revision {context.responseHistory.revision}: {context.response.theme_title}</strong></p>
    <p className="whitespace-pre-wrap">You said: {context.response.you_said}</p>
    <p className="whitespace-pre-wrap">We did: {context.response.we_did || "No response explanation saved."}</p>
    <p>{context.sourceCount} source references. Source words are observed at this review, not necessarily when the response was first written.</p>
    <details><summary className="cursor-pointer">Review referenced contributions and original configurations</summary>
      <ol className="mt-2 space-y-3">
        {context.sources.map(source => <li key={`${source.position}:${source.itemId}`}>
          <p>{source.position}. {source.record?.title || source.itemId} · {source.availability}</p>
          {source.record && <p className="whitespace-pre-wrap">{source.record.body}</p>}
          <p>Submission configuration: {source.configurationAvailability}.</p>
        </li>)}
      </ol>
      {context.configurations.map(configuration => <details key={configuration.id} className="mt-2">
        <summary className="cursor-pointer break-all">Configuration {configuration.id}</summary>
        <pre className="whitespace-pre-wrap break-all text-xs">{configuration.definitionText}</pre>
      </details>)}
    </details>
  </div>;
}

function DecisionEditor(props: Props) {
  const { actorId, workspaceId, campaignId, responses, responsesUnavailable, revision } = props;
  const [snapshot, setSnapshot] = useState<DecisionLinkSnapshot | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [responseId, setResponseId] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<PendingDecisionLink[]>([]);
  const [unreadable, setUnreadable] = useState<Array<{ key: string; raw: string }>>([]);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [readError, setReadError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const locked = useRef(false), mounted = useRef(false);
  const id = useId();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null);
    async function load() {
      try {
        const response = await fetch(`/api/engagement/campaigns/${campaignId}/decision-links`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Decision history unavailable");
        const payload = await response.json();
        if (payload.actorId !== actorId) throw new Error("Account changed");
        const value = await readDecisionLinkSnapshot(payload.snapshot, { campaignId, workspaceId });
        if (!controller.signal.aborted) { setSnapshot(value); setReadError(false); }
      } catch {
        if (!controller.signal.aborted) { setSnapshot(null); setReadError(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [campaignId, workspaceId, actorId, revision, attempt]);

  useEffect(() => {
    let current = true;
    async function recover() {
      try {
        const value = await readPendingDecisions(localStorage, { campaignId, workspaceId, actorId });
        if (current) { setPending(value.pending); setUnreadable(value.unreadable); setRecoveryReady(true); setStorageError(false); }
      } catch { if (current) { setStorageError(true); setRecoveryReady(false); } }
    }
    void recover();
    window.addEventListener("storage", recover);
    return () => { current = false; window.removeEventListener("storage", recover); };
  }, [campaignId, workspaceId, actorId, attempt]);

  const leaf = snapshot?.entries.find(row => row.response_id === responseId && row.decision_id === decisionId && snapshot.current.some(state => state.linkId === row.id));
  const blocked = busy || loading || !snapshot || !recoveryReady || storageError || unreadable.length > 0 || pending.some(row => row.phase === "unconfirmed");

  async function review() {
    if (locked.current || blocked || responsesUnavailable || !responseId || !decisionId) return;
    locked.current = true; setBusy(true); setPreview(null); setMessage("");
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/decision-links/context?responseId=${encodeURIComponent(responseId)}&decisionId=${encodeURIComponent(decisionId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Current sources could not be reviewed. Reload decision links and try again.");
      const payload = await response.json();
      if (payload.actorId !== actorId) throw new Error("The signed-in account changed. Reload this campaign.");
      const value = await readDecisionContext(payload.packet, { campaignId, workspaceId, responseId, decisionId });
      if (mounted.current) setPreview(value);
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Source review failed."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  async function retry(request: PendingDecisionLink) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const result = await sendPendingDecision(localStorage, request);
      if (mounted.current) { setMessage(result.message); if (result.confirmed) { setReason(current => current === request.intent.reason ? "" : current); setPreview(null); } }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Recovery storage is unavailable. No request was sent."); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setAttempt(value => value + 1); } }
  }

  async function save(withdraw: boolean) {
    if (locked.current || blocked || !reason.trim() || (!withdraw && (!preview || responsesUnavailable)) || (withdraw && (!leaf || leaf.operation === "withdraw"))) return;
    locked.current = true; setBusy(true);
    try {
      const context = withdraw && leaf ? { contextText: leaf.context_text, contextSha256: leaf.context_sha256 } : preview!.packet;
      const request: PendingDecisionLink = { version: 1, campaignId, workspaceId, actorId, context, phase: "unconfirmed",
        intent: { requestId: crypto.randomUUID(), responseId, decisionId, operation: withdraw ? "withdraw" : leaf ? "refresh" : "link",
          predecessorId: leaf?.id ?? null, expectedContextSha256: withdraw ? null : context.contextSha256, reason } };
      await retainPendingDecision(localStorage, request);
      const result = await sendPendingDecision(localStorage, request);
      if (mounted.current) { setMessage(result.message); if (result.confirmed) { setReason(""); setPreview(null); } }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "The request could not be retained. No new request was sent."); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setAttempt(value => value + 1); } }
  }

  return <section aria-label="Decision link editor" className="mt-3 min-w-0 space-y-4 rounded-lg border border-border p-3">
    <p className="text-sm text-muted-foreground">Connect a staff response to a decision already saved in Projects. Links and source evidence stay private. Linking does not approve a decision or publish an explanation.</p>
    <Button type="button" variant="outline" disabled={busy || loading} onClick={() => setAttempt(value => value + 1)}>Reload decision links</Button>
    {loading && <p role="status">Loading decision links…</p>}
    {readError && <p role="alert">Decision history could not be loaded. Its absence has not been established.</p>}
    {storageError && <p role="alert">Local recovery storage is unavailable. Enable storage before saving a link.</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {snapshot && !loading && unreadable.map(copy => <div key={copy.key} className="space-y-2 rounded border border-border p-2">
      <p role="alert">A local request could not be verified. Its original bytes are retained; new saves are paused.</p>
      <Button type="button" variant="outline" onClick={() => downloadCopy("unreadable-decision-request.json", copy.raw)}>Download unreadable request</Button>
    </div>)}
    {snapshot && !loading && pending.map(request => <div key={request.intent.requestId} className="space-y-2 rounded border border-border p-2 text-sm">
      <p>Retained request: {request.phase} · {request.intent.operation}</p>
      <p className="whitespace-pre-wrap break-words">{request.intent.reason}</p>
      <p className="break-all">Request {request.intent.requestId}</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void retry(request)}>Retry exact request</Button>{" "}
      <Button type="button" variant="outline" onClick={() => downloadCopy(`decision-request-${request.intent.requestId}.json`, JSON.stringify(request, null, 2))}>Download retained request</Button>
    </div>)}
    <fieldset disabled={blocked} className="min-w-0 space-y-3">
      <legend className="font-medium">Review a response and decision</legend>
      <label className="block text-sm" htmlFor={`${id}-response`}>Staff response</label>
      <select id={`${id}-response`} className={field} value={responseId} onChange={event => { setResponseId(event.target.value); setPreview(null); }}>
        <option value="">Select a response</option>
        {responses.map(response => <option key={response.id} value={response.id}>{response.theme_title}</option>)}
        {responseId && !responses.some(row => row.id === responseId) && <option value={responseId}>Retained response, current response unavailable</option>}
      </select>
      <label className="block text-sm" htmlFor={`${id}-decision`}>Project decision</label>
      <select id={`${id}-decision`} className={field} value={decisionId} onChange={event => { setDecisionId(event.target.value); setPreview(null); }}>
        <option value="">Select a decision</option>
        {snapshot?.decisions.map(({ record, projectName }) => <option key={record.id} value={record.id}>{projectName}: {record.title} · {record.status}</option>)}
        {decisionId && !snapshot?.decisions.some(row => row.record.id === decisionId) && <option value={decisionId}>Retained decision, current decision unavailable</option>}
      </select>
      {snapshot?.decisionCount === 0 && <p className="text-sm">No decisions are available on this campaign&apos;s linked projects. Add a decision in Projects and link its project to this campaign.</p>}
      {responsesUnavailable && <p role="alert">Current staff responses are unavailable. Reload them before reviewing a new link.</p>}
      <Button type="button" variant="outline" disabled={!responseId || !decisionId || responsesUnavailable} onClick={() => void review()}>Review current sources</Button>
      {preview && <ContextSummary context={preview.context} />}
      <label className="block text-sm" htmlFor={`${id}-reason`}>Reason for this link or change</label>
      <textarea id={`${id}-reason`} className={field} rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!preview || !reason.trim() || responsesUnavailable} onClick={() => void save(false)}>{leaf ? "Save reviewed correction" : "Save decision link"}</Button>
        {leaf && leaf.operation !== "withdraw" && <Button type="button" variant="outline" disabled={!reason.trim()} onClick={() => void save(true)}>Withdraw link, keep history</Button>}
      </div>
    </fieldset>
    {snapshot && !loading && <div className="space-y-3">
      <h3 className="font-medium">Retained decision history</h3>
      {snapshot.entryCount === 0 && <p className="text-sm">No decision links have been saved.</p>}
      {snapshot.entries.map(row => {
        const current = snapshot.current.find(state => state.linkId === row.id);
        return <article key={row.id} className="min-w-0 space-y-2 rounded border border-border p-3 text-sm">
          <p className="break-words"><strong>{row.context.response.theme_title} → {row.context.decision.title}</strong></p>
          <p>{row.operation} · {new Date(row.created_at).toLocaleString()} · {current ? `Current sources: ${current.sourceState}` : "Earlier retained version"}</p>
          <p className="whitespace-pre-wrap break-words">{row.reason}</p>
          <Link className="underline" href={`/projects/${row.project_id}`}>Open linked project</Link>
          {current && <Button type="button" variant="outline" disabled={busy} onClick={() => { setResponseId(row.response_id); setDecisionId(row.decision_id); setPreview(null); }}>Select this link</Button>}
          <details><summary className="cursor-pointer">Original private evidence</summary><ContextSummary context={row.context} /><p className="mt-2 break-all text-xs">SHA-256: {row.context_sha256}</p></details>
        </article>;
      })}
    </div>}
  </section>;
}

export function DecisionLinksPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="mt-3 min-w-0">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>Connect responses to decisions</Button>
    <div id={id}>{open && <DecisionEditor key={`${props.actorId}:${props.workspaceId}:${props.campaignId}`} {...props} />}</div>
  </div>;
}
