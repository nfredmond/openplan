"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS } from "@/lib/land-use-plans/registry";
import { planContextDraft } from "@/lib/land-use-plans/plan-context-draft";
import { planApplicabilityBlocker } from "@/lib/land-use-plans/plan-context";
import { confirmCreationRequest, confirmCreationStop, creationCommandFromDraft, importCreationRecord, readCreationRecords, retainCreationRequest, retainCreationStop,
  saveCreationDraft, sendCreationRequest, sendCreationStop, type CreationDraft, type CreationPending, type CreationRecord, type PlanCreationFields } from "@/lib/land-use-plans/create-recovery";
import { PlanAuthorityFields } from "./plan-authority-fields";
import { PlanStudyAreaFields } from "./plan-study-area-fields";

type Props = { actorId: string; workspaceId: string; canWrite: boolean; descriptorHashes: Record<string, string> };
const message = (error: unknown) => error instanceof Error && error.name !== "ZodError" && !(error instanceof SyntaxError)
  ? error.message : "Review the title, plan area, responsible bodies and assessment. Keep your draft.";
function download(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "openplan-plan-creation.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Account and workspace changes unmount in-flight work before mounting a new form. */
export function LandUsePlanCreator(props: Props) {
  return <CreationForm key={`${props.actorId}:${props.workspaceId}`} {...props} />;
}

function CreationForm({ actorId, workspaceId, canWrite, descriptorHashes }: Props) {
  const router = useRouter(), scope = { actorId, workspaceId };
  const [form, setForm] = useState<CreationDraft | null>(null);
  const [records, setRecords] = useState<CreationRecord[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const previous = useRef<string | null>(null), active = useRef(false), mounted = useRef(false);
  const request = useRef<AbortController | null>(null), fileRead = useRef(0);
  const neutral = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find(item => !item.configured)!;
  const descriptor = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find(item => item.id === form?.fields.descriptorId);
  const pending = records.filter(record => record.value?.kind === "pending" || !record.value);
  const submitted = records.some(record => record.value && record.value.kind !== "draft" && record.value.draft.instanceId === form?.instanceId);
  const locked = busy || !canWrite;

  function read() {
    try { const next = readCreationRecords(localStorage, scope); setRecords(next); setReady(true); return next; }
    catch { setReady(false); throw new Error("Saved creation copies could not be read. Keep this page open and download your draft."); }
  }
  useEffect(() => {
    mounted.current = true;
    setForm({ actorId, workspaceId, schemaVersion: 1, kind: "draft", instanceId: crypto.randomUUID(), savedAt: new Date().toISOString(),
      fields: { title: "", authorityLabel: "", descriptorId: neutral.id, planKindKey: neutral.planKinds[0].key,
        descriptorHash: descriptorHashes[neutral.id], context: planContextDraft(null, { authority: "", geography: "" }) } });
    const readStored = () => {
      try { setRecords(readCreationRecords(localStorage, { actorId, workspaceId })); setReady(true); }
      catch { setReady(false); setError("Saved creation copies could not be read. Download your draft before leaving."); }
    };
    readStored(); window.addEventListener("storage", readStored);
    return () => { mounted.current = false; request.current?.abort(); window.removeEventListener("storage", readStored); };
    // The scope-keyed component initializes once; refreshed rules must not replace a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, workspaceId]);
  useEffect(() => {
    if (!form || (!previous.current && pending.length === 0)) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, [form, pending.length]);

  function change(fields: PlanCreationFields) {
    if (!form || active.current || !canWrite) return;
    const next = { ...form, fields, savedAt: new Date().toISOString() };
    setForm(next); setReviewed(false); setNotice(null);
    try { previous.current = saveCreationDraft(localStorage, next, previous.current).raw; read(); setError(null); }
    catch (caught) { setReady(false); setError(message(caught)); }
  }
  async function send(value: CreationPending) {
    const abort = new AbortController(); request.current = abort;
    const result = await sendCreationRequest(localStorage, value, fetch, abort.signal);
    if (!mounted.current || abort.signal.aborted) return;
    confirmCreationRequest(localStorage, value, result); read();
    router.push(`/land-use-plans/${result.planId}`); router.refresh();
  }
  async function create() {
    if (!form || active.current || locked || !ready || !reviewed) return;
    active.current = true; setBusy(true); setError(null);
    try {
      if (read().some(record => !record.value || record.value.kind === "pending" || (record.value.kind === "confirmed" && record.value.draft.instanceId === form.instanceId))) throw new Error("This draft has a saved creation request. Open or retry it before starting another plan.");
      if (!descriptor || descriptorHashes[descriptor.id] !== form.fields.descriptorHash) throw new Error("The checklist changed. Review the current rules before creating the plan.");
      const command = creationCommandFromDraft(form, crypto.randomUUID());
      const blocker = planApplicabilityBlocker(command.assessment, descriptor);
      if (blocker) throw new Error(blocker);
      const retained = retainCreationRequest(localStorage, form, command.commandId); read();
      await send(retained);
    } catch (caught) { if (mounted.current) setError(message(caught)); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function retry(value: CreationPending) {
    if (active.current || !canWrite) return;
    active.current = true; setBusy(true); setError(null);
    try { await send(value); }
    catch (caught) { if (mounted.current) setError(message(caught)); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function stop(value: CreationPending) {
    if (active.current || !canWrite) return;
    active.current = true; setBusy(true); setError(null);
    const abort = new AbortController(); request.current = abort;
    try {
      const pendingStop = retainCreationStop(localStorage, value); read();
      const result = await sendCreationStop(localStorage, pendingStop, fetch, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      confirmCreationStop(localStorage, pendingStop, result); read();
      if (result.outcome === "created") { router.push(`/land-use-plans/${result.result.planId}`); router.refresh(); }
      else setNotice("Request stopped. It cannot create a plan. Restore its draft to a new copy and review current rules before creating another request.");
    } catch (caught) { if (mounted.current) setError(message(caught)); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  function restore(value: CreationDraft) {
    if (active.current || !canWrite) return;
    try {
      if (read().some(record => record.value && (record.value.kind === "pending" || record.value.kind === "confirmed") && record.value.draft.instanceId === value.instanceId)) {
        throw new Error("This draft already has a creation request. Open or retry that request instead.");
      }
      const copy: CreationDraft = { ...value, instanceId: crypto.randomUUID(), savedAt: new Date().toISOString() };
      const retained = saveCreationDraft(localStorage, copy, null);
      previous.current = retained.raw; setForm(copy); setReviewed(false); read(); setError(null);
      setNotice("Draft restored to a new copy. Review its rules and facts before creating a plan.");
    } catch (caught) { setError(message(caught)); }
  }

  return <section className="min-w-0 rounded-xl border border-border bg-card p-4 md:p-6" aria-labelledby="create-plan-title">
    <h2 id="create-plan-title" className="text-lg font-semibold">Start a land use plan</h2>
    <p className="mt-2 max-w-prose text-sm text-muted-foreground">Identify the area and responsible bodies for this plan. Your office location does not select its law. Start with unresolved requirements or assess a sourced checklist for this plan.</p>
    {!canWrite ? <p className="mt-3 text-sm">Current staff write access is required to create or retry a plan.</p> : null}
    {form ? <div className="mt-6 space-y-6">
      <fieldset disabled={locked} className="grid min-w-0 gap-4 md:grid-cols-2">
        <legend className="sr-only">Plan identity and rules</legend>
        <label className="space-y-1 text-sm">Plan title<Input value={form.fields.title} maxLength={180} onChange={event => change({ ...form.fields, title: event.target.value })} /></label>
        <label className="space-y-1 text-sm">Display authority label<Input value={form.fields.authorityLabel} maxLength={180} onChange={event => change({ ...form.fields, authorityLabel: event.target.value })} /><span className="block text-xs text-muted-foreground">The short label shown on the plan list. Describe the role of each body below.</span></label>
        <label className="space-y-1 text-sm">Legal checklist<select className="module-select w-full" value={form.fields.descriptorId} onChange={event => {
          const next = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find(item => item.id === event.target.value)!;
          change({ ...form.fields, descriptorId: next.id, planKindKey: next.planKinds[0].key, descriptorHash: descriptorHashes[next.id] });
        }}><option value="" disabled>Select a checklist</option>{SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.map(item => <option key={item.id} value={item.id}>{item.jurisdictionLabel}</option>)}</select></label>
        <label className="space-y-1 text-sm">Plan kind<select className="module-select w-full" value={form.fields.planKindKey} onChange={event => change({ ...form.fields, planKindKey: event.target.value })}>
          {descriptor?.planKinds.map(kind => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
        </select></label>
      </fieldset>
      {descriptor ? <div className="max-w-prose space-y-2 border-l-2 border-border pl-4 text-sm">
        <p>{descriptor.disclosure}</p><p className="text-muted-foreground">Source review: {descriptor.verifiedAt}. Review due: {descriptor.reviewDueAt}. These dates do not establish current legal sufficiency.</p>
        {descriptor.sourceUrls.length ? <ul className="list-disc space-y-1 pl-5">{descriptor.sourceUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all underline">{url}</a></li>)}</ul> : null}
      </div> : <p role="alert">This saved checklist is no longer installed. Select and assess a current checklist.</p>}
      {descriptor && form.fields.descriptorHash !== descriptorHashes[descriptor.id] ? <div role="alert" className="space-y-2 text-sm">
        <p>The saved draft refers to older rules. Its original copy remains available.</p>
        <Button variant="outline" disabled={locked} onClick={() => change({ ...form.fields, descriptorHash: descriptorHashes[descriptor.id] })}>Use reviewed current rules for this draft</Button>
      </div> : null}
      <PlanStudyAreaFields key={form.instanceId} value={form.fields.context} onChange={context => change({ ...form.fields, context })} hasSavedArea={false} disabled={locked} />
      <PlanAuthorityFields value={form.fields.context} onChange={context => change({ ...form.fields, context })} disabled={locked} />
      <label className="flex max-w-prose items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)} className="mt-1" />I reviewed the plan area, responsible bodies and selected checklist. Unresolved authority remains stated above.</label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={locked || !ready || !reviewed || pending.length > 0 || submitted} onClick={() => void create()}>{busy ? "Confirming creation…" : "Create plan and first working version"}</Button>
        <Button variant="outline" onClick={() => download(JSON.stringify(form))}>Download this draft</Button>
      </div>
    </div> : <p className="mt-4 text-sm">Reading saved creation copies…</p>}
    {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="mt-4 text-sm">{notice}</p> : null}
    <div className="mt-6 space-y-3 border-t border-border pt-4">
      <h3 className="font-medium">Saved creation copies</h3>
      <p className="max-w-prose text-sm text-muted-foreground">Drafts and requests stay in this browser for this account and workspace. Opening this page sends nothing. Retry an unconfirmed request or stop it before starting another plan. Stopping returns the existing plan if creation already succeeded; it never deletes a plan.</p>
      <label className="block text-sm">Import a creation copy<input type="file" accept=".json,application/json" disabled={locked} className="mt-1 block w-full text-sm" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
        if (file.size > 12_000_000) { setError("Use a creation copy smaller than 12 MB."); return; }
        const reading = ++fileRead.current;
        void file.text().then(raw => {
          if (!mounted.current || active.current || reading !== fileRead.current) return;
          importCreationRecord(localStorage, scope, raw); read(); setNotice("Copy retained. Restore a draft or explicitly retry its request below."); setError(null);
        }).catch(caught => { if (mounted.current && reading === fileRead.current) setError(message(caught)); });
      }} /></label>
      {records.map(record => <div key={record.key} className="space-y-2 border-l-2 border-border py-2 pl-3">
        <p className="break-words text-sm">{record.value?.kind === "draft" ? `Draft: ${record.value.fields.title || "Untitled plan"}`
          : record.value?.kind === "confirmed" ? `Created: ${record.value.result.title}`
            : record.value?.kind === "cancelled" ? `Stopped request: ${record.value.draft.fields.title}`
              : record.value?.kind === "pending" && record.value.stopRequested ? `Stop not yet confirmed: ${record.value.draft.fields.title}`
            : record.value ? `Unconfirmed request: ${record.value.draft.fields.title}` : "Unreadable saved copy. Keep it for review before creating another plan."}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => download(record.raw)}>Download saved copy</Button>
          {record.value?.kind === "draft" ? <Button variant="outline" size="sm" disabled={locked} onClick={() => restore(record.value as CreationDraft)}>Restore draft to a new copy</Button> : null}
          {record.value?.kind === "pending" && !record.value.stopRequested ? <Button variant="outline" size="sm" disabled={locked || !ready} onClick={() => void retry(record.value as CreationPending)}>Retry this exact creation request</Button> : null}
          {record.value?.kind === "pending" ? <Button variant="outline" size="sm" disabled={locked || !ready} onClick={() => void stop(record.value as CreationPending)}>{record.value.stopRequested ? "Retry stopping this request" : "Stop this creation request"}</Button> : null}
          {record.value?.kind === "cancelled" ? <Button variant="outline" size="sm" disabled={locked || !ready} onClick={() => { if (record.value?.kind === "cancelled") restore(record.value.draft); }}>Review stopped draft in a new copy</Button> : null}
          {record.value?.kind === "confirmed" ? <a className="self-center text-sm underline" href={`/land-use-plans/${record.value.result.planId}`}>Open created plan</a> : null}
        </div>
      </div>)}
    </div>
  </section>;
}
