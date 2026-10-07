"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resetUnchangedPlanForm } from "./use-plan-form-custody";
import { Button } from "@/components/ui/button";
import { implementationReportCommandSchema } from "@/lib/land-use-plans/implementation-report-command";
import { IMPLEMENTATION_REPORT_RECOVERY_LIMIT, acknowledgeImplementationReport, preserveImplementationReport, readImplementationReportRecovery, restoreImplementationReport, retainImplementationReport, sendImplementationReport,
  type PendingImplementationReport, type ImplementationReportClientScope, type ImplementationReportRecoveryRecord } from "@/lib/land-use-plans/implementation-report-recovery";

type Props = ImplementationReportClientScope & {
  versionId: string; versionNumber: number; contentHash: string | null;
  adopted: boolean; canWrite: boolean; disabled: boolean; onRefresh: () => Promise<void>;
};

function downloadCopy(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "openplan-implementation-report-request.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LandUseImplementationReportControl(props: Props) {
  const { actorId, workspaceId, planId } = props;
  const scope = { actorId, workspaceId, planId };
  const [records, setRecords] = useState<ImplementationReportRecoveryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const pending = records.filter(record => !record.archived);
  const copies = records.filter(record => record.archived);

  function read() {
    try { setRecords(readImplementationReportRecovery(localStorage, scope)); setReady(true); }
    catch { setReady(false); setError("Saved report requests could not be read. Check browser storage before sending a request."); }
  }
  useEffect(() => {
    const effectGeneration = ++generation.current; active.current = false; setBusy(false); setNotice(null); setReportId(null); setError(null); setRefreshRequired(false);
    const refresh = () => {
      try { setRecords(readImplementationReportRecovery(localStorage, { actorId, workspaceId, planId })); setReady(true); }
      catch { setReady(false); setError("Saved report requests could not be read. Check browser storage before sending a request."); }
    };
    refresh(); window.addEventListener("storage", refresh);
    return () => { generation.current = effectGeneration + 1; controller.current?.abort(); window.removeEventListener("storage", refresh); };
  }, [actorId, workspaceId, planId]);

  async function send(value?: PendingImplementationReport, formElement?: HTMLFormElement) {
    if (active.current || !props.canWrite || (!value && (props.disabled || refreshRequired))) return;
    active.current = true; setBusy(true); setError(null); setNotice(null);
    const form = formElement ? new FormData(formElement) : null;
    const current = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      let request = value;
      if (!request) {
        if (!props.adopted || !form || !props.contentHash || !ready || readImplementationReportRecovery(localStorage, scope).some(record => !record.archived)) throw new Error("Review the pending report request before starting another.");
        const command = implementationReportCommandSchema.parse({ operation: "generate", commandId: crypto.randomUUID(), versionId: props.versionId,
          expectedVersionHash: props.contentHash, reportingPeriodStart: String(form.get("start")), reportingPeriodEnd: String(form.get("end")),
          title: String(form.get("title")).trim(), summary: String(form.get("summary")) || null });
        request = retainImplementationReport(localStorage, { ...scope, schemaVersion: 1, versionNumber: props.versionNumber,
          savedAt: new Date().toISOString(), commandText: JSON.stringify(command) });
        read();
      }
      const result = await sendImplementationReport(localStorage, request, fetch, abort.signal);
      if (current !== generation.current || abort.signal.aborted) return;
      setReportId(result.reportId);
      setNotice(`The implementation report for adopted edition ${request.versionNumber} is saved. Recorded statuses do not certify that work occurred.`);
      if (formElement && form) resetUnchangedPlanForm(formElement, form);
      acknowledgeImplementationReport(localStorage, request); read();
      setRefreshRequired(true);
      try { await props.onRefresh(); if (current === generation.current) setRefreshRequired(false); }
      catch { if (current === generation.current) setError("The report is confirmed, but the plan view could not refresh. Reload the plan before editing."); }
    } catch (caught) {
      if (current === generation.current && !abort.signal.aborted) setError(caught instanceof Error ? caught.message : "The report is unconfirmed. Keep the saved request.");
    } finally {
      if (current === generation.current) { active.current = false; setBusy(false); read(); }
    }
  }

  async function preserve(record: ImplementationReportRecoveryRecord) {
    if (active.current) return;
    active.current = true; setBusy(true);
    const current = generation.current;
    try {
      preserveImplementationReport(localStorage, scope, record); read(); setError(null);
      setNotice("The request copy is preserved in this browser. This does not cancel or undo a report. Review the current plan before starting another request.");
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
    catch { if (current === generation.current) setError("The current plan could not be read. Reload before starting another report."); }
    finally { if (current === generation.current) { active.current = false; setBusy(false); } }
  }
  function restore(raw: string) {
    try { restoreImplementationReport(localStorage, scope, raw); read(); setError(null); setNotice("The request is restored. Nothing has been sent."); }
    catch { setError("This copy could not be restored for the current account and plan. Keep the original file."); }
  }

  return <div className="mt-3 space-y-3">
    {props.adopted ? <form className="grid gap-3 md:grid-cols-2" onSubmit={event => { event.preventDefault(); void send(undefined, event.currentTarget); }}>
      <p className="text-sm text-muted-foreground md:col-span-2">Capture the saved implementation statuses for adopted edition {props.versionNumber}. This does not certify completion of agency work.</p>
      <p className="break-all text-xs text-muted-foreground md:col-span-2">Adopted content hash: {props.contentHash}</p>
      <label className="block text-sm">Reporting period start<Input className="mt-1" name="start" required type="date" /></label>
      <label className="block text-sm">Reporting period end<Input className="mt-1" name="end" required type="date" /></label>
      <label className="block text-sm md:col-span-2">Implementation report title<Input className="mt-1" name="title" required maxLength={180} /></label>
      <label className="block text-sm md:col-span-2">Summary<Textarea className="mt-1" name="summary" maxLength={20000} /></label>
      <Button className="h-auto min-h-10 max-w-full whitespace-normal md:col-span-2" disabled={busy || refreshRequired || !ready || !props.canWrite || props.disabled || pending.length > 0}>Generate frozen implementation report</Button>
    </form> : <p className="text-sm text-muted-foreground">Open the current adopted edition to create an implementation report. Earlier requests remain available for recovery below.</p>}
    {reportId ? <a className="block text-sm underline" href={`/reports/${reportId}`}>Open saved implementation report</a> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {refreshRequired ? <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => void refreshCurrentPlan()}>Refresh current plan</Button> : null}
    {!ready ? <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={read} disabled={busy}>Read saved requests again</Button> : null}
    {pending.length > 0 ? <div className="space-y-3 border-l-2 border-amber-500 pl-4">
      <h3 className="font-semibold">Unconfirmed report requests</h3>
      <p className="max-w-prose text-sm text-muted-foreground">Retry uses the original saved request. It may create a report for that adopted edition if the first request did not arrive. It captures saved action statuses when the transaction runs. A changed adopted edition causes a conflict.</p>
      {pending.map(record => <div key={record.key} className="space-y-2">
        <p className="text-sm">{record.pending ? `Saved request for edition ${record.pending.versionNumber}` : "Unreadable saved request. Preserve a copy before reviewing the current edition."}</p>
        <div className="flex flex-wrap gap-2">
          {record.pending ? <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy || !props.canWrite} onClick={() => { if (record.pending) void send(record.pending); }}>Check or retry saved report</Button> : null}
          <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => downloadCopy(record.raw)}>Download request copy</Button>
          <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => void preserve(record)}>Preserve copy and review current edition</Button>
        </div>
      </div>)}
    </div> : null}
    <details className="text-sm">
      <summary className="cursor-pointer">Report request recovery{copies.length ? ` (${copies.length} preserved)` : ""}</summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-prose text-muted-foreground">Restoring a copy only adds it to the saved requests in this browser. It does not send, cancel or approve a report.</p>
        <label className="block">Restore a saved request file<input className="mt-2 block w-full text-sm" type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          if (file.size > IMPLEMENTATION_REPORT_RECOVERY_LIMIT) { setError("This file is larger than a report request."); return; }
          const current = generation.current;
          void file.text().then(raw => { if (current === generation.current) restore(raw); }).catch(() => { if (current === generation.current) setError("The request file could not be read. Keep the original file."); });
        }} /></label>
        {copies.map(record => <div key={record.key} className="flex flex-wrap items-center gap-2">
          <span>{record.pending ? `Preserved request for edition ${record.pending.versionNumber}` : "Preserved unreadable request"}</span>
          <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => downloadCopy(record.raw)}>Download copy</Button>
          {record.pending ? <Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => restore(record.raw)}>Restore saved request</Button> : null}
        </div>)}
      </div>
    </details>
  </div>;
}
