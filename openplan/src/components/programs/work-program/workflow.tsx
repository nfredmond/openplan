"use client";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { WorkProgramExports } from "./exports";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "./fields";
import { workProgramDifferenceLabel, workProgramDifferenceValue, workflowCommandSchema, workflowKinds, workflowLabels, type WorkflowCommand, type WorkflowData } from "@/lib/programs/work-program/workflow";
import type { WorkProgramPreparation } from "@/lib/programs/work-program/types";

const reviewFormSchema = workflowCommandSchema.omit({requestId:true,expectedSequence:true,expectedRevision:true,revisionId:true,revisionHash:true}).extend({note:z.string().max(12000)});
type Props = { programId: string; userId: string; preparation: WorkProgramPreparation; dirty: boolean; canWrite: boolean; documents: { id: string; title: string }[]; onAmendment: () => Promise<void> };
export function WorkProgramWorkflow({ programId, userId, preparation, dirty, canWrite, documents, onAmendment }: Props) {
  const [data, setData] = useState<WorkflowData | null>(null), [message, setMessage] = useState("");
  const [selected, setSelected] = useState(""), [kind, setKind] = useState<WorkflowCommand["kind"]>("submit");
  const [note, setNote] = useState(""), [authority, setAuthority] = useState(""), [scope, setScope] = useState("");
  const [evidenceDate, setEvidenceDate] = useState(""), [dueOn, setDueOn] = useState("");
  const [reviewers, setReviewers] = useState<string[]>([]), [evidence, setEvidence] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"internal" | "public">("internal"), [target, setTarget] = useState("");
  const [audience, setAudience] = useState<"internal" | "public">("internal"), [publicReviewedFor, setPublicReviewedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [generation, setGeneration] = useState(0);
  const [unreadableDraft, setUnreadableDraft] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const pending = useRef<WorkflowCommand | null>(null);
  const initialRevisions = useRef(preparation.revisions);
  const recoveryKey = `owp-review:${userId}:${programId}`;
  const revision = preparation.revisions.find(row => row.id === selected) ?? preparation.latest;
  useEffect(() => {
    try {
      setUnreadableDraft(sessionStorage.getItem(`${recoveryKey}:unreadable`));
      const saved = sessionStorage.getItem(recoveryKey);
      if (saved) { const parsed = workflowCommandSchema.safeParse(JSON.parse(saved)); if (!parsed.success) { sessionStorage.setItem(`${recoveryKey}:unreadable`, saved); setUnreadableDraft(saved); throw new Error("Unreadable recovery"); } pending.current = parsed.data; setMessage("An unconfirmed review request is retained. Retry it before recording another action."); }
      const form = sessionStorage.getItem(`${recoveryKey}:draft`);
      if (form) {
        let decoded: unknown;
        try { decoded = JSON.parse(form); } catch { decoded = null; }
        const parsed = z.object({revisionId:z.string().uuid(),revisionHash:z.string(),form:reviewFormSchema}).safeParse(decoded);
        if (parsed.success && initialRevisions.current.some(row => row.id === parsed.data.revisionId && row.content_sha256 === parsed.data.revisionHash)) { setSelected(parsed.data.revisionId); const row = parsed.data.form; setKind(row.kind); setNote(row.note); setAuthority(row.authority); setScope(row.scope); setEvidenceDate(row.evidenceDate ?? ""); setDueOn(row.dueOn ?? ""); setReviewers(row.reviewerIds); setEvidence(row.documentIds); setVisibility(row.visibility); setTarget(row.targetEventId ?? ""); }
        else { sessionStorage.setItem(`${recoveryKey}:unreadable`,form); setUnreadableDraft(form); setMessage("The saved review draft could not be matched to an available revision. Its original text is retained below; it has not been applied to another version."); }
      }
    } catch { setMessage("Review request recovery could not be read. Reload review history before recording another action."); }
    setRecoveryReady(true);
  }, [recoveryKey]);
  useEffect(() => {
    if (!recoveryReady || !canWrite || !revision) return;
    try { sessionStorage.setItem(`${recoveryKey}:draft`, JSON.stringify({revisionId:revision.id,revisionHash:revision.content_sha256,form:{kind,note,authority,scope,evidenceDate:evidenceDate||null,dueOn:dueOn||null,reviewerIds:reviewers,documentIds:evidence,visibility,targetEventId:target||null}})); } catch { /* The confirmed event remains in the database. */ }
  }, [recoveryReady,canWrite,recoveryKey,revision,kind,note,authority,scope,evidenceDate,dueOn,reviewers,evidence,visibility,target]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/programs/${programId}/work-program/workflow${revision?.id ? `?revisionId=${revision.id}` : ""}`, { cache: "no-store" }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (active) setData(result);
    }).catch(error => { if (active) { setData(null); setMessage(error instanceof Error ? error.message : "Review history unavailable"); } });
    return () => { active = false; };
  }, [programId, preparation.latest?.id, revision?.id, generation]);
  async function record(retry = false) {
    if (!data || !revision || !preparation.latest) return;
    if (pending.current && !retry) { setMessage("Retry the retained request first. Its result may already be saved."); return; }
    const command: WorkflowCommand = retry && pending.current ? pending.current : { requestId: crypto.randomUUID(), expectedSequence: data.state.sequence, expectedRevision: preparation.latest.revision, revisionId: revision.id, revisionHash: revision.content_sha256, kind, note, authority: authorityAction ? authority : "", scope: authorityAction ? scope : "", evidenceDate: authorityAction ? evidenceDate || null : null, dueOn: kind === "submit" ? dueOn || null : null, reviewerIds: kind === "submit" ? reviewers : [], documentIds: evidence, visibility, targetEventId: ["resolve_comment", "withdraw_authority"].includes(kind) ? target || null : null };
    pending.current = command;
    try { sessionStorage.setItem(recoveryKey, JSON.stringify(command)); } catch { setMessage("This browser cannot retain the pending request. Keep this page open until its result is confirmed."); }
    setBusy(true);
    try {
      const response = await fetch(`/api/programs/${programId}/work-program/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) { pending.current = null; sessionStorage.removeItem(recoveryKey); }
        throw new Error(result.error ?? "Review request could not be confirmed");
      }
      pending.current = null; sessionStorage.removeItem(recoveryKey); setNote(""); setGeneration(value => value + 1);
      setMessage(`${workflowLabels[command.kind]} recorded against the selected revision. History ID ${result.event.id}.`);
      if (command.kind === "start_amendment") { await onAmendment(); setSelected(""); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Request unconfirmed. Retry the retained request."); }
    finally { setBusy(false); }
  }
  const disclosureIdentity = `${revision?.id}:${revision?.content_sha256}:${data?.state.sequence}`;
  const publicReviewed = publicReviewedFor === disclosureIdentity;
  const authorityAction = ["adoption", "external_acceptance", "spending_authorization", "withdraw_authority"].includes(kind);
  const eligibleReviewers = data?.members.filter(member => member.id !== userId && member.id !== revision?.created_by) ?? [];
  const unavailableReviewers = reviewers.filter(id => !eligibleReviewers.some(member => member.id === id));
  const unavailableDocuments = evidence.filter(id => !documents.some(document => document.id === id));
  const name = (id: string) => data?.members.find(member => member.id === id)?.label ?? id;
  const revisionNumber = (id: string | null) => preparation.revisions.find(row => row.id === id)?.revision ?? "none";
  return <section id="work-program-review" className="min-w-0 space-y-4 rounded border p-4">
    <h2 className="text-xl font-semibold">Review, adoption and amendments</h2>
    <p className="text-sm">Submit a saved version for independent internal review. Board adoption, external acceptance and spending authorization require separate evidence. An uploaded signature or the program&apos;s general status establishes none of them.</p>
    {data && <><p>Review status: {data.state.status}. Effective adopted baseline: revision {revisionNumber(data.state.effective_revision_id)}.</p><p className="text-sm">Current edits and pending amendments do not change that baseline. Authorization applies only to the exact version and scope named in its evidence.</p></>}
    {data?.effective && <p className="rounded border p-3 text-sm">Effective baseline revenue: {data.effective.revenue ?? "unresolved"} {data.effective.currency}. Cost: {data.effective.cost ?? "unresolved"} {data.effective.currency}. These are adopted program figures; actual expenditure eligibility depends on the separately recorded authority and conditions.</p>}
    {data?.comparison && <details><summary>Amendment differences from adopted revision {data.comparison.baselineRevision}: {data.comparison.changes.length} changed fields</summary><ul className="space-y-3 pt-3">{data.comparison.changes.map((change, index) => <li key={index} className="min-w-0 break-words border-b pb-3 text-sm"><p className="font-medium">{workProgramDifferenceLabel(change.path)}</p><p className="whitespace-pre-wrap">Before: {workProgramDifferenceValue(change.before)}</p><p className="whitespace-pre-wrap">After: {workProgramDifferenceValue(change.after)}</p></li>)}</ul></details>}
    {revision && <SelectField label="Selected review revision" value={revision.id} onChange={setSelected}>{preparation.revisions.map(row => <option key={row.id} value={row.id}>Revision {row.revision}{row.id === data?.state.effective_revision_id ? " · effective adopted baseline" : ""}</option>)}</SelectField>}
    {revision && <p className="break-all text-xs">Selected content SHA-256: {revision.content_sha256}</p>}
    {data?.assignments.length ? <ul className="space-y-2 text-sm">{data.assignments.map(row => <li key={row.id}>{name(row.assignee_user_id)}: {row.status}. {row.due_on ? `Due ${row.due_on}` : "No due date assigned"}. <a className="underline" href="/my-work">Open My Work</a></li>)}</ul> : null}
    <fieldset disabled={!canWrite || !data || !revision || busy || dirty} className="min-w-0 space-y-4">
      <legend className="font-medium">Save a review action</legend>
      <SelectField label="Review action" value={kind} onChange={value => setKind(value as WorkflowCommand["kind"])}>{workflowKinds.map(value => <option key={value} value={value}>{workflowLabels[value]}</option>)}</SelectField>
      {kind === "submit" && <><fieldset className="space-y-2"><legend>Assign independent reviewers</legend>{eligibleReviewers.map(member => <label key={member.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewers.includes(member.id)} onChange={event => setReviewers(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} /><span className="break-all">{member.label}</span></label>)}{unavailableReviewers.map(id => <label key={id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked onChange={() => setReviewers(current => current.filter(value => value !== id))} /><span className="break-all">Unavailable reviewer {id}. Uncheck to remove this saved selection.</span></label>)}</fieldset><Field label="Review due date, optional" type="date" value={dueOn} onChange={setDueOn} /></>}
      {kind === "start_amendment" && <p>Select the effective adopted baseline above. This creates an editable revision with the same work, task and product identities, staffing and project links. Existing project work and completed items are retained.</p>}
      {["resolve_comment", "withdraw_authority"].includes(kind) && <SelectField label="Comment or decision to resolve or withdraw" value={target} onChange={setTarget}><option value="">Select a history item</option>{data?.events.filter(event => event.revision_id === revision?.id && (kind === "resolve_comment" ? event.kind === "comment" : ["adoption", "external_acceptance", "spending_authorization"].includes(event.kind))).map(event => <option key={event.id} value={event.id}>{event.sequence}. {workflowLabels[event.kind]}: {event.payload.note.slice(0,80)}</option>)}</SelectField>}
      <Field label="Review note or requested changes" value={note} onChange={setNote} multiline />
      {authorityAction && <><Field label="Actual deciding authority" value={authority} onChange={setAuthority} /><Field label="Decision or authorization date" value={evidenceDate} onChange={setEvidenceDate} type="date" /><Field label="Applicable scope, conditions and unresolved requirements" value={scope} onChange={setScope} multiline /></>}
      <fieldset className="space-y-2"><legend>Supporting Documents</legend>{documents.map(document => <label key={document.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={evidence.includes(document.id)} onChange={event => setEvidence(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))} /><span className="break-words">{document.title}</span></label>)}{unavailableDocuments.map(id => <label key={id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked onChange={() => setEvidence(current => current.filter(value => value !== id))} /><span className="break-all">Unavailable document {id}. Uncheck to remove this saved selection.</span></label>)}</fieldset>
      <SelectField label="Disclosure in review copies" value={visibility} onChange={value => setVisibility(value as "internal" | "public")}><option value="internal">Internal only</option><option value="public">Reviewed for public copy, including document references</option></SelectField>
      <Button type="button" className="h-auto whitespace-normal" onClick={() => void record()} disabled={!note.trim()}>Save selected action</Button>
    </fieldset>
    {dirty && <p role="status">Save or discard local edits before saving a review action against a saved version.</p>}
    {pending.current && <Button type="button" disabled={busy} onClick={() => void record(true)}>Retry unconfirmed review request</Button>}
    <Button type="button" variant="outline" disabled={busy} onClick={() => setGeneration(value => value + 1)}>Reload review history</Button>
    {unreadableDraft && <details><summary>Unrestored review draft</summary><p>Keep this original text while checking the saved revision and access. It has not been used as a decision.</p><textarea className="w-full min-w-0" rows={6} readOnly aria-label="Retained unreadable review draft" value={unreadableDraft} /></details>}
    {message && <p role="status" className="break-words">{message}</p>}
    {revision && data && <section className="min-w-0 space-y-3"><h3 className="font-semibold">Selected review and amendment files</h3>
      <p className="text-sm">Includes the exact saved preparation version, review records through event {data.state.sequence}, unresolved comments and differences from its adopted baseline. Copies remain in the private Documents library.</p>
      <SelectField label="Review file audience" value={audience} onChange={value => { setAudience(value as "internal" | "public"); setPublicReviewedFor(null); }}><option value="internal">Internal history, including all review notes</option><option value="public">Public copy, excluding internal review notes</option></SelectField>
      {audience === "public" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={publicReviewed} onChange={event => setPublicReviewedFor(event.target.checked ? disclosureIdentity : null)} /><span>I am a workspace administrator and have reviewed this entire revision, its source content and baseline for public disclosure. This prepares a copy; it does not publish online.</span></label>}
      <WorkProgramExports key={`${revision.id}:${data.state.sequence}:${audience}`} programId={programId} revision={revision.revision} packet={{sequence:data.state.sequence,audience,publicReviewed}} />
    </section>}
    <details><summary>Review and authority history</summary><ol className="space-y-4 pt-3">{data?.events.map(event => <li key={event.id} className="min-w-0 rounded border p-3 text-sm"><p>{event.sequence}. {workflowLabels[event.kind]} · revision {revisionNumber(event.revision_id)}</p><p className="break-words">{event.payload.note}</p><p>{name(event.actor_id)} · recorded {event.created_at}</p>{event.payload.authority && <p>{event.payload.authority} · decision date {event.payload.evidenceDate}. Scope: {event.payload.scope}</p>}<p>{event.payload.visibility === "internal" ? "Internal history" : "Reviewed for public copy"}</p>{event.evidence.map(document => <p key={document.id}><a className="underline" href={`/api/knowledge-base/documents/${document.id}/download?delivery=authenticated`}>{document.title}</a><span className="block break-all text-xs">SHA-256 {document.checksum}</span></p>)}</li>)}</ol></details>
  </section>;
}
