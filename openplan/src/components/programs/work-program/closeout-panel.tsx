"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/export/download";
import { closeoutRefundBalance, closeoutClaimBalance, closeoutCommandSchema, initialCloseoutAssessment, type CloseoutAssessment, type CloseoutCommand, type CloseoutData } from "@/lib/programs/work-program/closeout";
import type { PeriodReport } from "@/lib/programs/work-program/reporting";
import { Field, SelectField } from "./fields";

const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal hover:bg-background hover:text-foreground";
export function CloseoutPanel({ programId, userId, reports }: { programId: string; userId: string; reports: PeriodReport[] }) {
  const [reportId, setReportId] = useState(""), [data, setData] = useState<CloseoutData | null>(null);
  const [assessment, setAssessment] = useState<CloseoutAssessment | null>(null), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [pending, setPending] = useState<CloseoutCommand | null>(null);
  const url = `/api/programs/${programId}/work-program/closeout`, recoveryKey = `owp-closeout-pending:${userId}:${programId}`;
  const load = useCallback(async (selected: string) => {
    setData(null);
    if (!selected) { setAssessment(null); return; }
    const response = await fetch(`${url}?reportId=${selected}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const loaded = body as CloseoutData, latest = loaded.records.at(-1);
    setData(loaded);
    setAssessment(latest?.report_id === selected ? latest.content.assessment : initialCloseoutAssessment(loaded.source));
  }, [url]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(recoveryKey);
      if (raw) { const saved = closeoutCommandSchema.parse(JSON.parse(raw)); setPending(saved); setReportId(saved.reportId); }
    } catch { setMessage("Local recovery could not be read. The saved recovery text remains on this device."); }
  }, [recoveryKey]);
  useEffect(() => { let active = true; setBusy(true); void load(reportId).catch(error => { if (active) setMessage(error.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [load, reportId]);
  async function send(command: CloseoutCommand) {
    setBusy(true); setMessage("");
    try {
      localStorage.setItem(recoveryKey, JSON.stringify(command)); setPending(command);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) { localStorage.removeItem(recoveryKey); setPending(null); }
        throw new Error(body.error);
      }
      localStorage.removeItem(recoveryKey); setPending(null); setNote("");
      setMessage(command.kind === "close_period" ? "Accounting period closed. Earlier approvals and open balances remain retained." : command.kind === "reopen_period" ? "Accounting period reopened. Make corrections and obtain a new reconciliation approval before closing again." : `Saved reconciliation version ${body.version}. Earlier versions remain retained.`);
      try { await load(command.reportId); } catch { setMessage("Save succeeded. Reload reconciliation to read the retained version."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save could not be confirmed. Retry the retained request."); }
    finally { setBusy(false); }
  }
  const latest = data?.records.at(-1), approved = latest?.state === "approved" && latest.report_id === reportId;
  const closure = data?.closures?.filter(row => row.period_id === data.source.report.period_id).at(-1), closed = closure?.kind === "close_period";
  const dirty = JSON.stringify(assessment) !== JSON.stringify(latest?.content.assessment);
  const base = () => ({ requestId: crypto.randomUUID(), reportId, expectedVersion: latest?.version ?? 0, sourceHash: data!.sourceHash });
  const claimChange = (index: number, change: Partial<CloseoutAssessment["claims"][number]>) => setAssessment(current => current && ({ ...current, claims: current.claims.map((row, i) => i === index ? { ...row, ...change } : row) }));
  const workChange = (index: number, change: Partial<CloseoutAssessment["work"][number]>) => setAssessment(current => current && ({ ...current, work: current.work.map((row, i) => i === index ? { ...row, ...change } : row) }));
  return <section id="closeout-reconciliation" className="min-w-0 space-y-4 rounded-xl border p-4">
    <h2 className="text-xl font-semibold">Saved closeout reconciliation</h2>
    <p className="text-sm">Reconcile receipts, commitments and refunds, then retain approval evidence for unfinished work carried into an adopted successor cycle. Approval retains the reconciliation. Period closure below protects its accounting sources. Neither action posts costs. Missing amounts remain unknown.</p>
    <fieldset disabled={busy || !!pending} className="min-w-0"><SelectField label="Reconciliation source report" value={reportId} onChange={setReportId}><option value="">Select an issued management report</option>{reports.map(report => <option key={report.id} value={report.id}>{report.snapshot.period.name} · version {report.version}</option>)}</SelectField></fieldset>
    <Button className={buttonClass} variant="outline" disabled={busy || !reportId} onClick={() => { setBusy(true); setMessage(""); void load(reportId).catch(error => setMessage(error.message)).finally(() => setBusy(false)); }}>Reload reconciliation</Button>
    {message && <p role="status" className="break-words rounded-lg border p-3">{message}</p>}
    {pending && <div role="alert" className="space-y-2"><p>A save may have reached the server. Retry its retained request before another action.</p><Button className={buttonClass} disabled={busy} onClick={() => send(pending)}>Retry reconciliation save</Button></div>}
    {data && assessment && <>
      <p>Baseline revision {data.source.report.snapshot.baseline.revision} · {data.source.report.snapshot.baseline.content_json.currency}. Report through {data.source.report.snapshot.period.ends_on}. {latest ? `Latest reconciliation: version ${latest.version}, ${latest.state}.` : "No reconciliation saved yet."}</p>
      {data.source.report.snapshot.period.ends_on !== data.source.report.snapshot.baseline.content_json.periodEnd && <p role="status">This is an interim reconciliation. The report does not reach the cycle end.</p>}
      {latest && latest.source_hash !== data.sourceHash && <p role="status">Sources changed since the retained reconciliation. Its approval applies to the saved evidence only. Reopen if approved, reconcile again and save a new version.</p>}
      <form onSubmit={event => { event.preventDefault(); void send({ ...base(), kind: "save", assessment }); }}>
        <fieldset disabled={busy || !!pending || approved || closed} className="min-w-0 space-y-4">
          <Field label="Register completeness and reconciliation evidence" multiline value={assessment.registerEvidence} onChange={registerEvidence => setAssessment({ ...assessment, registerEvidence })}/>
          <h3 className="font-semibold">Claim receipts and refunds</h3>
          {!assessment.claims.length && <p>No claims in this baseline. Document whether the external claim register is complete above.</p>}
          {assessment.claims.map((row, index) => {
            const claim = data.source.reimbursement.claims.find(candidate => candidate.id === row.claimId)!;
            let balance: string | null = null, refundBalance: string | null = null;
            try { balance = closeoutClaimBalance(data.source, row.claimId, assessment); refundBalance = closeoutRefundBalance(row); } catch { /* Incomplete amount input stays unknown. */ }
            return <article key={row.claimId} className="min-w-0 space-y-3 rounded-lg border p-3">
              <h4 className="font-semibold break-words">{claim.draft.title} · {claim.state}</h4>
              <p>Requested less matched receipts: {balance ?? "Unknown"}. A negative balance identifies overpayment; refunds are assessed separately.</p>
              {row.receipts.map((receipt, receiptIndex) => <div key={receiptIndex} className="space-y-2">
                <SelectField label={`Claim ${index + 1} receipt ${receiptIndex + 1}`} value={receipt.actualVersionId} onChange={actualVersionId => claimChange(index, { receipts: row.receipts.map((r, i) => i === receiptIndex ? { ...r, actualVersionId } : r) })}><option value="">Select an approved payment</option>{data.source.actuals.filter(a => a.kind === "payment" && a.status === "approved" && a.currency === data.source.report.snapshot.baseline.content_json.currency).map(a => <option key={a.id} value={a.id}>{a.entry_date} · {a.source_key} · {a.amount ?? "Unvalued"}</option>)}</SelectField>
                <Field label={`Claim ${index + 1} receipt ${receiptIndex + 1} amount`} value={receipt.amount} onChange={amount => claimChange(index, { receipts: row.receipts.map((r, i) => i === receiptIndex ? { ...r, amount } : r) })}/>
                <Button type="button" className={buttonClass} variant="outline" onClick={() => claimChange(index, { receipts: row.receipts.filter((_, i) => i !== receiptIndex) })}>Remove receipt {receiptIndex + 1} from claim {index + 1}</Button>
              </div>)}
              <Button type="button" className={buttonClass} variant="outline" onClick={() => claimChange(index, { receipts: [...row.receipts, { actualVersionId: "", amount: "" }] })}>Match receipt to claim {index + 1}</Button>
              <Field label={`Claim ${index + 1} refund due (blank means unknown)`} value={row.refundDue ?? ""} onChange={refundDue => claimChange(index, { refundDue: refundDue || null })}/>
              <p>Assessed refund less matched outbound payments: {refundBalance ?? "Unknown"}. A negative balance identifies excess refund payment.</p>
              <p className="text-sm">Match an existing approved payment only after checking its outgoing bank or accounting reference. Explain the recipient, payment direction and reconciliation in the evidence below. Payment totals in management reports remain gross amounts, not net cash.</p>
              {(row.refundPayments ?? []).map((payment, paymentIndex) => <div key={paymentIndex} className="space-y-2">
                <SelectField label={`Claim ${index + 1} refund payment ${paymentIndex + 1}`} value={payment.actualVersionId} onChange={actualVersionId => claimChange(index, { refundPayments: (row.refundPayments ?? []).map((r, i) => i === paymentIndex ? { ...r, actualVersionId } : r) })}><option value="">Select an approved outgoing payment</option>{data.source.actuals.filter(a => a.kind === "payment" && a.status === "approved" && a.currency === data.source.report.snapshot.baseline.content_json.currency).map(a => <option key={a.id} value={a.id}>{a.entry_date} · {a.source_key} · {a.amount ?? "Unvalued"}</option>)}</SelectField>
                <Field label={`Claim ${index + 1} refund payment ${paymentIndex + 1} amount`} value={payment.amount} onChange={amount => claimChange(index, { refundPayments: (row.refundPayments ?? []).map((r, i) => i === paymentIndex ? { ...r, amount } : r) })}/>
                <Button type="button" className={buttonClass} variant="outline" onClick={() => claimChange(index, { refundPayments: (row.refundPayments ?? []).filter((_, i) => i !== paymentIndex) })}>Remove refund payment {paymentIndex + 1} from claim {index + 1}</Button>
              </div>)}
              <Button type="button" className={buttonClass} variant="outline" onClick={() => claimChange(index, { refundPayments: [...(row.refundPayments ?? []), { actualVersionId: "", amount: "" }] })}>Match refund payment to claim {index + 1}</Button>
              <Field label={`Claim ${index + 1} reconciliation evidence`} multiline value={row.evidence} onChange={evidence => claimChange(index, { evidence })}/>
            </article>;
          })}
          <h3 className="font-semibold">Outstanding commitments</h3>
          {!assessment.commitments.length && <p>No approved commitments in this report. External and later obligations still require the register review.</p>}
          {assessment.commitments.map((row, index) => <article key={row.actualVersionId} className="space-y-3 rounded-lg border p-3">
            <p>{data.source.report.snapshot.actuals.find(a => a.id === row.actualVersionId)?.source_key}</p>
            <Field label={`Commitment ${index + 1} outstanding amount (blank means unknown)`} value={row.outstandingAmount ?? ""} onChange={value => setAssessment({ ...assessment, commitments: assessment.commitments.map((c, i) => i === index ? { ...c, outstandingAmount: value || null } : c) })}/>
            <Field label={`Commitment ${index + 1} discharge and remaining obligation evidence`} multiline value={row.evidence} onChange={evidence => setAssessment({ ...assessment, commitments: assessment.commitments.map((c, i) => i === index ? { ...c, evidence } : c) })}/>
          </article>)}
          <h3 className="font-semibold">Completion and next-cycle carryover</h3>
          <p>Amounts describe reviewed carryover authority, not a calculation of available cash. Create and adopt the successor cycle through Programming Cycles first. Fund periods, conditions and external approval must be checked in the evidence. Reopening keeps the previous approved carryover reserved until a replacement is approved.</p>
          {assessment.work.map((row, index) => {
            const target = data.source.successors.find(b => b.id === row.successorRevisionId);
            return <article key={row.elementId} className="min-w-0 space-y-3 rounded-lg border p-3">
              <h4 className="font-semibold">{data.source.report.snapshot.baseline.content_json.elements.find(e => e.id === row.elementId)?.title}</h4>
              <SelectField label={`Work ${index + 1} disposition`} value={row.disposition} onChange={value => workChange(index, { disposition: value as typeof row.disposition, successorRevisionId: null, successorElementId: null, sourceFundId: null, successorFundId: null, amount: null })}><option value="unassessed">Unassessed</option><option value="completed">Completed</option><option value="carryover">Carry into successor</option></SelectField>
              {row.disposition === "carryover" && <>
                <SelectField label={`Work ${index + 1} successor baseline`} value={row.successorRevisionId ?? ""} onChange={successorRevisionId => workChange(index, { successorRevisionId: successorRevisionId || null, successorElementId: null, successorFundId: null })}><option value="">Select an adopted successor</option>{data.source.successors.map(b => <option key={b.id} value={b.id}>{b.title} · {b.content_json.periodStart} to {b.content_json.periodEnd} · revision {b.revision}</option>)}</SelectField>
                <SelectField label={`Work ${index + 1} successor element`} value={row.successorElementId ?? ""} onChange={value => workChange(index, { successorElementId: value || null })}><option value="">Select successor work</option>{target?.content_json.elements.map(e => <option key={e.id} value={e.id}>{e.code} {e.title}</option>)}</SelectField>
                <SelectField label={`Work ${index + 1} source fund`} value={row.sourceFundId ?? ""} onChange={value => workChange(index, { sourceFundId: value || null })}><option value="">Select source funding</option>{data.source.report.snapshot.baseline.content_json.preparation?.funds.map(f => <option key={f.id} value={f.id}>{f.name} · {f.vintage}</option>)}</SelectField>
                <SelectField label={`Work ${index + 1} successor fund`} value={row.successorFundId ?? ""} onChange={value => workChange(index, { successorFundId: value || null })}><option value="">Select successor carryover funding</option>{target?.content_json.preparation?.funds.filter(f => f.kind === "carryover").map(f => <option key={f.id} value={f.id}>{f.name} · {f.vintage}</option>)}</SelectField>
                <Field label={`Work ${index + 1} carryover amount`} value={row.amount ?? ""} onChange={value => workChange(index, { amount: value || null })}/>
              </>}
              <Field label={`Work ${index + 1} completion or carryover approval evidence`} multiline value={row.evidence} onChange={evidence => workChange(index, { evidence })}/>
            </article>;
          })}
          <Button className={buttonClass} variant="outline" type="submit">Save reconciliation draft</Button>
        </fieldset>
      </form>
      <Field label="Reconciliation approval or reopening evidence" multiline value={note} onChange={setNote}/>
      <Button className={buttonClass} variant="outline" disabled={busy || !!pending || closed || !note.trim() || (!approved && (!latest || dirty || latest.source_hash !== data.sourceHash))} onClick={() => send({ ...base(), kind: approved ? "reopen" : "approve", note })}>{approved ? "Reopen approved reconciliation" : "Save reconciliation approval"}</Button>
      <section aria-label="Accounting period closure" className="space-y-3 rounded-lg border p-3">
        <h3 className="font-semibold">Accounting period closure</h3>
        <p>{closed ? `Closed from ${closure.starts_on} through ${closure.ends_on}. Reopen this accounting period before correcting its sources or reconciliation.` : `Open. Closing protects cumulative accounting from ${data.source.report.snapshot.baseline.content_json.periodStart} through ${data.source.report.snapshot.period.ends_on}, including linked receipts, refunds and claims.`}</p>
        <p>Outstanding claims, commitments and refunds remain visible. Closure does not mean payment or funder acceptance. Use the evidence field above to identify the responsible authority and explain the decision. Later-period work remains available.</p>
        <Button className={buttonClass} variant="outline" disabled={busy || !!pending || !note.trim() || (!closed && (!approved || dirty || latest?.report_id !== reportId || latest?.source_hash !== data.sourceHash))}
          onClick={() => send({ ...base(), kind: closed ? "reopen_period" : "close_period", expectedClosureVersion: data.closures?.at(-1)?.version ?? 0, note })}>
          {closed ? "Reopen accounting period" : "Close accounting period"}
        </Button>
        {data.closures?.map(row => <article key={row.id} className="space-y-2 border-t pt-3 text-sm">
          <p>Period decision {row.version} · {row.kind === "close_period" ? "Closed" : "Reopened"} · {row.starts_on} to {row.ends_on}</p>
          <p className="break-words">{row.content.note}</p>
          <Button className={buttonClass} variant="outline" onClick={() => downloadText(JSON.stringify(row, null, 2), `owp-period-decision-${row.version}-${row.id}.json`, "application/json")}>Save period decision {row.version} JSON</Button>
        </article>)}
      </section>
      <h3 className="font-semibold">Retained reconciliation history</h3>
      {data.records.map(record => <article key={record.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <p>Version {record.version} · {record.state} · {record.created_at}</p><p className="break-words">{record.content.note}</p>
        <p className="break-all text-xs">SHA256 {record.content_hash}</p>
        <Button className={buttonClass} variant="outline" onClick={() => downloadText(JSON.stringify(record, null, 2), `owp-reconciliation-v${record.version}-${record.id}.json`, "application/json")}>Save reconciliation version {record.version} JSON</Button>
      </article>)}
    </>}
  </section>;
}
