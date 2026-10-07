"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ruleReconciliationCommandSchema } from "@/lib/land-use-plans/rule-reconciliation-command";
import { acknowledgeRuleReconciliation, preserveRuleReconciliation, readRuleReconciliationRecovery,
  restoreRuleReconciliation, retainRuleReconciliation, sendRuleReconciliation,
  type PendingRuleReconciliation, type RuleReconciliationClientScope, type RuleReconciliationRecoveryRecord,
} from "@/lib/land-use-plans/rule-reconciliation-recovery";

type Requirement = { key: string; label: string };
type Props = RuleReconciliationClientScope & {
  versionId: string; versionNumber: number; draftRevision: number; descriptorHash: string;
  working: boolean; canWrite: boolean; disabled: boolean;
  missingSections: Requirement[]; missingDefaults: Requirement[];
  onRefresh: () => Promise<void>;
};

// Recovery labels wrap within nested mobile panels while keeping a full-height target.
const recoveryButtonClassName = "h-auto min-h-10 max-w-full whitespace-normal";

function downloadCopy(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "openplan-checklist-request.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Keep review, request custody and view refresh separate from confirmation. */
export function LandUsePlanRuleReconciliationControl(props: Props) {
  const { actorId, workspaceId, planId } = props;
  const scope = { actorId, workspaceId, planId };
  const [records, setRecords] = useState<RuleReconciliationRecoveryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const latest = useRef(props); latest.current = props;
  const pending = records.filter(record => !record.archived);
  const copies = records.filter(record => record.archived);
  const reviewKey = JSON.stringify([actorId, workspaceId, planId, props.versionId, props.draftRevision,
    props.descriptorHash, props.missingSections, props.missingDefaults]);
  const needsChanges = props.missingSections.length > 0 || props.missingDefaults.length > 0;

  function read() {
    try { setRecords(readRuleReconciliationRecovery(localStorage, scope)); setReady(true); }
    catch { setReady(false); setError("Saved checklist requests could not be read. Check browser storage before sending a request."); }
  }
  useEffect(() => {
    const effectGeneration = ++generation.current;
    setRecords([]); setReady(false);
    active.current = false; setBusy(false); setNotice(null); setError(null); setRefreshRequired(false); setReviewed(null);
    const refresh = () => {
      try { setRecords(readRuleReconciliationRecovery(localStorage, { actorId, workspaceId, planId })); setReady(true); }
      catch { setReady(false); setError("Saved checklist requests could not be read. Check browser storage before sending a request."); }
    };
    refresh(); window.addEventListener("storage", refresh);
    return () => { generation.current = effectGeneration + 1; controller.current?.abort(); window.removeEventListener("storage", refresh); };
  }, [actorId, workspaceId, planId]);

  async function refreshCurrentPlan(current: number) {
    setRefreshRequired(true);
    if (latest.current.disabled) {
      setError("Keep your unsaved edits. Save them before refreshing the confirmed checklist change.");
      return;
    }
    try { await latest.current.onRefresh(); if (current === generation.current) { setRefreshRequired(false); setError(null); } }
    catch { if (current === generation.current) setError("The current plan could not refresh. The saved request or confirmed result remains available."); }
  }

  async function send(value?: PendingRuleReconciliation) {
    if (active.current || !props.canWrite || props.disabled || (!value && refreshRequired)) return;
    active.current = true; setBusy(true); setError(null); setNotice(null);
    const current = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      let request = value;
      if (!request) {
        if (!props.working || !ready || !needsChanges || reviewed !== reviewKey) throw new Error("Review the displayed checklist additions before applying them.");
        if (readRuleReconciliationRecovery(localStorage, scope).some(record => !record.archived)) throw new Error("Review the pending checklist request before starting another.");
        const command = ruleReconciliationCommandSchema.parse({ operation: "reconcile", commandId: crypto.randomUUID(), versionId: props.versionId,
          expectedDraftRevision: props.draftRevision, expectedDescriptorHash: props.descriptorHash });
        request = retainRuleReconciliation(localStorage, { ...scope, schemaVersion: 1, versionNumber: props.versionNumber,
          savedAt: new Date().toISOString(), commandText: JSON.stringify(command) });
        read();
      }
      const result = await sendRuleReconciliation(localStorage, request, fetch, abort.signal);
      if (current !== generation.current || abort.signal.aborted) return;
      setNotice(`Checklist change confirmed for draft ${request.versionNumber}. ${result.addedSections.length} blank ${result.addedSections.length === 1 ? "section" : "sections"} added; earlier content is retained.`);
      setReviewed(null); setRefreshRequired(true);
      acknowledgeRuleReconciliation(localStorage, request); read();
      await refreshCurrentPlan(current);
    } catch (caught) {
      if (current === generation.current && !abort.signal.aborted) setError(caught instanceof Error ? caught.message : "The checklist change is unconfirmed. Keep the saved request.");
    } finally {
      if (current === generation.current) { active.current = false; setBusy(false); read(); }
    }
  }

  async function preserve(record: RuleReconciliationRecoveryRecord) {
    if (active.current || props.disabled) return;
    active.current = true; setBusy(true); setError(null);
    const current = generation.current;
    try {
      preserveRuleReconciliation(localStorage, scope, record); read(); setReviewed(null);
      setNotice("The original request is preserved. This does not cancel or undo a checklist change. Review the current draft before starting another request.");
      await refreshCurrentPlan(current);
    } catch (caught) { if (current === generation.current) setError(caught instanceof Error ? caught.message : "The request could not be preserved. Keep the original copy."); }
    finally { if (current === generation.current) { active.current = false; setBusy(false); } }
  }
  async function refresh() {
    if (active.current || props.disabled) return;
    active.current = true; setBusy(true);
    const current = generation.current;
    try { await refreshCurrentPlan(current); }
    finally { if (current === generation.current) { active.current = false; setBusy(false); } }
  }
  function restore(raw: string) {
    try { restoreRuleReconciliation(localStorage, scope, raw); read(); setReviewed(null); setError(null); setNotice("The request is restored. Nothing has been sent."); }
    catch { setError("This copy could not be restored for the current account and plan. Keep the original file."); }
  }

  return <section className="space-y-3 border-l-2 border-border pl-4" aria-label="Checklist review and recovery">
    <h3 className="font-semibold">Review the current checklist</h3>
    {props.working && needsChanges ? <>
      <p className="max-w-prose text-sm text-muted-foreground">Add missing blank sections and mark the listed sections as applicable. Earlier text, evidence and maps stay intact. These additions do not establish legal sufficiency or complete the plan.</p>
      {props.missingSections.length ? <div className="text-sm"><p className="font-medium">Blank sections to add</p><ul className="mt-1 list-disc space-y-1 pl-5">{props.missingSections.map(item => <li key={item.key}>{item.label}</li>)}</ul></div> : null}
      {props.missingDefaults.length ? <div className="text-sm"><p className="font-medium">Sections to mark as applicable</p><ul className="mt-1 list-disc space-y-1 pl-5">{props.missingDefaults.map(item => <li key={item.key}>{item.label}</li>)}</ul></div> : null}
      <label className="flex max-w-prose items-start gap-2 text-sm"><input type="checkbox" checked={reviewed === reviewKey} disabled={busy || props.disabled || !props.canWrite} onChange={event => setReviewed(event.target.checked ? reviewKey : null)} />I reviewed these section additions and applicability changes.</label>
      <Button className={recoveryButtonClassName} disabled={busy || refreshRequired || !ready || !props.canWrite || props.disabled || pending.length > 0 || reviewed !== reviewKey} onClick={() => void send()}>Add reviewed checklist items</Button>
    </> : props.working ? <p className="text-sm text-muted-foreground">This draft contains the current checklist&apos;s sections and default applicability selections. Staff still needs to complete and review the content.</p> : <p className="text-sm text-muted-foreground">This edition is read-only for checklist changes. Saved requests below retain their original draft.</p>}
    {props.disabled ? <p className="text-sm text-muted-foreground">Save current edits and resolve pending context changes before applying, retrying or refreshing a checklist change.</p> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {refreshRequired ? <Button className={recoveryButtonClassName} variant="outline" disabled={busy || props.disabled} onClick={() => void refresh()}>Refresh current checklist</Button> : null}
    {!ready ? <Button className={recoveryButtonClassName} variant="outline" onClick={() => { setError(null); read(); }} disabled={busy}>Read saved checklist requests again</Button> : null}
    {pending.length ? <div className="space-y-3 border-l-2 border-amber-500 pl-4">
      <h4 className="font-semibold">Unconfirmed checklist requests</h4>
      <p className="max-w-prose text-sm text-muted-foreground">An explicit retry sends the original request. It may apply that reviewed change if the first request did not arrive. Newer saved edits cause a conflict.</p>
      {pending.map(record => <div key={record.key} className="space-y-2">
        <p className="text-sm">{record.pending ? `Saved request for draft ${record.pending.versionNumber}` : "Unreadable saved request. Preserve a copy before reviewing the current draft."}</p>
        <div className="flex flex-wrap gap-2">
          {record.pending ? <Button className={recoveryButtonClassName} variant="outline" disabled={busy || props.disabled || !props.canWrite} onClick={() => { if (record.pending) void send(record.pending); }}>Check or retry saved checklist change</Button> : null}
          <Button className={recoveryButtonClassName} variant="outline" disabled={busy} onClick={() => downloadCopy(record.raw)}>Download checklist request</Button>
          <Button className={recoveryButtonClassName} variant="outline" disabled={busy || props.disabled} onClick={() => void preserve(record)}>Preserve request and review current checklist</Button>
        </div>
      </div>)}
    </div> : null}
    <details className="text-sm"><summary className="cursor-pointer">Checklist request recovery{copies.length ? ` (${copies.length} preserved)` : ""}</summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-prose text-muted-foreground">Restoring a copy stores it in this browser. It does not send, cancel or approve a change.</p>
        <label className="block">Restore a saved checklist request<input className="mt-2 block w-full text-sm" type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 32_768) { setError("This file is larger than a checklist request."); return; }
          const current = generation.current;
          void file.text().then(raw => { if (current === generation.current) restore(raw); }).catch(() => { if (current === generation.current) setError("The request file could not be read. Keep the original file."); });
        }} /></label>
        {copies.map(record => <div key={record.key} className="flex flex-wrap items-center gap-2">
          <span>{record.pending ? `Preserved request for draft ${record.pending.versionNumber}` : "Preserved unreadable request"}</span>
          <Button className={recoveryButtonClassName} variant="outline" disabled={busy} onClick={() => downloadCopy(record.raw)}>Download checklist copy</Button>
          {record.pending ? <Button className={recoveryButtonClassName} variant="outline" disabled={busy} onClick={() => restore(record.raw)}>Restore checklist request</Button> : null}
        </div>)}
      </div>
    </details>
  </section>;
}
