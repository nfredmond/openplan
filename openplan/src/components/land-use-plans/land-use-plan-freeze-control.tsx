"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { planFreezeCommandSchema } from "@/lib/land-use-plans/freeze-command";
import { acknowledgePlanFreeze, preservePlanFreeze, readPlanFreezeRecovery, restorePlanFreeze, retainPlanFreeze, sendPlanFreeze,
  type PendingPlanFreeze, type PlanFreezeClientScope, type PlanFreezeRecoveryRecord } from "@/lib/land-use-plans/freeze-recovery";

type Props = PlanFreezeClientScope & {
  versionId: string; versionNumber: number; draftRevision: number; descriptorHash: string;
  working: boolean; canWrite: boolean; disabled: boolean; onRefresh: () => Promise<void>;
};

function downloadCopy(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "openplan-freeze-request.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LandUsePlanFreezeControl(props: Props) {
  const { actorId, workspaceId, planId } = props;
  const scope = { actorId, workspaceId, planId };
  const [records, setRecords] = useState<PlanFreezeRecoveryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const pending = records.filter(record => !record.archived);
  const copies = records.filter(record => record.archived);

  function read() {
    try { setRecords(readPlanFreezeRecovery(localStorage, scope)); setReady(true); }
    catch { setReady(false); setError("Saved freeze requests could not be read. Check browser storage before sending a request."); }
  }
  useEffect(() => {
    const effectGeneration = ++generation.current; active.current = false; setBusy(false); setNotice(null); setError(null); setRefreshRequired(false);
    const refresh = () => {
      try { setRecords(readPlanFreezeRecovery(localStorage, { actorId, workspaceId, planId })); setReady(true); }
      catch { setReady(false); setError("Saved freeze requests could not be read. Check browser storage before sending a request."); }
    };
    refresh(); window.addEventListener("storage", refresh);
    return () => { generation.current = effectGeneration + 1; controller.current?.abort(); window.removeEventListener("storage", refresh); };
  }, [actorId, workspaceId, planId]);

  async function send(value?: PendingPlanFreeze) {
    if (active.current || !props.canWrite || (!value && (props.disabled || refreshRequired))) return;
    active.current = true; setBusy(true); setError(null); setNotice(null);
    const current = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      let request = value;
      if (!request) {
        if (!props.working || !ready || readPlanFreezeRecovery(localStorage, scope).some(record => !record.archived)) throw new Error("Review the pending freeze request before starting another.");
        const command = planFreezeCommandSchema.parse({ state: "public_review", commandId: crypto.randomUUID(), versionId: props.versionId,
          expectedDraftRevision: props.draftRevision, expectedDescriptorHash: props.descriptorHash });
        request = retainPlanFreeze(localStorage, { ...scope, schemaVersion: 1, versionNumber: props.versionNumber,
          savedAt: new Date().toISOString(), commandText: JSON.stringify(command) });
        read();
      }
      await sendPlanFreeze(localStorage, request, fetch, abort.signal);
      if (current !== generation.current || abort.signal.aborted) return;
      setNotice(`Draft ${request.versionNumber} is frozen. Its saved content can no longer be edited.`);
      acknowledgePlanFreeze(localStorage, request); read();
      setRefreshRequired(true);
      try { await props.onRefresh(); if (current === generation.current) setRefreshRequired(false); }
      catch { if (current === generation.current) setError("The freeze is confirmed, but the plan view could not refresh. Reload the plan before editing."); }
    } catch (caught) {
      if (current === generation.current && !abort.signal.aborted) setError(caught instanceof Error ? caught.message : "The freeze is unconfirmed. Keep the saved request.");
    } finally {
      if (current === generation.current) { active.current = false; setBusy(false); read(); }
    }
  }

  async function preserve(record: PlanFreezeRecoveryRecord) {
    if (active.current) return;
    active.current = true; setBusy(true);
    const current = generation.current;
    try {
      preservePlanFreeze(localStorage, scope, record); read(); setError(null);
      setNotice("The request copy is preserved in this browser. This does not cancel or undo a freeze. Review the current plan before starting another request.");
      setRefreshRequired(true);
      await props.onRefresh();
      if (current === generation.current) setRefreshRequired(false);
    } catch (caught) { if (current === generation.current) setError(caught instanceof Error ? caught.message : "The request copy or current plan could not be read. Reload before editing."); }
    finally { if (current === generation.current) { active.current = false; setBusy(false); } }
  }
  async function refreshCurrentPlan() {
    if (active.current) return;
    active.current = true; setBusy(true);
    const current = generation.current;
    try { await props.onRefresh(); if (current === generation.current) { setRefreshRequired(false); setError(null); } }
    catch { if (current === generation.current) setError("The current plan could not be read. Reload before starting another freeze."); }
    finally { if (current === generation.current) { active.current = false; setBusy(false); } }
  }
  function restore(raw: string) {
    try { restorePlanFreeze(localStorage, scope, raw); read(); setError(null); setNotice("The request is restored. Nothing has been sent."); }
    catch { setError("This copy could not be restored for the current account and plan. Keep the original file."); }
  }

  return <div className="mt-3 space-y-3">
    {props.working ? <Button disabled={busy || refreshRequired || !ready || !props.canWrite || props.disabled || pending.length > 0} onClick={() => void send()}>Freeze public draft</Button> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {refreshRequired ? <Button variant="outline" disabled={busy} onClick={() => void refreshCurrentPlan()}>Refresh current plan</Button> : null}
    {!ready ? <Button variant="outline" onClick={read} disabled={busy}>Read saved requests again</Button> : null}
    {pending.length > 0 ? <div className="space-y-3 border-l-2 border-amber-500 pl-4">
      <h3 className="font-semibold">Unconfirmed freeze requests</h3>
      <p className="max-w-prose text-sm text-muted-foreground">Retry uses the original saved request. It may freeze that draft if the first request did not arrive. It does not include unsaved edits. Newer saved edits cause a conflict.</p>
      {pending.map(record => <div key={record.key} className="space-y-2">
        <p className="text-sm">{record.pending ? `Saved request for draft ${record.pending.versionNumber}` : "Unreadable saved request. Preserve a copy before reviewing the current draft."}</p>
        <div className="flex flex-wrap gap-2">
          {record.pending ? <Button variant="outline" disabled={busy || !props.canWrite} onClick={() => { if (record.pending) void send(record.pending); }}>Check or retry saved freeze</Button> : null}
          <Button variant="outline" disabled={busy} onClick={() => downloadCopy(record.raw)}>Download request copy</Button>
          <Button variant="outline" disabled={busy} onClick={() => void preserve(record)}>Preserve copy and review current draft</Button>
        </div>
      </div>)}
    </div> : null}
    <details className="text-sm">
      <summary className="cursor-pointer">Freeze request recovery{copies.length ? ` (${copies.length} preserved)` : ""}</summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-prose text-muted-foreground">Restoring a copy only adds it to the saved requests in this browser. It does not send, cancel or approve a freeze.</p>
        <label className="block">Restore a saved request file<input className="mt-2 block w-full text-sm" type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 32_768) { setError("This file is larger than a freeze request."); return; }
          const current = generation.current;
          void file.text().then(raw => { if (current === generation.current) restore(raw); }).catch(() => { if (current === generation.current) setError("The request file could not be read. Keep the original file."); });
        }} /></label>
        {copies.map(record => <div key={record.key} className="flex flex-wrap items-center gap-2">
          <span>{record.pending ? `Preserved request for draft ${record.pending.versionNumber}` : "Preserved unreadable request"}</span>
          <Button variant="outline" disabled={busy} onClick={() => downloadCopy(record.raw)}>Download copy</Button>
          {record.pending ? <Button variant="outline" disabled={busy} onClick={() => restore(record.raw)}>Restore saved request</Button> : null}
        </div>)}
      </div>
    </details>
  </div>;
}
