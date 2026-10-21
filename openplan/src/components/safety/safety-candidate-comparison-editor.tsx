"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { CRASH_SEVERITIES } from "@/lib/safety/vocabulary";
import { safetyComparisonInputsSchema, safetyComparisonRecordSchema, safetyComparisonPointerSchema, safetyComparisonReceiptSchema, missingFactSchema, SAFETY_V2_NOFO_REFUSAL, describeSafetyComparisonSource, type SafetyComparisonInputs } from "@/lib/safety/candidate-comparison";
import { formatProjectEstimate } from "@/lib/projects/estimated-cost";
import { sameSafetyRevision } from "@/lib/reports/safety-revision";
// Do not import server snapshot/hash readers into this client component.
const acquisitionSchema = z.object({ id: z.string().uuid(), source_label: z.string(), evidence_revision: z.string().regex(/^[1-9]\d*$/), years_requested: z.array(z.number()), min_lon: z.number(), min_lat: z.number(), max_lon: z.number(), max_lat: z.number() }).passthrough();
const contextSchema = z.object({
  actorId: z.string().uuid(), report: z.object({ id: z.string(), project_id: z.string(), title: z.string().nullable(), updated_at: z.string(), metadata_json: z.record(z.string(), z.unknown()).nullable() }).passthrough(),
  project: z.object({ id: z.string(), updated_at: z.string(), estimated_cost_amount: z.string().nullable(), estimated_cost_currency: z.string().nullable(), estimated_cost_basis_year: z.number().nullable(), estimated_cost_source_document_id: z.string().nullable() }).passthrough(),
  comparison: safetyComparisonRecordSchema.nullable(), acquisitions: z.array(acquisitionSchema), selectedAcquisition: acquisitionSchema.nullable(), nextCursor: z.string().nullable(),
  artifacts: z.array(z.object({ id: z.string(), artifact_kind: z.string(), generated_at: z.string(), metadata_json: z.record(z.string(), z.unknown()), freshness: z.enum(["current", "historical", "legacy", "unavailable_custody", "invalid_source"]) })), artifactNextCursor: z.string().nullable(), canWrite: z.boolean(), historical: z.boolean(),
});
type Context = z.infer<typeof contextSchema>;
type Fact = z.infer<typeof missingFactSchema>;
type Alternative = SafetyComparisonInputs["alternatives"][number];
const unknownFact = (reason = "No source fact is recorded."): Fact => ({ state: "unknown", reason });
const field = "w-full min-w-0 rounded border bg-background p-2 text-sm";
function FactEditor({ label, value, onChange }: { label: string; value: Fact; onChange: (value: Fact) => void }) {
  return <fieldset className="space-y-2 rounded border p-3"><legend className="text-sm font-medium">{label}</legend>
    <label className="block text-sm">Evidence state<select className={field} value={value.state} onChange={e => onChange(e.target.value === "unknown" ? unknownFact() : { state: "recorded", value: "", unit: null, source: "", locator: "", retainedQuotation: "", sourceUrl: null, sourceDate: null, retrievedAt: null, spatialTemporalScope: "Not recorded.", retentionBasis: "Not recorded." })}><option value="unknown">Unknown</option><option value="recorded">Documented source fact</option></select></label>
    {value.state === "unknown" ? <label className="block text-sm">Missing because<input className={field} value={value.reason} onChange={e => onChange({ ...value, reason: e.target.value })} /></label> : <>
      {([['value', 'Observed value'], ['unit', 'Unit, if applicable'], ['source', 'Source title, publisher and edition'], ['locator', 'Page, table or row locator'], ['retainedQuotation', 'Retained source quotation'], ['sourceUrl', 'Source URL, if available'], ['sourceDate', 'Source date, if known'], ['retrievedAt', 'Retrieval timestamp, if known (ISO 8601)'], ['spatialTemporalScope', 'Spatial and temporal scope'], ['retentionBasis', 'Access and retention basis']] as const).map(([key, title]) => <label key={key} className="block text-sm">{title}<input className={field} value={value[key] ?? ""} onChange={e => onChange({ ...value, [key]: e.target.value || (["unit", "sourceUrl", "sourceDate", "retrievedAt"].includes(key) ? null : "") })} /></label>)}
    </>}
  </fieldset>;
}
function blankAlternative(kind: Alternative["kind"]): Alternative {
  return { id: crypto.randomUUID(), kind, name: kind === "no_build" ? "No Build" : "", scope: "", operatingAssumptions: "", treatmentDescription: kind === "no_build" ? "Future operating condition without the proposal. No numerical forecast is established." : "", proposedTimeRange: unknownFact("Proposed time range is not recorded."), applicability: "unknown", applicabilityRationale: "Site applicability is unassessed.", conditions: [], cost: { kind: "missing", reason: "No alternative-specific cost is recorded." }, effect: "unassessed", effectReason: "No complete primary CMF and site qualification is established." };
}
/** One Reports-owned review. Persist the exact request before sending; uncertain outcomes lock editing. */
export function SafetyCandidateComparisonEditor({ reportId, ingestId }: { reportId: string; ingestId?: string }) {
  const [context, setContext] = useState<Context | null>(null);
  const [inputs, setInputs] = useState<SafetyComparisonInputs | null>(null);
  const [bounds, setBounds] = useState({ west: "", south: "", east: "", north: "" });
  const [geometryEdited, setGeometryEdited] = useState(false);
  const [yearsText, setYearsText] = useState("");
  const [pending, setPending] = useState<{ body: string; target: "save" | "generate" } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const storageKey = context ? `openplan:safety-comparison:${context.actorId}:${reportId}` : null;
  const url = `/api/reports/${reportId}/safety-comparison${ingestId ? `?ingestId=${encodeURIComponent(ingestId)}` : ""}`;
  const sourceScope = useRef(url);
  const load = useCallback(async (resetInputs: boolean, signal?: AbortSignal) => {
    const response = await fetch(url, { cache: "no-store", signal }); const raw = await response.json();
    if (!response.ok) throw new Error(raw.error || "Comparison source read failed.");
    if (signal?.aborted || sourceScope.current !== url) throw new Error("Report source changed while loading.");
    const next = contextSchema.parse(raw); setContext(next);
    if (resetInputs) {
      setInputs(next.comparison?.payload.inputs ?? { title: next.report.title ?? "Safety input comparison", acquisitionId: next.selectedAcquisition?.id ?? "", siteLabel: "", siteIdentity: unknownFact("Site facility, road provenance and responsible authorities are not recorded."), influenceArea: { type: "Polygon", coordinates: [] }, analysisGeometry: { type: "Polygon", coordinates: [] }, influenceRationale: "", selectedYears: [], severities: ["fatal", "severe_injury"], involvement: "all", siteFacts: [], alternatives: [blankAlternative("no_build"), blankAlternative("treatment")], findings: "Effects and priority remain unassessed. Missing inputs require further review." });
      setGeometryEdited(false);
      setYearsText(next.comparison?.payload.inputs.selectedYears.join(", ") ?? "");
    }
    return next;
  }, [url]);
  useEffect(() => { let live = true; const controller = new AbortController(); sourceScope.current = url; setReady(false); setContext(null); setInputs(null); setPending(null); void load(true, controller.signal).then(next => {
    if (!live) return;
    const retained = sessionStorage.getItem(`openplan:safety-comparison:${next.actorId}:${reportId}`);
    if (retained) { const parsed = z.object({ body: z.string(), target: z.enum(["save", "generate"]) }).strict().safeParse(JSON.parse(retained)); if (parsed.success) setPending(parsed.data); else throw new Error("Retained request is unreadable. No fresh write is allowed."); }
    setReady(true);
  }).catch(caught => { if (live) setError(caught instanceof Error ? caught.message : "Source unavailable"); }); return () => { live = false; controller.abort(); }; }, [load, reportId, url]);
  if (!context || !inputs) return <div className="space-y-3 p-4"><h1>Safety evidence comparison</h1>{error ? <p role="alert">{error}</p> : <p>Loading retained sources.</p>}<Link className="underline" href="/reports">Back to Reports</Link></div>;
  const selected = [...context.acquisitions, ...(context.selectedAcquisition ? [context.selectedAcquisition] : [])].find(a => a.id === inputs.acquisitionId);
  const pointer = safetyComparisonPointerSchema.safeParse(context.report.metadata_json?.safetyComparisonV2);
  const update = (change: Partial<SafetyComparisonInputs>) => setInputs({ ...inputs, ...change });
  const updateAlternative = (index: number, change: Partial<Alternative>) => update({ alternatives: inputs.alternatives.map((a, at) => at === index ? { ...a, ...change } : a) });
  async function send(retained: { body: string; target: "save" | "generate" }) {
    if (!storageKey) return;
    const unresolvedBeforeSend = pending !== null;
    setBusy(true); setError(null); setMessage(null);
    try {
      // Session storage failure prevents the write, because recovery would be unavailable.
      sessionStorage.setItem(storageKey, JSON.stringify(retained)); setPending(retained);
      const response = await fetch(`/api/reports/${reportId}${retained.target === "generate" ? "/generate" : ""}`, { method: retained.target === "save" ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: retained.body });
      const result = await response.json();
      if (!response.ok) {
        // A later rejection cannot disprove an earlier unknown commit. Only an
        // exact receipt resolves a retained retry, including after access loss.
        if (result.outcome === "refused" && !unresolvedBeforeSend) { sessionStorage.removeItem(storageKey); setPending(null); }
        if (result.outcome === "refused" && unresolvedBeforeSend) throw new Error(`This retry refused, but the earlier outcome remains unknown. Retain this request. ${result.error ?? ""}`);
        throw new Error(result.error || "Outcome unknown. Retry the retained request.");
      }
      const command = JSON.parse(retained.body).safetyComparison;
      const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(command))))).map(v => v.toString(16).padStart(2,"0")).join("");
      if (result.receipt?.requestHash !== requestHash) throw new Error("Uncertain request hash. Retry the retained request.");
      if (retained.target === "save") {
        const receipt = safetyComparisonReceiptSchema.parse(result.receipt);
        if (!result.saved || receipt.requestId !== command.requestId || receipt.reportId !== reportId || !sameSafetyRevision(receipt.beforeReportRevision, command.expectedReportRevision) || !sameSafetyRevision(receipt.beforeProjectRevision, command.expectedProjectRevision)) throw new Error("Uncertain save receipt. Retry the retained request.");
      } else {
        if (!result.generated || result.receipt?.requestId !== command.requestId || result.receipt?.artifactId !== command.requestId || result.receipt?.reportId !== reportId || result.receipt?.revisionId !== command.revisionId || result.receipt?.contentHash !== command.contentHash || !sameSafetyRevision(result.receipt?.sourceProjectRevision, command.expectedProjectRevision) || !sameSafetyRevision(result.receipt?.sourceReportRevision, command.expectedReportRevision)) throw new Error("Uncertain generation receipt. Retry the retained request.");
      }
      sessionStorage.removeItem(storageKey); setPending(null);
      await load(true); setMessage(retained.target === "save" ? `Request resolved to immutable revision ${result.receipt.revisionId}. The current report may point to a later revision, shown above.` : `Request resolved to file ${result.receipt.artifactId}. Its current or historical source state appears below.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Outcome unknown. Retry the retained request."); }
    finally { setBusy(false); }
  }
  function save() {
    try {
      if (!selected) throw new Error("Select a ready acquisition belonging to this project.");
      let proposed = inputs!;
      if (geometryEdited || !context!.comparison) {
        if (Object.values(bounds).some(v => !v.trim())) throw new Error("Enter the four influence bounds explicitly.");
        const west = Number(bounds.west), east = Number(bounds.east), south = Number(bounds.south), north = Number(bounds.north);
        if (!(west < east && south < north)) throw new Error("Use an ordered, nonwrapped influence rectangle.");
        const polygon = (w: number, s: number, e: number, n: number): SafetyComparisonInputs["influenceArea"] => ({ type: "Polygon", coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] });
        proposed = { ...proposed, influenceArea: polygon(west,south,east,north) };
      }
      if (!context!.comparison || selected.id !== context!.comparison.payload.inputs.acquisitionId || geometryEdited) {
        proposed = { ...proposed, analysisGeometry: { type: "Polygon", coordinates: [[[selected.min_lon,selected.min_lat],[selected.max_lon,selected.min_lat],[selected.max_lon,selected.max_lat],[selected.min_lon,selected.max_lat],[selected.min_lon,selected.min_lat]]] } };
      }
      if (proposed.influenceArea.coordinates.some(ring => ring.some(([longitude, latitude]) => longitude < selected.min_lon || longitude > selected.max_lon || latitude < selected.min_lat || latitude > selected.max_lat))) {
        throw new Error("The selected acquisition does not cover the retained influence polygon. Choose a covering acquisition or explicitly edit the influence bounds.");
      }
      const selectedYears = yearsText.split(",").map(value => {
        if (!/^\d{4}$/.test(value.trim())) throw new Error("Enter each requested year in full, separated by commas.");
        return Number(value.trim());
      });
      const validated = safetyComparisonInputsSchema.parse({ ...proposed, selectedYears });
      const command = { operation: context!.comparison ? "refresh" : "save", requestId: crypto.randomUUID(), expectedReportRevision: context!.report.updated_at, expectedProjectRevision: context!.project.updated_at, expectedAcquisitionRevision: selected.evidence_revision, expectedComparison: pointer.success ? { revisionId: pointer.data.revisionId, hash: pointer.data.hash } : null, inputs: validated };
      void send({ target: "save", body: JSON.stringify({ safetyComparison: command }) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the required inputs."); }
  }
  function generate(format: "html" | "pdf") {
    if (!pointer.success) return;
    void send({ target: "generate", body: JSON.stringify({ safetyComparison: { requestId: crypto.randomUUID(), revisionId: pointer.data.revisionId, contentHash: pointer.data.hash, expectedReportRevision: context!.report.updated_at, expectedProjectRevision: context!.project.updated_at, format } }) });
  }
  return <main className="mx-auto w-full max-w-4xl space-y-5 p-4 md:p-8" data-testid="safety-input-comparison-editor">
    <h1 className="text-2xl font-semibold">Safety evidence and applicability comparison</h1>
    <nav className="flex flex-wrap gap-4 text-sm"><Link className="underline" href="/reports">Reports</Link><Link className="underline" href={`/projects/${context.project.id}`}>Project</Link><Link className="underline" href={`/safety?projectId=${context.project.id}${selected ? `&ingestId=${selected.id}` : ""}`}>Safety evidence</Link></nav>
    <p>Compare one influence area with No Build and up to ten alternatives. Every effect remains unassessed. This review creates no forecast, score, priority, adoption, funding or eligibility decision.</p>
    <p className="text-sm">Current project estimate: {context.project.estimated_cost_amount && context.project.estimated_cost_currency ? formatProjectEstimate(context.project.estimated_cost_amount, context.project.estimated_cost_currency) : "Unknown"}. Price year: {context.project.estimated_cost_basis_year ?? "Unknown"}. <Link className="underline" href={`/projects/${context.project.id}?tab=documents`}>Open actual estimate and source</Link>.</p>
    {context.comparison ? <section className="space-y-2 rounded border p-3"><h2 className="font-semibold">Retained review</h2><p className="break-all text-xs">Revision {context.comparison.id}; hash {context.comparison.content_hash}.</p><p>{context.comparison.payload.capture.included} included mapped crashes; {context.comparison.payload.capture.excluded} excluded; {context.comparison.payload.capture.indeterminate} indeterminate. {context.comparison.payload.capture.coverageReason}</p><a className="underline" href={`/api/reports/${reportId}/safety-comparison?revisionId=${context.comparison.id}&format=csv`}>Download exact revision CSV</a></section> : null}
    {context.comparison ? <p className="text-sm">{describeSafetyComparisonSource(context.comparison)}</p> : null}
    {context.comparison ? <p className="text-sm">Stored membership by reason: {Object.entries(context.comparison.payload.capture.reasonCounts).map(([reason,count]) => `${reason}: ${count}`).join("; ") || "No stored rows"}.</p> : null}
    <fieldset className="min-w-0 space-y-5" disabled={!ready || !context.canWrite || busy || Boolean(pending)}>
      <label className="block text-sm">Study title<input className={field} value={inputs.title} onChange={e => update({ title: e.target.value })} /></label>
      <label className="block text-sm">Retained acquisition<select className={field} value={inputs.acquisitionId} onChange={e => { update({ acquisitionId: e.target.value, selectedYears: [] }); setYearsText(""); }}><option value="">Select an acquisition</option>{[...new Map([...context.acquisitions, ...(context.selectedAcquisition ? [context.selectedAcquisition] : [])].map(a => [a.id,a])).values()].map(a => <option key={a.id} value={a.id}>{a.source_label} · {a.id}</option>)}</select></label>
      {context.nextCursor ? <Button type="button" variant="outline" onClick={async () => { try { const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}before=${context.nextCursor}`); const raw = await response.json(); if (!response.ok) throw new Error(raw.error); const page = contextSchema.parse(raw); setContext({ ...context, acquisitions: [...context.acquisitions, ...page.acquisitions], nextCursor: page.nextCursor }); } catch { setError("More acquisitions could not be loaded. No list is silently truncated."); } }}>Load more acquisitions</Button> : null}
      <p className="text-sm">The analysis area uses the selected acquisition extent. Enter a separate influence rectangle in WGS84 longitude/latitude. Retained polygon vertices remain unchanged unless you edit these bounds. Wrapped polygons are explicitly unsupported in this increment.</p>
      <div className="grid grid-cols-2 gap-3">{([['west','West longitude'],['south','South latitude'],['east','East longitude'],['north','North latitude']] as const).map(([key,label]) => <label key={key} className="text-sm">{label}<input className={field} inputMode="decimal" value={bounds[key]} placeholder={context.comparison ? "Retained polygon" : "Required"} onChange={e => { setBounds({ ...bounds, [key]: e.target.value }); setGeometryEdited(true); }} /></label>)}</div>
      {context.comparison ? <details><summary>Retained influence polygon</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(inputs.influenceArea)}</pre></details> : null}
      <label className="block text-sm">Site label<input className={field} value={inputs.siteLabel} onChange={e => update({ siteLabel: e.target.value })} /></label>
      <label className="block text-sm">Influence-area method and rationale<textarea className={field} value={inputs.influenceRationale} onChange={e => update({ influenceRationale: e.target.value })} /></label>
      <FactEditor label="Site identity, facility and authority evidence" value={inputs.siteIdentity} onChange={siteIdentity => update({ siteIdentity })} />
      <label className="block text-sm">Requested observation years, separated by commas<input className={field} value={yearsText} onChange={e => setYearsText(e.target.value)} /></label>
      <p className="text-sm">Acquisition requested years: {selected?.years_requested.join(", ") || "Not recorded"}. Neither list proves complete intervals or duration.</p>
      <fieldset><legend>Severity predicate</legend><div className="flex flex-wrap gap-3">{CRASH_SEVERITIES.map(s => <label key={s} className="text-sm"><input type="checkbox" checked={inputs.severities.includes(s)} onChange={e => update({ severities: e.target.checked ? [...inputs.severities,s] : inputs.severities.filter(v => v!==s) })} /> {s}</label>)}</div></fieldset>
      <label className="block text-sm">Involvement predicate<select className={field} value={inputs.involvement} onChange={e => update({ involvement: e.target.value as SafetyComparisonInputs["involvement"] })}>{["all","pedestrian","bicyclist","motorcyclist"].map(v => <option key={v}>{v}</option>)}</select></label>
      <h2 className="text-lg font-semibold">Sourced site facts</h2>{inputs.siteFacts.map((f,index) => <div key={index} className="space-y-2"><label className="block text-sm">Fact name<input className={field} value={f.name} onChange={e => update({ siteFacts: inputs.siteFacts.map((v,at) => at===index ? { ...v,name:e.target.value } : v) })} /></label><FactEditor label={f.name || "Site fact"} value={f.fact} onChange={fact => update({ siteFacts: inputs.siteFacts.map((v,at) => at===index ? { ...v,fact } : v) })} /></div>)}
      <Button type="button" variant="outline" disabled={inputs.siteFacts.length>=30} onClick={() => update({ siteFacts: [...inputs.siteFacts,{ name:"",fact:unknownFact() }] })}>Add site fact</Button>
      <h2 className="text-lg font-semibold">No Build and alternatives</h2>
      {inputs.alternatives.map((a,index) => <section key={a.id} className="min-w-0 space-y-3 rounded border p-3"><h3 className="font-semibold">{a.kind === "no_build" ? "No Build" : `Alternative ${index}`}</h3>
        {([['name','Name'],['scope','Scope and limits'],['operatingAssumptions','Operating assumptions'],['treatmentDescription','Treatment definition or sourced description'],['applicabilityRationale','Applicability rationale']] as const).map(([key,label]) => <label key={key} className="block text-sm">{label}<textarea className={field} value={a[key]} onChange={e => updateAlternative(index,{ [key]:e.target.value })} /></label>)}
        <FactEditor label="Proposed time range" value={a.proposedTimeRange} onChange={proposedTimeRange => updateAlternative(index,{ proposedTimeRange })} />
        <label className="block text-sm">Applicability finding<select className={field} value={a.applicability} onChange={e => updateAlternative(index,{ applicability:e.target.value as Alternative["applicability"] })}>{["unknown","matched","mismatched","not_applicable"].map(v => <option key={v}>{v}</option>)}</select></label>
        {a.conditions.map((condition,at) => <div key={at} className="space-y-2 rounded border p-2"><label className="block text-sm">Required published condition<input className={field} value={condition.requiredCondition} onChange={e => updateAlternative(index,{ conditions:a.conditions.map((v,n) => n===at ? { ...v,requiredCondition:e.target.value } : v) })} /></label><FactEditor label="Observed site fact" value={condition.siteFact} onChange={siteFact => updateAlternative(index,{ conditions:a.conditions.map((v,n) => n===at ? { ...v,siteFact } : v) })} /><label className="block text-sm">Condition finding<select className={field} value={condition.finding} onChange={e => updateAlternative(index,{ conditions:a.conditions.map((v,n) => n===at ? { ...v,finding:e.target.value as typeof v.finding } : v) })}>{["unknown","matched","mismatched","not_applicable"].map(v => <option key={v}>{v}</option>)}</select></label><label className="block text-sm">Condition rationale<input className={field} value={condition.rationale} onChange={e => updateAlternative(index,{ conditions:a.conditions.map((v,n) => n===at ? { ...v,rationale:e.target.value } : v) })} /></label></div>)}
        <Button type="button" variant="outline" disabled={a.conditions.length>=30} onClick={() => updateAlternative(index,{ conditions:[...a.conditions,{ requiredCondition:"",siteFact:unknownFact(),finding:"unknown",rationale:"No condition match is established." }] })}>Add applicability condition</Button>
        <label className="block text-sm">Cost source<select className={field} value={a.cost.kind} onChange={e => updateAlternative(index,{ cost:e.target.value==="missing" ? { kind:"missing",reason:"No alternative-specific cost is recorded." } : { kind:"project_estimate",scopeRelationship:"context_only",scopeRationale:"Whole-project estimate; alternative scope is not established.",estimatingBasis:unknownFact("Estimating basis is not recorded."),includedElements:unknownFact("Included cost elements are not recorded.") } })}><option value="missing">Missing</option><option value="project_estimate">Freeze existing project estimate</option></select></label>
        {a.cost.kind === "missing" ? <label className="block text-sm">Missing cost because<input className={field} value={a.cost.reason} onChange={e => updateAlternative(index,{ cost:{ kind:"missing",reason:e.target.value } })} /></label> : <>
          <label className="block text-sm">Cost scope relationship<select className={field} value={a.cost.scopeRelationship} onChange={e => { if(a.cost.kind==="project_estimate") updateAlternative(index,{ cost:{...a.cost,scopeRelationship:e.target.value as "context_only"|"same_scope"} }); }}><option value="context_only">Contextual whole-project estimate</option><option value="same_scope">Same scope, supported below</option></select></label>
          <label className="block text-sm">Cost scope evidence<input className={field} value={a.cost.scopeRationale} onChange={e => { if(a.cost.kind==="project_estimate") updateAlternative(index,{ cost:{...a.cost,scopeRationale:e.target.value} }); }} /></label>
          <FactEditor label="Estimating basis" value={a.cost.estimatingBasis} onChange={estimatingBasis => { if(a.cost.kind==="project_estimate") updateAlternative(index,{cost:{...a.cost,estimatingBasis}}); }} /><FactEditor label="Included cost elements" value={a.cost.includedElements} onChange={includedElements => { if(a.cost.kind==="project_estimate") updateAlternative(index,{cost:{...a.cost,includedElements}}); }} />
        </>}
        <p className="text-sm">Effect: unassessed. {a.effectReason}</p>
        {a.kind==="treatment" && inputs.alternatives.length>2 ? <Button type="button" variant="outline" onClick={() => update({ alternatives:inputs.alternatives.filter((_,at)=>at!==index) })}>Remove this alternative from the next revision</Button> : null}
      </section>)}
      <Button type="button" variant="outline" disabled={inputs.alternatives.length>=11} onClick={() => update({ alternatives:[...inputs.alternatives,blankAlternative("treatment")] })}>Add treatment alternative</Button>
      <label className="block text-sm">Review findings<textarea className={field} value={inputs.findings} onChange={e => update({ findings:e.target.value })} /></label>
      <Button type="button" onClick={save}>Save immutable evidence review</Button>
    </fieldset>
    {pending ? <section className="space-y-2 rounded border p-3"><p>The earlier request is retained, but its outcome is unknown. Editing and new requests stay disabled until the outcome of this exact request is confirmed.</p><Button type="button" disabled={busy} onClick={() => void send(pending)}>Retry retained request</Button></section> : null}
    {context.comparison ? <section className="space-y-3"><h2 className="font-semibold">Generate saved revision</h2><p className="text-sm">Generation uses the saved revision above. Unsaved form changes do not enter its files.</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={!context.canWrite||busy||Boolean(pending)||!ready} onClick={()=>generate("html")}>Generate frozen HTML</Button><Button type="button" variant="outline" disabled={!context.canWrite||busy||Boolean(pending)||!ready} onClick={()=>generate("pdf")}>Generate frozen PDF</Button></div></section> : null}
    <section className="space-y-2"><h2 className="font-semibold">Retained files</h2>{context.artifacts.length ? context.artifacts.map(a=><p key={a.id} id={`artifact-${a.id}`} className="break-words text-sm"><a className="underline" href={`/api/reports/${reportId}/artifacts/${a.id}/download`}>{a.artifact_kind.toUpperCase()} generated {a.generated_at}</a>. {a.freshness === "current" ? "Current retained review." : a.freshness === "historical" ? "Historical source or comparison revision; refresh before current use." : a.freshness === "legacy" ? "Earlier report file retained under its original contract." : a.freshness === "invalid_source" ? "Invalid or unsupported source; download refuses." : "The saved file is listed, but its source revisions could not be verified. Refresh before current use."}</p>) : <p>No saved files.</p>}
    {context.artifactNextCursor ? <Button type="button" variant="outline" disabled={busy} onClick={async()=>{try{const response=await fetch(`${url}${url.includes("?")?"&":"?"}artifactBefore=${context.artifactNextCursor}`);const raw=await response.json();if(!response.ok)throw new Error(raw.error);const page=contextSchema.parse(raw);setContext({...context,artifacts:[...context.artifacts,...page.artifacts],artifactNextCursor:page.artifactNextCursor});}catch{setError("Earlier files could not be loaded. Retained files remain unchanged.");}}}>Load earlier files</Button> : null}</section>
    <p className="text-sm">{SAFETY_V2_NOFO_REFUSAL}</p>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
  </main>;
}
