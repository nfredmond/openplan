"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { contextCommandFromDraft, planContextDraft, type PlanContextDraft } from "@/lib/land-use-plans/plan-context-draft";
import { serializePlanContextSave } from "@/lib/land-use-plans/plan-context-command";
import { acknowledgePlanContextCommand, clearOwnedPlanContextDraft, loadPlanContext, makePlanContextDraft, planContextDraftMatchesCurrent,
  preservePlanContextRecord, readPlanContextRecovery, restorePlanContextCommand, restorePlanContextDraft, retainPlanContextCommand,
  retainPlanContextDraft, sendPlanContextCommand, type PendingPlanContext, type PlanContextClientScope, type PlanContextRead,
  type PlanContextRecoveryRecord, type StoredPlanContextDraft } from "@/lib/land-use-plans/plan-context-recovery";
import { PlanAuthorityFields } from "./plan-authority-fields";
import { PlanStudyAreaFields } from "./plan-study-area-fields";

type Props = PlanContextClientScope & {
  activeVersionId: string; draftRevision: number; workingVersionId: string | null; descriptorId: string; planKindKey: string;
  working: boolean; canWrite: boolean; disabled: boolean; authorityLabel: string; geographyLabel: string;
  onRefresh: () => Promise<void>; onBlockChange: (scope: string, blocked: boolean) => void;
};
const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
const baseOf = (current: PlanContextRead) => {
  if (!current.versionId) throw new Error("There is no working version for a new context save.");
  return { versionId: current.versionId, contextHash: current.contextHash, descriptorId: current.descriptorId, planKindKey: current.planKindKey };
};
function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const message = (error: unknown) => error instanceof Error && error.name !== "ZodError" ? error.message : "Review the study area, responsible bodies and assessment fields. Keep your draft.";

/** Context editing retains its own scope and original base independently of content-node forms. */
export function LandUsePlanContextEditor(props: Props) {
  const { actorId, workspaceId, planId, onBlockChange } = props;
  const scope = { actorId, workspaceId, planId }, scopeKey = `${actorId}:${workspaceId}:${planId}:${props.activeVersionId}:${props.draftRevision}`;
  const [verifiedRevision, setVerifiedRevision] = useState<number | null>(null);
  const [current, setCurrent] = useState<PlanContextRead | null>(null);
  const [form, setForm] = useState<StoredPlanContextDraft | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false), [refreshRequired, setRefreshRequired] = useState(true);
  const [records, setRecords] = useState<PlanContextRecoveryRecord[]>([]);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false), [reviewArea, setReviewArea] = useState<"current" | "proposed">("current");
  const previousRaw = useRef<string | null>(null), active = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const latest = useRef(props), fileReads = useRef(0), formRevision = useRef(0);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const viewMatches = verifiedRevision === props.draftRevision && current !== null && current.actorId === actorId && current.workspaceId === workspaceId && current.planId === planId && current.versionId === props.workingVersionId && current.descriptorId === props.descriptorId && current.planKindKey === props.planKindKey;
  const stale = Boolean(form && current && !planContextDraftMatchesCurrent(form, current));
  const pending = records.filter(record => !record.archived && record.value?.kind !== "draft");
  const blocked = refreshRequired || !current || !viewMatches || !storageReady || busy || dirty || records.some(record => !record.archived);
  const editable = props.working && props.canWrite && Boolean(current?.canWrite) && viewMatches && current?.versionId === props.activeVersionId;
  const unavailable = busy || props.disabled || !editable || pending.length > 0 || refreshRequired;

  function read() {
    try { const next = readPlanContextRecovery(localStorage, scope); setRecords(next); setStorageReady(true); return next; }
    catch { setStorageReady(false); throw new Error("Saved context copies could not be read. Keep this page open or download your draft before leaving."); }
  }
  function freshForm(value: PlanContextRead) {
    formRevision.current++; fileReads.current++; previousRaw.current = null; setDirty(false); setReviewed(false);
    setForm(value.versionId ? makePlanContextDraft(scope, baseOf(value), planContextDraft(value.contextState.status === "retained" ? value.contextState.context : null,
      { authority: latest.current.authorityLabel, geography: latest.current.geographyLabel }), crypto.randomUUID()) : null);
  }
  useEffect(() => {
    const observedRevision = latest.current.draftRevision;
    const run = ++generation.current, initialFormRevision = formRevision.current, abort = new AbortController(); controller.current = abort; active.current = false;
    setBusy(false); setError(null); setNotice(null); setVerifiedRevision(null); setCurrent(null); setForm(null); setDirty(false); setRefreshRequired(true); previousRaw.current = null;
    const readStored = () => {
      try { setRecords(readPlanContextRecovery(localStorage, { actorId, workspaceId, planId })); setStorageReady(true); }
      catch { setStorageReady(false); setError("Saved context copies could not be read. Check browser storage before saving."); }
    };
    readStored(); window.addEventListener("storage", readStored);
    void loadPlanContext({ actorId, workspaceId, planId }, fetch, abort.signal).then(value => {
      if (generation.current !== run || abort.signal.aborted) return;
      setCurrent(value); setVerifiedRevision(observedRevision); previousRaw.current = null;
      if (formRevision.current === initialFormRevision) setForm(value.versionId ? makePlanContextDraft({ actorId, workspaceId, planId }, baseOf(value), planContextDraft(value.contextState.status === "retained" ? value.contextState.context : null,
        { authority: latest.current.authorityLabel, geography: latest.current.geographyLabel }), crypto.randomUUID()) : null);
      setRefreshRequired(false);
    }).catch(caught => { if (generation.current === run && !abort.signal.aborted) setError(message(caught)); });
    return () => { generation.current = run + 1; controller.current?.abort(); window.removeEventListener("storage", readStored); };
  }, [actorId, workspaceId, planId]);
  // A content refresh can expose a newer revision before context has been read.
  // Recheck it without replacing a locally edited or restored assessment.
  useEffect(() => {
    if (busy || !current || verifiedRevision === props.draftRevision) return;
    const abort = new AbortController(), run = generation.current, revision = props.draftRevision, originalFormRevision = formRevision.current;
    void loadPlanContext({ actorId, workspaceId, planId }, fetch, abort.signal).then(value => {
      if (run !== generation.current || abort.signal.aborted) return;
      setCurrent(value); setVerifiedRevision(revision); setReviewed(false);
      if (!dirty && formRevision.current === originalFormRevision) {
        previousRaw.current = null;
        setForm(value.versionId ? makePlanContextDraft({ actorId, workspaceId, planId }, baseOf(value), planContextDraft(value.contextState.status === "retained" ? value.contextState.context : null,
          { authority: latest.current.authorityLabel, geography: latest.current.geographyLabel }), crypto.randomUUID()) : null);
      }
    }).catch(caught => { if (run === generation.current && !abort.signal.aborted) { setRefreshRequired(true); setError(message(caught)); } });
    return () => abort.abort();
  }, [actorId, workspaceId, planId, props.draftRevision, busy, current, verifiedRevision, dirty]);
  useEffect(() => { onBlockChange(scopeKey, blocked); }, [onBlockChange, scopeKey, blocked]);
  useEffect(() => {
    if (!blocked) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, [blocked]);

  function change(draft: PlanContextDraft) {
    if (active.current || unavailable || !form) return;
    formRevision.current++; fileReads.current++;
    const next = { ...form, draft, savedAt: new Date().toISOString() };
    setForm(next); setDirty(true); setReviewed(false); setNotice(null);
    try { const retained = retainPlanContextDraft(localStorage, next, previousRaw.current); previousRaw.current = retained.raw; read(); setError(null); }
    catch (caught) { setStorageReady(false); setError(message(caught)); }
  }
  async function refresh() {
    if (active.current) return;
    fileReads.current++; controller.current?.abort(); active.current = true; setBusy(true); setRefreshRequired(true); setError(null);
    const run = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      await latest.current.onRefresh();
      const observedRevision = latest.current.draftRevision;
      const value = await loadPlanContext(scope, fetch, abort.signal);
      if (run === generation.current && !abort.signal.aborted) setVerifiedRevision(observedRevision);
      if (run !== generation.current || abort.signal.aborted) return;
      setCurrent(value); setReviewed(false); if (!dirty) freshForm(value); read(); setRefreshRequired(false);
    } catch (caught) { if (run === generation.current && !abort.signal.aborted) setError(message(caught)); }
    finally { if (run === generation.current) { active.current = false; setBusy(false); } }
  }

  async function save(retry?: PendingPlanContext) {
    if (active.current || !props.canWrite || props.disabled || (!retry && (unavailable || stale || !dirty || !form || !current))) return;
    fileReads.current++; controller.current?.abort(); active.current = true; setBusy(true); setError(null); setNotice(null);
    const run = generation.current, abort = new AbortController(); controller.current = abort;
    let confirmed = false;
    try {
      let request = retry;
      if (!request) {
        if (!form || !current || !planContextDraftMatchesCurrent(form, current)) throw new Error("Review this draft against the current saved context before saving.");
        if (read().some(record => !record.archived && record.value?.kind !== "draft")) throw new Error("Review the unconfirmed request before starting another save.");
        const retainedDraft = retainPlanContextDraft(localStorage, form, previousRaw.current); previousRaw.current = retainedDraft.raw;
        const commandText = serializePlanContextSave(contextCommandFromDraft(form.draft, { versionId: form.base.versionId, descriptorId: form.base.descriptorId, planKindKey: form.base.planKindKey, expectedContextHash: form.base.contextHash, commandId: crypto.randomUUID() }));
        request = retainPlanContextCommand(localStorage, { ...scope, schemaVersion: 1, kind: "pending", savedAt: new Date().toISOString(), base: form.base, draft: form.draft,
          commandText, retainedPlace: form.draft.place.mode === "retained" && current.contextState.status === "retained" ? current.contextState.context.place : null });
        read();
      }
      const receipt = await sendPlanContextCommand(localStorage, request, fetch, abort.signal);
      if (run !== generation.current || abort.signal.aborted) return;
      confirmed = true; setNotice("The context save is confirmed. Refreshing the plan before another save or freeze."); setRefreshRequired(true);
      await latest.current.onRefresh();
      const observedRevision = latest.current.draftRevision;
      const value = await loadPlanContext(scope, fetch, abort.signal);
      if (run === generation.current && !abort.signal.aborted) setVerifiedRevision(observedRevision);
      if (run !== generation.current || abort.signal.aborted) return;
      setCurrent(value); acknowledgePlanContextCommand(localStorage, request, receipt);
      const submittedForm = form && same(form.base, request.base) && same(form.draft, request.draft);
      if (!dirty || submittedForm) {
        if (form && previousRaw.current !== null) clearOwnedPlanContextDraft(localStorage, form, form.instanceId);
        freshForm(value);
      }
      setNotice(submittedForm || !dirty ? "Plan context saved and refreshed." : "The recovered save is confirmed. Your separate draft remains available for review.");
      read(); setRefreshRequired(false);
    } catch (caught) { if (run === generation.current && !abort.signal.aborted) setError(confirmed ? `The save is confirmed, but recovery or refresh needs attention. ${message(caught)}` : message(caught)); }
    finally { if (run === generation.current) { active.current = false; setBusy(false); try { read(); } catch (caught) { setError(message(caught)); } } }
  }

  async function preserve(record: PlanContextRecoveryRecord) {
    if (active.current) return;
    fileReads.current++; controller.current?.abort(); active.current = true; setBusy(true); setRefreshRequired(true); setError(null);
    const run = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      preservePlanContextRecord(localStorage, scope, record); read();
      setNotice("The original copy is preserved. This does not cancel or undo a save. Refreshing the current plan.");
      await latest.current.onRefresh(); const observedRevision = latest.current.draftRevision; const value = await loadPlanContext(scope, fetch, abort.signal);
      if (run === generation.current && !abort.signal.aborted) setVerifiedRevision(observedRevision);
      if (run !== generation.current || abort.signal.aborted) return;
      setCurrent(value); if (!dirty) freshForm(value); setRefreshRequired(false);
    } catch (caught) { if (run === generation.current && !abort.signal.aborted) setError(message(caught)); }
    finally { if (run === generation.current) { active.current = false; setBusy(false); } }
  }
  function keepDraft() {
    if (!form) throw new Error("There is no editable draft to preserve.");
    const record = retainPlanContextDraft(localStorage, form, previousRaw.current); previousRaw.current = record.raw;
    preservePlanContextRecord(localStorage, scope, record);
    // A preserved key belongs to the archive. Further typing needs a new owned key.
    formRevision.current++; fileReads.current++; previousRaw.current = null; setForm({ ...form, instanceId: crypto.randomUUID() }); read();
  }
  async function startFromCurrent() {
    if (active.current || !form) return;
    try { keepDraft(); setDirty(false); }
    catch (caught) { setError(message(caught)); return; }
    fileReads.current++; controller.current?.abort(); active.current = true; setBusy(true); setRefreshRequired(true);
    const run = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      await latest.current.onRefresh(); const observedRevision = latest.current.draftRevision; const value = await loadPlanContext(scope, fetch, abort.signal);
      if (run === generation.current && !abort.signal.aborted) setVerifiedRevision(observedRevision);
      if (run !== generation.current || abort.signal.aborted) return;
      setCurrent(value); freshForm(value); setRefreshRequired(false); setError(null); setNotice("The earlier draft is preserved. This form starts from the current saved context.");
    } catch (caught) { if (run === generation.current && !abort.signal.aborted) { setDirty(true); setError(message(caught)); } }
    finally { if (run === generation.current) { active.current = false; setBusy(false); } }
  }
  function restore(raw: string, asDraft: boolean) {
    if (active.current || props.disabled || (asDraft && dirty)) return;
    fileReads.current++;
    try {
      if (asDraft) {
        formRevision.current++;
        const copy = restorePlanContextDraft(localStorage, scope, raw, crypto.randomUUID(), new Date().toISOString());
        previousRaw.current = copy.raw; setForm(copy.value); setDirty(true); setReviewed(false); setReviewArea("current");
      } else restorePlanContextCommand(localStorage, scope, raw);
      read(); setError(null); setNotice("The copy is restored. Nothing has been sent.");
    } catch (caught) { setError(message(caught)); }
  }
  function keepNewDraftCopy() {
    if (active.current || props.disabled || !form) return;
    try {
      const next = { ...form, instanceId: crypto.randomUUID(), savedAt: new Date().toISOString() };
      const retained = retainPlanContextDraft(localStorage, next, null);
      formRevision.current++; fileReads.current++; previousRaw.current = retained.raw; setForm(next); setDirty(true);
      read(); setError(null); setNotice("Your current text is retained as a new browser draft. Earlier copies remain unchanged.");
    } catch (caught) { setError(message(caught)); }
  }
  function useReviewedDraft() {
    if (active.current || unavailable || !form || !current || !stale || !reviewed) return;
    try {
      keepDraft();
      const place = reviewArea === "proposed" && form.draft.place.mode !== "retained" ? form.draft.place
        : planContextDraft(current.contextState.status === "retained" ? current.contextState.context : null, { authority: props.authorityLabel, geography: props.geographyLabel }).place;
      const next = makePlanContextDraft(scope, baseOf(current), { ...form.draft, place }, crypto.randomUUID());
      setForm(next); setDirty(true); setReviewed(false);
      const retained = retainPlanContextDraft(localStorage, next, null); previousRaw.current = retained.raw; read(); setError(null);
      setNotice("The reviewed assessment now uses the current working version. Review the fields and save when ready; nothing has been sent.");
    } catch (caught) { setError(message(caught)); }
  }
  const ownedKey = form ? `openplan:plan-context:${actorId}:${workspaceId}:${planId}:draft:${form.instanceId}` : null;
  const recovery = records.filter(record => record.key !== ownedKey);
  return <section className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-5" aria-label="Plan context">
    <div className="space-y-2"><h2 className="text-lg font-semibold">Study area and responsible bodies</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Record this plan&apos;s study area, responsible bodies and the sources for its applicability assessment. These facts belong to the plan, independently of the workspace home.</p>
      {!props.working ? <p className="text-sm text-muted-foreground">This is the current plan context and request recovery. Frozen versions retain their own reviewed context. Start a working revision before preparing a new save.</p> : null}
    </div>
    {error ? <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => void refresh()}>Refresh saved context</Button>
      <p className="text-sm text-muted-foreground">{busy ? "Checking the save and current plan…" : dirty ? "Unsaved assessment. A new freeze is blocked." : blocked ? "Review context recovery before freezing." : "Saved context loaded."}</p></div>
    {current ? <details className="min-w-0 border-y border-border py-3"><summary className="cursor-pointer text-sm font-medium">Current saved context</summary>
      <div className="mt-3 space-y-2 text-sm">{current.contextState.status === "legacy" ? <p>No structured authority assessment is retained for this historical plan.</p> : <>
        <p>Study area: {current.contextState.context.place.label}</p><p>Responsible bodies: {current.contextState.context.assessment.authorities.map(body => body.label).join(", ")}</p>
        <p>{current.contextState.context.assessment.applicability.explanation}</p><details><summary className="cursor-pointer">View saved assessment and sources</summary>
          <ul className="mt-3 space-y-3">{current.contextState.context.assessment.authorities.map(body => <li key={body.id} className="space-y-1"><p className="font-medium">{body.label}</p><p>{body.role}. Body type: {body.kind.replaceAll("_", " ")}. Jurisdiction: {body.jurisdiction ? [body.jurisdiction.country,body.jurisdiction.subdivision].filter(Boolean).join(", ") : "Not assessed"}.</p>
            {body.sourceUrls.length ? <ul className="list-disc pl-5">{body.sourceUrls.map((url,index) => <li key={`${index}:${url}`}><a className="break-all underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul> : <p className="text-muted-foreground">No authority source recorded.</p>}</li>)}</ul>
          {current.contextState.context.assessment.applicability.status === "staff_assessed" ? <div className="mt-3"><p className="font-medium">Staff assessment sources</p><ul className="list-disc pl-5">{current.contextState.context.assessment.applicability.sourceUrls.map((url,index) => <li key={`${index}:${url}`}><a className="break-all underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul></div> : <p className="mt-3">Applicability remains unresolved.</p>}
        </details></>}
        <p className="break-all text-xs text-muted-foreground">Context hash: {current.contextHash ?? "No retained context"}</p></div></details> : <p className="text-sm">The current context has not been verified. Existing recovery copies remain available.</p>}
    {recovery.length > 0 ? <div className="space-y-3"><h3 className="font-semibold">Browser recovery copies</h3><p className="max-w-prose text-sm text-muted-foreground">An unconfirmed request may already have saved. Retry its exact request to find out. Keeping a copy aside does not cancel it. Download copies before clearing browser storage.</p>
      {recovery.map(record => <article key={record.key} className="min-w-0 space-y-2 border-l-2 border-border pl-3">
        <p className="text-sm">{record.archived ? "Preserved copy" : record.value?.kind === "pending" ? "Unconfirmed save request" : record.value?.kind === "draft" ? "Saved browser draft" : "Unreadable copy"}{record.value ? `, ${record.value.savedAt}` : ""}</p>
        {record.value ? <p className="break-all text-xs text-muted-foreground">Original working version: {record.value.base.versionId}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => download(record.raw,"openplan-context-recovery.json")}>Download copy</Button>
          {record.value?.kind === "pending" && !record.archived ? <Button type="button" size="sm" disabled={busy || props.disabled || !props.canWrite} onClick={() => void save(record.value as PendingPlanContext)}>Retry exact save request</Button> : null}
          {record.value?.kind === "pending" && record.archived ? <Button type="button" size="sm" variant="outline" disabled={busy || props.disabled} onClick={() => restore(record.raw,false)}>Restore request locally</Button> : null}
          {record.value ? <Button type="button" size="sm" variant="outline" disabled={busy || props.disabled || dirty} onClick={() => restore(record.raw,true)}>Open draft copy</Button> : null}
          {!record.archived ? <Button type="button" size="sm" variant="outline" disabled={busy || props.disabled} onClick={() => void preserve(record)}>Keep copy aside and refresh</Button> : null}</div>
      </article>)}</div> : null}
    <label className="block space-y-1 text-sm">Restore a downloaded context copy<input type="file" accept=".json,application/json" disabled={busy || props.disabled} className="block w-full text-sm" onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      if (file.size > 12_000_000) { setError("This file exceeds the context recovery size limit. Keep the original."); return; }
      const run = generation.current, read = ++fileReads.current;
      void file.text().then(raw => {
        if (run !== generation.current || active.current || read !== fileReads.current || latest.current.disabled) return;
        let asDraft = false; try { asDraft = JSON.parse(raw).kind === "draft"; } catch { /* The recovery reader reports malformed copies. */ }
        if (asDraft && dirty) { setError("Keep the current draft aside before opening another. The selected file has not changed."); return; }
        restore(raw,asDraft);
      }).catch(() => { if (run === generation.current) setError("The recovery file could not be read. Keep the original."); });
    }}/></label>
    {form ? <>
      {stale ? <div className="space-y-3 rounded-lg border border-amber-300 p-3 text-sm dark:border-amber-900"><h3 className="font-semibold">Review this older draft against the saved context</h3>
        <p>This copy keeps its original assessment. It cannot save against a newer version or context without your review.</p>
        <p className="break-all">Original version: {form.base.versionId}<br/>Original context hash: {form.base.contextHash ?? "No retained context"}</p>
        <p>Original study area: {form.draft.place.label}. Current saved study area: {current?.contextState.status === "retained" ? current.contextState.context.place.label : "No retained study area"}.</p>
        <label className="block space-y-1">Study area for the reviewed draft<select className="module-select w-full" value={reviewArea} disabled={unavailable} onChange={event => { setReviewArea(event.target.value as "current"|"proposed"); setReviewed(false); }}><option value="current">Use the current saved study area</option>{form.draft.place.mode !== "retained" ? <option value="proposed">Keep this draft&apos;s proposed replacement area</option> : null}</select></label>
        <p>Review the saved assessment above and the draft fields below. Keeping the current study area does not change the responsible bodies in your draft.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={unavailable} onChange={event => setReviewed(event.target.checked)}/>I reviewed the saved context, responsible bodies and selected study area.</label>
        <Button type="button" variant="outline" disabled={unavailable || !reviewed} onClick={useReviewedDraft}>Use reviewed assessment with current draft</Button></div> : null}
      <form className="space-y-6" onSubmit={event => { event.preventDefault(); void save(); }}>
        <PlanStudyAreaFields value={form.draft} onChange={change} hasSavedArea={current?.contextState.status === "retained"} disabled={unavailable}/>
        <PlanAuthorityFields value={form.draft} onChange={change} disabled={unavailable}/>
        <div className="flex flex-wrap gap-3"><Button disabled={unavailable || stale || !dirty}>Save plan context</Button>
          <Button type="button" variant="outline" onClick={() => download(JSON.stringify(form),"openplan-context-draft.json")}>Download this draft</Button>
          {dirty && error ? <Button type="button" variant="outline" disabled={busy || props.disabled} onClick={keepNewDraftCopy}>Keep text as a new browser draft</Button> : null}
          {dirty ? <Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => void startFromCurrent()}>Keep draft copy and use saved context</Button> : null}</div>
      </form>
    </> : null}
  </section>;
}
