"use client";
import { useCallback, useEffect, useState } from "react";
import { CloseoutReview } from "./closeout-review";
import { CloseoutPanel } from "./closeout-panel";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "./fields";
import { downloadAuthenticatedArtifact } from "@/lib/export/download";
import { reimbursementTotals, type ReimbursementClaim, type ReimbursementCommand, type ReimbursementDraft, type ReimbursementEvent } from "@/lib/programs/work-program/reimbursement";
import type { PeriodReport } from "@/lib/programs/work-program/reporting";
type Data = { claims: ReimbursementClaim[]; reports: PeriodReport[]; events: ReimbursementEvent[] };
const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal";
const blank = (): ReimbursementClaim => ({ id: crypto.randomUUID(), version: 0, state: "draft", current_report_id: null, draft: { reportId: "", title: "", authorityEvidence: "", formEvidence: "", costs: [] } });
export function ReimbursementPanel({ programId, userId, reports }: { programId: string; userId: string; reports: PeriodReport[] }) {
 const [historyAvailable, setHistoryAvailable] = useState(false);
 const [data, setData] = useState<Data>({ claims: [], reports: [], events: [] });
 const [claim, setClaim] = useState<ReimbursementClaim>(blank), [note, setNote] = useState(""), [message, setMessage] = useState("");
 const [busy, setBusy] = useState(false), [pending, setPending] = useState<ReimbursementCommand | null>(null);
 const [files, setFiles] = useState<Record<string, { status: string; document?: { id: string; checksum: string | null }; error?: string }>>({});
 const url = `/api/programs/${programId}/work-program/reimbursement`, key = `owp-reimbursement-pending:${userId}:${programId}`;
 const load = useCallback(async () => { setHistoryAvailable(false); const response = await fetch(url, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); setHistoryAvailable(true); return body as Data; }, [url]);
 useEffect(() => { void load().catch(e => setMessage(e.message)); try { const raw = localStorage.getItem(key); if (raw) setPending(JSON.parse(raw)); } catch { setMessage("Pending request could not be read; the local recovery text remains retained."); } }, [key, load]);
 async function save(command: ReimbursementCommand) {
  setBusy(true); setMessage("");
  try {
   localStorage.setItem(key, JSON.stringify(command)); setPending(command);
   const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
   const body = await response.json();
   if (!response.ok) { if (response.status < 500) { localStorage.removeItem(key); setPending(null); } throw new Error(body.error); }
   localStorage.removeItem(key); setPending(null);
   setClaim(c => ({ ...c, id: body.claimId, version: body.version, state: body.state, current_report_id: body.reportId }));
   setMessage("Saved. Packet history and source reservations are retained."); setNote("");
   try { const updated = await load(); const saved = updated.claims.find(c => c.id === body.claimId); if (saved) setClaim(saved); } catch { setMessage("Save succeeded. Reload packet history to see its retained version."); }
  } catch (e) { setMessage(e instanceof Error ? e.message : "Save could not be confirmed. Retry the retained request."); }
  finally { setBusy(false); }
 }
 const report = reports.find(r => r.id === claim.draft.reportId);
 const frozen = data.reports.find(r => r.id === claim.current_report_id);
 const editable = ["draft", "returned"].includes(claim.state);
 const dirty = claim.version > 0 && JSON.stringify(data.claims.find(c => c.id === claim.id)?.draft) !== JSON.stringify(claim.draft);
 const draft = (change: Partial<ReimbursementDraft>) => setClaim(c => ({ ...c, draft: { ...c.draft, ...change } }));
 const cost = (index: number, change: Partial<ReimbursementDraft["costs"][number]>) => draft({ costs: claim.draft.costs.map((c, i) => i === index ? { ...c, ...change } : c) });
 let totals: ReturnType<typeof reimbursementTotals> | null = null, problem = "Select an issued management report.";
 try { if (report) { totals = reimbursementTotals(claim.draft, report); problem = ""; } } catch (e) { problem = e instanceof Error && e.message !== "Invalid exact decimal" ? e.message : "Enter eligible cost and funding share amounts with at most two decimal places."; }
 async function artifact(reportId: string, format: "pdf" | "xlsx", queue: boolean) {
  const fileKey = `${reportId}:${format}`, fileUrl = `/api/programs/${programId}/work-program/reporting/reports?reportId=${reportId}&format=${format}`;
  try {
   if (queue) { const response = await fetch(fileUrl, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); }
   const response = await fetch(fileUrl); const body = await response.json(); if (!response.ok) throw new Error(body.error); setFiles(f => ({ ...f, [fileKey]: body }));
  } catch (e) { setFiles(f => ({ ...f, [fileKey]: { status: "unavailable", error: e instanceof Error ? e.message : "File unavailable" } })); }
 }
 return <><section id="reimbursement-packets" className="space-y-5 rounded-xl border p-4 min-w-0">
  <h2 className="text-xl font-semibold">Reimbursement packets</h2>
  <p className="text-sm">Connect an issued period report to reviewed eligibility and funding shares. Private cost records are restricted to owners and administrators. Recording an external receipt does not send a packet or record a payment.</p>
  <div className="flex flex-wrap gap-2">{data.claims.map(c => <Button className={buttonClass} variant="outline" key={c.id} disabled={busy || !!pending} onClick={() => { setClaim(c); setNote(""); }}>{c.draft.title} · {c.state}</Button>)}<Button className={buttonClass} variant="outline" disabled={busy || !!pending} onClick={() => setClaim(blank())}>New reimbursement packet</Button><Button className={buttonClass} variant="outline" onClick={() => void load().catch(e => setMessage(e.message))}>Reload packet history</Button></div>
  {message && <p role="status" className="rounded-lg border p-3">{message}</p>}
  {pending && <div role="alert"><p>A save may have reached the server. Retry its retained request before another action.</p><Button className={buttonClass} disabled={busy} onClick={() => save(pending)}>Retry packet save</Button></div>}
  <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save({ kind: "save", requestId: crypto.randomUUID(), claimId: claim.id, expectedVersion: claim.version, draft: claim.draft }); }}>
   <fieldset disabled={!editable || busy || !!pending} className="space-y-4 min-w-0">
    <Field label="Packet title" value={claim.draft.title} onChange={title => draft({ title })}/>
    <SelectField label="Issued source report" value={claim.draft.reportId} onChange={reportId => {
     const source = reports.find(r => r.id === reportId);
     draft({ reportId, costs: source?.snapshot.actuals.filter(a => a.status === "approved" && ["labor", "expense"].includes(a.kind) && a.entry_date >= source.snapshot.period.starts_on && a.entry_date <= source.snapshot.period.ends_on).map(a => ({ actualVersionId: a.id, eligibleAmount: "", eligibilityEvidence: "", shares: [] })) ?? [] });
    }}><option value="">Select an issued period report</option>{reports.map(r => <option key={r.id} value={r.id}>{r.snapshot.period.name} · report version {r.version}</option>)}</SelectField>
    <Field label="Reviewed funding authority and agreement evidence" multiline value={claim.draft.authorityEvidence} onChange={authorityEvidence => draft({ authorityEvidence })}/>
    <Field label="Prescribed forms, versions and supporting packet requirements reviewed" multiline value={claim.draft.formEvidence} onChange={formEvidence => draft({ formEvidence })}/>
    <p className="text-sm">Enter references to the applicable agreement, approved allocation and required forms. This export is a supporting packet; exact agency form compatibility must be reviewed. Record zero eligibility with the reason for excluded costs. All eligible cost must be assigned to reimbursement or match.</p>
    {claim.draft.costs.map((c, i) => { const actual = report?.snapshot.actuals.find(a => a.id === c.actualVersionId); return <div key={c.actualVersionId} className="space-y-3 rounded-lg border p-3 min-w-0">
     <h3 className="font-semibold break-words">{actual?.source_key ?? c.actualVersionId}</h3><p className="text-sm">{actual?.entry_date} · {actual?.kind} · source cost {actual?.amount ?? "Unvalued"}</p><p className="text-sm break-words">{actual?.detail.sourceReference}</p>
     <Field label={`Eligible cost ${i + 1}`} value={c.eligibleAmount} onChange={eligibleAmount => cost(i, { eligibleAmount })}/><Field label={`Eligibility evidence ${i + 1}`} multiline value={c.eligibilityEvidence} onChange={eligibilityEvidence => cost(i, { eligibilityEvidence })}/>
     {c.shares.map((s, j) => { const edit = (change: Partial<typeof s>) => cost(i, { shares: c.shares.map((v, n) => n === j ? { ...v, ...change } : v) }); return <div key={j} className="space-y-3 rounded-lg border p-3 min-w-0"><SelectField label={`Fund ${i + 1}.${j + 1}`} value={s.fundId} onChange={fundId => edit({ fundId })}><option value="">Select baseline fund</option>{report?.snapshot.baseline.content_json.preparation?.funds.map(f => <option key={f.id} value={f.id}>{f.name} · {f.vintage}</option>)}</SelectField><SelectField label={`Share treatment ${i + 1}.${j + 1}`} value={s.treatment} onChange={treatment => edit({ treatment: treatment as typeof s.treatment })}><option value="reimbursement">Reimbursement requested</option><option value="match">Match contribution</option></SelectField><Field label={`Share amount ${i + 1}.${j + 1}`} value={s.amount} onChange={amount => edit({ amount })}/><Field label={`Share evidence ${i + 1}.${j + 1}`} multiline value={s.evidence} onChange={evidence => edit({ evidence })}/><Button type="button" className={buttonClass} variant="outline" onClick={() => cost(i, { shares: c.shares.filter((_, n) => n !== j) })}>Remove funding share {i + 1}.{j + 1}</Button></div>; })}
     <Button type="button" className={buttonClass} variant="outline" onClick={() => cost(i, { shares: [...c.shares, { fundId: "", amount: "", treatment: "reimbursement", evidence: "" }] })}>Add funding share for cost {i + 1}</Button>
    </div>; })}
    {totals ? <p>Source costs {totals.totalCost}; eligible {totals.eligibleTotal}; reimbursement {totals.reimbursementTotal}; match {totals.matchTotal}. {report?.snapshot.baseline.content_json.currency}</p> : <p className="text-sm">{problem}</p>}
    <Button type="submit" className={buttonClass}>Save packet draft</Button>
   </fieldset>
  </form>
  {report && <details><summary>Source report progress and remaining work</summary>{report.snapshot.period.progress.map((p, i) => <div key={i} className="space-y-1 border-b py-3 text-sm"><p>{report.snapshot.baseline.content_json.elements.find(e => e.id === p.elementId)?.title} · {p.asOf}</p><p>Completed products: {p.completed || "Unassessed"}</p><p>Remaining work: {p.outstanding || "Unassessed"}</p><p>Remaining hours: {p.remainingHours ?? "Unknown"}; cost: {p.remainingCost ?? "Unknown"}. {p.estimateBasis}</p><p>{p.issues}</p></div>)}<p className="text-sm">Correct progress in the period report, then issue and select the corrected report here.</p></details>}
  {claim.version > 0 && <div className="space-y-3"><p>Current packet state: {claim.state}. Saved command version {claim.version}.</p><Field label="Packet review or external receipt evidence" multiline value={note} onChange={setNote}/>{dirty && <p role="alert">Save the changed draft before reviewing it.</p>}<div className="flex flex-wrap gap-2">{([ ["review", "Freeze reviewed reimbursement packet", claim.state === "draft"], ["submit", "Record external submission receipt", claim.state === "reviewed"], ["return", "Record return for correction", ["reviewed", "submitted"].includes(claim.state)], ["accept", "Record external acceptance evidence", claim.state === "submitted"] ] as const).filter(([, , available]) => available).map(([kind, label]) => <Button key={kind} className={buttonClass} disabled={busy || !!pending || dirty || !note.trim()} onClick={() => save({ kind, requestId: crypto.randomUUID(), claimId: claim.id, expectedVersion: claim.version, note })}>{label}</Button>)}</div></div>}
  {frozen && <p>Current reviewed request: {frozen.snapshot.reimbursement?.reimbursementTotal} {frozen.snapshot.baseline.content_json.currency}. Earlier packet versions are retained history and are not added to this amount.</p>}
  <h3 className="font-semibold">Retained packets and receipts</h3>
  {data.reports.filter(r => r.snapshot.reimbursement?.claimId === claim.id).sort((a, b) => a.version - b.version).map(r => <div className="space-y-3 rounded-lg border p-3" key={r.id}><p>Packet version {r.snapshot.reimbursement!.packetVersion} · {r.id === claim.current_report_id ? "Current retained packet" : "Prior packet"} · requested {r.snapshot.reimbursement!.reimbursementTotal}</p><p className="break-all text-xs">SHA256 {r.snapshot_hash}</p><div className="flex flex-wrap gap-3">{(["pdf", "xlsx"] as const).map(format => { const f = files[`${r.id}:${format}`]; return <div key={format} className="space-y-2"><Button className={buttonClass} variant="outline" onClick={() => artifact(r.id, format, true)}>Prepare packet {format.toUpperCase()}</Button><Button className={buttonClass} variant="ghost" onClick={() => artifact(r.id, format, false)}>Check packet {format.toUpperCase()}</Button>{f && <p role="status">{f.status} {f.error}</p>}{f?.document?.checksum && <Button className={`${buttonClass} hover:bg-background hover:text-foreground`} variant="outline" onClick={async () => { try { await downloadAuthenticatedArtifact(`/api/knowledge-base/documents/${f.document!.id}/download?delivery=authenticated`, `reimbursement-${claim.id}-v${r.snapshot.reimbursement!.packetVersion}.${format}`, f.document!.checksum!); } catch (e) { setMessage(e instanceof Error ? e.message : "Download failed"); } }}>Download packet {format.toUpperCase()}</Button>}</div>; })}</div></div>)}
  {data.events.filter(e => e.claim_id === claim.id).sort((a, b) => a.sequence - b.sequence).map(e => <p key={e.id} className="text-sm break-words">{e.sequence}. {e.kind} · {e.created_at} · {e.note}</p>)}
 </section><CloseoutReview reports={reports} history={historyAvailable ? data : null}/><CloseoutPanel programId={programId} userId={userId} reports={reports}/></>;
}
