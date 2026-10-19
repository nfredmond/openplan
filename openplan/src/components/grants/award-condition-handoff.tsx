"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { serializeHandoffApply, awardTermsSchema, type AwardTerms, type AwardOccurrence } from "@/lib/grants/award-handoff";

type Revision = { id: string; sequence: number; proposal: unknown; terms: AwardTerms; receipt: unknown; created_at: string };
type History = { legacyObligations:Array<{id:string;title:string;status:string;actual_date:string|null;assignee_user_id:string|null;notes:string|null}>; issuance?:{source_backed_award_count:number|string;award_ids:string[]}|null; award: { id:string; project_id:string; current_handoff_revision_id: string | null; latest_handoff_revision_id: string | null; has_source_backed_issuance: boolean }; application:unknown; history: Revision[]; occurrences: Array<{ id: string; requirement: AwardOccurrence; submittal_id: string | null; milestone_id: string | null; submittal_status:string|null;submitted_at:string|null;fulfillment_evidence:string|null;milestone_status:string|null;actual_date:string|null }>; invoices:Array<{id:string;invoice_number:string;award_handoff_revision_id:string|null;currency_code:string|null;status:string}>; sourceLimits: string };
type Review = { reviewed: Record<string, unknown>; reviewHash: string };
const unknown = "Not recorded; unresolved";
const emptyTerms: AwardTerms = {
  ceiling: "", match: "", currency: { code: "", minorUnits: 2, source: "" }, issued: true, issuanceDisposition:{state:"issued",evidence:"",priorRevisionId:null},
  recipient: "", funder: "", scope: "", differences: "", commitments: "", applicability: unknown,
  submissionReceipt: unknown, scheduleCoverage: "Further dates unresolved",
  acceptance: "not_recorded", acceptanceEvidence: unknown, acceptanceSourceId:null,
  authorization: { state: "not_recorded", amount: null, amountCurrencyCode:null, unknownReason: "Authorization amount not recorded", sourceId:null, authority: unknown, scope: unknown, period: unknown, evidence: unknown },
  effective: false, effectiveEvidence: "", sources: [], noticeSourceId: "", occurrences: [], invoiceApplicability: [],
};
function Field({ label, value, change, multiline = false }: { label: string; value: string; change: (v: string) => void; multiline?: boolean }) {
  return <label className="grid gap-1 text-sm"><span>{label}</span>{multiline ? <Textarea value={value} onChange={(e) => change(e.target.value)} /> : <Input value={value} onChange={(e) => change(e.target.value)} />}</label>;
}

type HandoffProps = { awardId:string; opportunityId:string; title:string; initiallyOpen?:boolean };
export function AwardConditionHandoff(props:HandoffProps) {
  return <AwardConditionHandoffSession key={JSON.stringify([props.awardId,props.opportunityId])} {...props} />;
}

/** Fresh editing starts with current occurrences, never a pending version's old IDs. */
function editingTerms(data:History):AwardTerms {
  const current = data.history.find((revision) => revision.id === data.award.current_handoff_revision_id);
  if (data.award.current_handoff_revision_id && !current) throw new Error("Current terms are unavailable. Reload before reviewing.");
  const baseline = current ?? data.history.at(-1);
  if (!baseline) return emptyTerms;
  return { ...baseline.terms, effective:false, effectiveEvidence:"", occurrences:current ? data.occurrences.map((occurrence) => ({ ...occurrence.requirement, disposition:"carry", legacyObligationId:null, priorOccurrenceId:occurrence.id, reason:"Unchanged requirement carried from current terms", fulfillmentStillApplies:true })) : baseline.terms.occurrences };
}

/** One pending exact request survives response loss and reload in this tab. */
function AwardConditionHandoffSession({ awardId, opportunityId, title, initiallyOpen = false }: HandoffProps) {
  const router = useRouter(); const [manualOpen, setOpen] = useState<boolean|null>(null); const open=manualOpen??initiallyOpen; const [history, setHistory] = useState<History | null>(null);
  const [terms, setTerms] = useState<AwardTerms>(emptyTerms); const [review, setReview] = useState<Review | null>(null);
  const [key, setKey] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false); const storageKey = `award-handoff-pending:${awardId}`;
  const [recoveryBlocked,setRecoveryBlocked] = useState(false);
  const reviewRef=useRef<Review|null>(null); const active=useRef(false); const initialized=useRef(false); const request=useRef<AbortController|null>(null);
  const retainReview=useCallback((next:Review|null)=>{reviewRef.current=next;setReview(next);},[]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
  useEffect(() => {
    setKey(crypto.randomUUID());
    try {
      const pending=sessionStorage.getItem(storageKey);
      if(pending){
        const restored:Review=JSON.parse(pending); serializeHandoffApply(restored); awardTermsSchema.parse(restored.reviewed.terms);
        if((restored.reviewed.state as {awardId?:string}|undefined)?.awardId!==awardId || restored.reviewed.opportunityId!==opportunityId)throw new Error("Retained review belongs to another selection");
        retainReview(restored);setMessage("A reviewed request is pending. Retry that exact request to recover its receipt.");
      }
    } catch {setRecoveryBlocked(true);setMessage("Pending request cannot be read for this selection. Retain this tab and its stored request before resolving recovery.");}
  },[storageKey,awardId,opportunityId,retainReview]);
  const load=useCallback(async(intent:"initialize"|"refresh"|"rebase"="initialize")=>{
    request.current?.abort(); const controller=new AbortController();request.current=controller;
    setBusy(true);
    if(intent==="rebase"){initialized.current=false;setHistory(null);}
    try {
      const response=await fetch(`/api/funding-awards/${awardId}/handoff?opportunityId=${opportunityId}`,{cache:"no-store",signal:controller.signal}); const data:History & {error?:string}=await response.json();
      if(!active.current || controller.signal.aborted || request.current!==controller)return;
      if(!response.ok)throw new Error(data.error);
      if(data.award.id!==awardId)throw new Error("Award history does not match this selection");
      if(!reviewRef.current && (intent==="rebase" || (intent==="initialize" && !initialized.current))){setTerms(editingTerms(data));initialized.current=true;}
      setHistory(data);
    } catch(error){if(active.current && !controller.signal.aborted && request.current===controller)setMessage(String(error));}
    finally {if(active.current && request.current===controller)setBusy(false);}
  },[awardId,opportunityId]);
  useEffect(()=>{if(initiallyOpen)void load("initialize");},[initiallyOpen,load]);
  async function preview() {
    setBusy(true); setMessage(""); try {
      const parsed = awardTermsSchema.safeParse(terms); if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const response = await fetch(`/api/funding-awards/${awardId}/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "preview", requestKey: key, opportunityId, terms: parsed.data }) });
      const data = await response.json(); if (!active.current) return; if (!response.ok) throw new Error(data.error);
      serializeHandoffApply(data);
      sessionStorage.setItem(storageKey, JSON.stringify(data)); retainReview(data); setConfirmed(false);
    } catch (error) { if(active.current)setMessage(String(error)); } finally { if(active.current)setBusy(false); }
  }
  async function apply() {
    if (!review || !confirmed || recoveryBlocked) return; setBusy(true); try {
      const response = await fetch(`/api/funding-awards/${awardId}/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: serializeHandoffApply(review) });
      const data = await response.json(); if (!active.current) return; if (!response.ok) throw new Error(`${data.error} The exact reviewed request remains retained in this tab.`);
      sessionStorage.removeItem(storageKey); retainReview(null); setConfirmed(false); setKey(crypto.randomUUID()); setMessage(`Recorded revision ${data.receipt.sequence}. Receipt ${data.receipt.revisionId}.`); router.refresh(); await load("rebase");
    } catch (error) { if(active.current)setMessage(String(error)); } finally { if(active.current)setBusy(false); }
  }
  const set = <K extends keyof AwardTerms>(field: K, value: AwardTerms[K]) => setTerms((old) => ({ ...old, [field]: value }));
  return <section className="module-section-surface space-y-4">
    <Button variant="outline" onClick={() => { setOpen(!open); if (!open) void load(); }}>Record award conditions: {title}</Button>
    {open ? <>
      <p className="text-sm">{history?.sourceLimits || "Load the current award history before reviewing terms."}</p>
      {history ? <p className="text-sm">Issuance {history.award.has_source_backed_issuance ? "source-backed" : "unestablished"}. Current terms {history.award.current_handoff_revision_id || "not recorded"}. Latest retained version {history.award.latest_handoff_revision_id || "not recorded"}.</p> : null}
      {history?.issuance?<p className="text-sm">Source-backed issuance across {history.issuance.source_backed_award_count} distinct awards. Pursuit status and recipient acceptance remain separate.</p>:null}
      {history?.occurrences.map((o)=><OccurrenceOutcome key={o.id} occurrence={o} projectId={history.award.project_id} awardId={awardId} onSaved={()=>void load("refresh")}/>)}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-3"><h2 className="font-semibold">Retained proposal and earlier terms</h2>
          {history?.application?<details open><summary>Current application text and recorded editor/provenance</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(history.application,null,2)}</pre></details>:null}
          <p className="text-sm">Current application text does not prove what was submitted. Historical exports and external receipt remain separately qualified.</p>
          {history?.history.map((r) => <details key={r.id}><summary>Revision {r.sequence}, {r.created_at}</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ proposal: r.proposal, terms: r.terms, receipt: r.receipt }, null, 2)}</pre></details>)}
          {!history?.history.length ? <p className="text-sm">The complete current application will appear before you save the handoff.</p> : null}
        </div>
        <fieldset disabled={!!review || busy || !history || recoveryBlocked} className="min-w-0 space-y-3"><legend className="font-semibold">Actual notice terms</legend>
          <Field label="Recorded award ceiling, actual amount" value={String(terms.ceiling)} change={(v) => set("ceiling", v)} />
          <Field label="Actual required match, enter zero explicitly" value={String(terms.match)} change={(v) => set("match", v)} />
          <Field label="Currency code" value={terms.currency.code} change={(v) => set("currency", { ...terms.currency, code: v })} />
          <Field label="Source confirming currency and two-decimal precision" value={terms.currency.source} change={(v) => set("currency", { ...terms.currency, source: v })} />
          {([['recipient','Recipient'],['funder','Funder'],['scope','Awarded scope'],['differences','Differences from proposal, cite the notice even if unchanged'],['commitments','Actual commitments and conditions'],['applicability','Source-specific authorities and unresolved applicability'],['submissionReceipt','External submission/receipt evidence or explicit unresolved qualification'],['scheduleCoverage','Finite schedule coverage or further dates unresolved'],['acceptanceEvidence','Recipient acceptance/decline evidence or not recorded'],['effectiveEvidence','Actual notice version and effective-source basis']] as const).map(([field,label]) => <Field key={field} label={label} value={terms[field]} multiline change={(v) => set(field,v)} />)}
          <label className="grid gap-1 text-sm">Recipient acceptance<select className="module-select" value={terms.acceptance} onChange={(e) => set("acceptance", e.target.value as AwardTerms["acceptance"])}>{['not_recorded','pending','accepted','declined'].map((s) => <option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Spending authorization<select className="module-select" value={terms.authorization.state} onChange={(e) => set("authorization", { ...terms.authorization, state: e.target.value as AwardTerms["authorization"]["state"] })}>{['not_recorded','not_authorized','authorized'].map((s) => <option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
          <Field label="Independently sourced authorization amount, blank means unknown" value={terms.authorization.amount === null ? "" : String(terms.authorization.amount)} change={(v) => set("authorization", { ...terms.authorization, amount: v || null })} />
          <Field label="Authorization amount currency, independently recorded" value={terms.authorization.amountCurrencyCode??''} change={(v)=>set("authorization",{...terms.authorization,amountCurrencyCode:v||null})}/>
          {(['unknownReason','authority','scope','period','evidence'] as const).map((field) => <Field key={field} label={`Authorization ${field}`} value={terms.authorization[field]} change={(v) => set("authorization", { ...terms.authorization, [field]: v })} />)}
          <label className="grid gap-1 text-sm">Current funder disposition<select className="module-select" value={terms.issuanceDisposition.state} onChange={(e)=>set("issuanceDisposition",{...terms.issuanceDisposition,state:e.target.value as AwardTerms['issuanceDisposition']['state']})}>{['issued','rescinded','corrected'].map((s)=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
          <Field label="Disposition provision in this notice/amendment" value={terms.issuanceDisposition.evidence} change={(v)=>set("issuanceDisposition",{...terms.issuanceDisposition,evidence:v})}/>
          {terms.issuanceDisposition.state!=='issued'?<Field label="Earlier retained revision corrected or rescinded" value={terms.issuanceDisposition.priorRevisionId??''} change={(v)=>set("issuanceDisposition",{...terms.issuanceDisposition,priorRevisionId:v||null})}/>:null}
          <NoticeSources terms={terms} change={setTerms} />
          <label className="grid gap-1 text-sm">Recipient acceptance/decline source<select className="module-select" value={terms.acceptanceSourceId??''} onChange={(e)=>set("acceptanceSourceId",e.target.value||null)}><option value="">Not entered</option>{terms.sources.map((source)=><option key={source.id} value={source.id}>{source.version||source.id}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Spending authorization source<select className="module-select" value={terms.authorization.sourceId??''} onChange={(e)=>set("authorization",{...terms.authorization,sourceId:e.target.value||null})}><option value="">Not entered</option>{terms.sources.map((source)=><option key={source.id} value={source.id}>{source.version||source.id}</option>)}</select></label>
          <OccurrenceEditor legacy={history?.legacyObligations??[]} rows={terms.occurrences} change={(v) => set("occurrences",v)} />
          {history?.invoices.length ? <div className="space-y-2"><h3 className="font-semibold">Earlier invoice applicability</h3><p className="text-sm">Original invoice versions stay unchanged. Explicitly carry compatible invoices to the new current version, with a reason. Unknown currency or unbound invoices remain unassessed.</p>{history.invoices.map((invoice)=><div key={invoice.id}><label><input type="checkbox" disabled={!invoice.award_handoff_revision_id || invoice.currency_code!==terms.currency.code} checked={terms.invoiceApplicability.some((i)=>i.invoiceId===invoice.id)} onChange={(e)=>set("invoiceApplicability",e.target.checked?[...terms.invoiceApplicability,{invoiceId:invoice.id,reason:''}]:terms.invoiceApplicability.filter((i)=>i.invoiceId!==invoice.id))}/>{invoice.invoice_number}, {invoice.status}, {invoice.currency_code??'currency unknown'}, original terms {invoice.award_handoff_revision_id??'unbound'}</label>{terms.invoiceApplicability.some((i)=>i.invoiceId===invoice.id)?<Field label="Source-backed applicability reason" value={terms.invoiceApplicability.find((i)=>i.invoiceId===invoice.id)!.reason} change={(v)=>set("invoiceApplicability",terms.invoiceApplicability.map((i)=>i.invoiceId===invoice.id?{...i,reason:v}:i))}/>:null}</div>)}</div>:null}

          <label className="flex gap-2 text-sm"><input type="checkbox" checked={terms.effective} onChange={(e) => set("effective", e.target.checked)} />Use this source-confirmed version as current administrative terms. A pending amendment stays historical until explicitly effective.</label>
        </fieldset>
      </div>
      {review ? <div className="space-y-3"><h2 className="font-semibold">Review the exact handoff</h2><ReviewTerms terms={review.reviewed.terms as AwardTerms}/><details><summary>Exact proposal, sources and review record</summary><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(review.reviewed,null,2)}</pre></details>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I checked the actual notice, entered amounts, independent authority states and occurrence reconciliation.</label>
        <Button disabled={busy || !confirmed} onClick={() => void apply()}>Save handoff or recover exact receipt</Button>
        <Button variant="outline" disabled={busy} onClick={() => { sessionStorage.removeItem(storageKey); retainReview(null); setKey(crypto.randomUUID()); setConfirmed(false); void load("rebase"); }}>Discard review and reload current sources</Button>
      </div> : <Button disabled={busy || !history || recoveryBlocked} onClick={() => void preview()}>Review handoff</Button>}
      <p role="status" className="text-sm whitespace-pre-wrap">{message}</p>
    </> : null}
  </section>;
}

function NoticeSources({ terms, change }: { terms: AwardTerms; change: (t: AwardTerms) => void }) {
  const notice = terms.sources.find((s) => s.id === terms.noticeSourceId) ?? { family: "kb_pdf" as const, id: "", version: "", sourceDate: "", citation: "" };
  function update(field: "id" | "version" | "sourceDate" | "citation", value: string) { const next = { ...notice, [field]: value }; change({ ...terms, noticeSourceId: next.id, sources: [next,...terms.sources.filter((s)=>s.id!==terms.noticeSourceId)] }); }
  return <div className="space-y-3"><h3 className="font-semibold">Retained actual notice</h3><p className="text-sm">Upload the ordinary PDF in Documents, then copy its document ID. Management exports, private attachments and URLs are excluded. This source must be intended for everyone with membership here.</p>{(['id','version','sourceDate','citation'] as const).map((field) => <Field key={field} label={`Notice ${field}`} value={notice[field]} change={(v) => update(field,v)} />)}
    {terms.sources.filter((s)=>s.id!==terms.noticeSourceId).map((source,index)=><fieldset key={index} className="space-y-2"><legend>Supporting retained PDF</legend>{(['id','version','sourceDate','citation'] as const).map((field)=><Field key={field} label={`Supporting source ${field}`} value={source[field]} change={(v)=>change({...terms,sources:terms.sources.map((s)=>s===source?{...s,[field]:v}:s)})}/>)}</fieldset>)}
    <Button type="button" variant="outline" onClick={()=>change({...terms,sources:[...terms.sources,{family:'kb_pdf',id:'',version:'',sourceDate:'',citation:''}]})}>Add supporting PDF</Button>
  </div>;
}
function OccurrenceEditor({ rows, change, legacy }: { legacy:History["legacyObligations"]; rows: AwardOccurrence[]; change: (r: AwardOccurrence[]) => void }) {
  return <div className="space-y-3"><h3 className="font-semibold">Source-confirmed occurrences</h3><p className="text-sm">Keep condition and occurrence keys stable for unchanged work. Add separate occurrences for distinct report dates. Unresolved triggers retain no invented calendar date.</p>
    {rows.map((row,index) => { const edit = (patch: Partial<AwardOccurrence>) => change(rows.map((r,i) => i === index ? { ...r,...patch } : r)); return <fieldset key={index} className="border-l-2 pl-3 space-y-2"><legend>Occurrence {index+1}</legend>
      {(['conditionKey','occurrenceKey','requirement','responsibleParty','citation','distinctSourceIdentity','reason'] as const).map((field) => <Field key={field} label={({conditionKey:"Condition reference",occurrenceKey:"Occurrence reference",requirement:"Actual requirement",responsibleParty:"Responsible organization or role",citation:"Source page or clause",distinctSourceIdentity:"Distinct source identity for this occurrence",reason:"Reconciliation reason"})[field]} value={row[field]} change={(v) => edit({ [field]: v })} />)}
      <label>Kind<select className="module-select" value={row.kind} onChange={(e) => edit({ kind: e.target.value as AwardOccurrence['kind'] })}>{['report','obligation','expenditure'].map((s) => <option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
      <label>Disposition<select className="module-select" value={row.disposition} onChange={(e) => edit({ disposition: e.target.value as AwardOccurrence['disposition'] })}>{['new','carry','reschedule','replace','reopen','withdraw','adopt_legacy'].map((s) => <option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
      {row.disposition==='adopt_legacy'?<label className="grid gap-1 text-sm">Reviewed legacy obligation<select className="module-select" value={row.legacyObligationId??''} onChange={(e)=>edit({legacyObligationId:e.target.value||null})}><option value="">Select the actual existing obligation</option>{legacy.map((m)=><option key={m.id} value={m.id}>{m.title}, {m.status}, actual date {m.actual_date??'not recorded'}, assignee {m.assignee_user_id??'unassigned'}, evidence {m.notes??'not recorded'}</option>)}</select>Adoption preserves the actual outcome, assignment and evidence. Reopen creates new schedule work and retains the original completed obligation.</label>:null}
      <label>Clock<select className="module-select" value={row.clock.kind} onChange={(e) => edit({ clock: e.target.value === 'date_only' ? { kind:'date_only', date:'' } : e.target.value === 'instant' ? { kind:'instant', value:'', sourceZone:'', calendarDate:'', calendarDateBasis:'' } : { kind:'unresolved_trigger', trigger:'' } })}>{['date_only','instant','unresolved_trigger'].map((s) => <option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
      {row.clock.kind === 'date_only' ? <Field label="Source date YYYY-MM-DD" value={row.clock.date} change={(v) => edit({ clock:{ kind:'date_only',date:v } })} /> : row.clock.kind === 'unresolved_trigger' ? <Field label="Unresolved trigger" value={row.clock.trigger} change={(v) => edit({ clock:{ kind:'unresolved_trigger', trigger:v } })} /> : <>
        {(['value','sourceZone','calendarDate','calendarDateBasis'] as const).map((field) => <Field key={field} label={field} value={row.clock.kind === 'instant' ? row.clock[field] : ''} change={(v) => { if (row.clock.kind === 'instant') edit({ clock:{ ...row.clock,[field]:v } }); }} />)}
      </>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={row.fulfillmentStillApplies} onChange={(e) => edit({ fulfillmentStillApplies:e.target.checked })} />Earlier actual fulfillment still applies to this same requirement.</label>
    </fieldset>; })}
    <Button type="button" variant="outline" onClick={() => change([...rows,{ conditionKey:'', occurrenceKey:'', requirement:'', responsibleParty:'',citation:'',kind:'report',clock:{ kind:'unresolved_trigger',trigger:'' }, disposition:'new',legacyObligationId:null,priorOccurrenceId:null,reason:'New source requirement',distinctSourceIdentity:'',fulfillmentStillApplies:false }])}>Add occurrence</Button>
  </div>;
}

function OccurrenceOutcome({occurrence:o,projectId,onSaved}:{occurrence:History['occurrences'][number];projectId:string;awardId:string;onSaved:()=>void}) {
 const [status,setStatus]=useState(o.submittal_id?o.submittal_status??'draft':o.milestone_status??'not_started');
 const [date,setDate]=useState(o.submittal_id?o.submitted_at??'':o.actual_date??'');const [evidence,setEvidence]=useState(o.fulfillment_evidence??'');const [message,setMessage]=useState('');
 const target=o.submittal_id??o.milestone_id;if(!target)return null;
 async function save(){try{const response=await fetch(`/api/projects/${projectId}/records/${target}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordType:o.submittal_id?'submittal':'milestone',status,note:evidence,...(o.submittal_id?{submittedAt:date||null}:{actualDate:date||null})})});const result=await response.json();if(!response.ok)throw new Error(result.error);setMessage('Actual outcome recorded. Review again before applying another revision.');onSaved();}catch(e){setMessage(String(e));}}
 return <details><summary>Actual work: {o.requirement.requirement} ({status})</summary><div className="space-y-2"><p className="text-sm">This records actual work and evidence. A scheduled draft does not establish fulfillment.</p><label>Status<select className="module-select" value={status} onChange={(e)=>setStatus(e.target.value)}>{(o.submittal_id?['draft','internal_review','submitted','accepted','revise_and_resubmit']:['not_started','scheduled','in_progress','blocked','complete']).map((s)=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label><Field label={o.submittal_id?'Actual submitted timestamp with offset, blank means unknown':'Actual completion date, blank means unknown'} value={date} change={setDate}/><Field label="Actual fulfillment/receipt evidence" value={evidence} change={setEvidence} multiline/><Button onClick={()=>void save()}>Record actual outcome</Button><p role="status">{message}</p></div></details>;
}

function ReviewTerms({terms:t}:{terms:AwardTerms}) {
 return <div className="space-y-2 text-sm"><p>Recorded award ceiling {String(t.ceiling)} {t.currency.code}. Required match {String(t.match)} {t.currency.code}.</p><p>Recipient: {t.recipient}. Funder: {t.funder}.</p><p>Scope: {t.scope}</p><p>Differences: {t.differences}</p><p>Commitments: {t.commitments}</p><p>Recipient acceptance: {t.acceptance.replaceAll('_',' ')}. Spending authorization: {t.authorization.state.replaceAll('_',' ')}. {t.authorization.amount===null?'Authorization amount not recorded':`Independently sourced authorization amount ${t.authorization.amount} ${t.authorization.amountCurrencyCode??"currency unassessed"}`}.</p><p>Authorization authority: {t.authorization.authority}. Scope: {t.authorization.scope}. Period: {t.authorization.period}. Evidence: {t.authorization.evidence}.</p><p>{t.effective?'This version becomes current administrative terms.':'This version remains a pending amendment.'} {t.effectiveEvidence}</p><p>Schedule coverage: {t.scheduleCoverage}</p>{t.occurrences.map((o)=><p key={`${o.conditionKey}/${o.occurrenceKey}`}>{o.conditionKey}, {o.occurrenceKey}: {o.requirement}. Clock: {o.clock.kind==='date_only'?o.clock.date:o.clock.kind==='instant'?`${o.clock.value}, source zone ${o.clock.sourceZone}`:o.clock.trigger}. Disposition: {o.disposition}. {o.reason}</p>)}</div>;
}
