"use client";
import { WorkProgramComparison } from "./comparison";
import { WorkProgramExports } from "./exports";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { reconcileWorkProgram, workProgramDraftSchema, type WorkProgramDraft, type WorkProgramElement } from "@/lib/programs/work-program/schema";
import { proposeSourceElement } from "@/lib/programs/work-program/source-review";
import type { WorkProgramPreparation, WorkProgramRevision } from "@/lib/programs/work-program/types";
import { StructuredWorkProgramEditor } from "./structured-editor";
import { recoverWorkProgramDraft, upgradeWorkProgramDraft } from "@/lib/programs/work-program/draft-recovery";
import { reconcileStructuredWorkProgram } from "@/lib/programs/work-program/reconciliation";
import { selectWorkProgramSources, workProgramCoverage } from "@/lib/programs/work-program/source-review";
import { Field, SelectField } from "./fields";
import { WorkProgramSources } from "./sources";
import { WorkProgramElementEditor } from "./element-editor";

type Props = { programId: string; workspaceId: string; userId: string; agency: string; initial: WorkProgramPreparation; documents: { id: string; title: string }[]; projects: { id: string; name: string }[]; canWrite: boolean; staff?: { value: string; label: string }[]; contracts?: { value: string; label: string }[] };
type PendingSave = { expectedRevision: number; requestId: string; draft: WorkProgramDraft };
function emptyDraft(agency: string): WorkProgramDraft {
  return { schemaVersion: 1, documentKind: "owp", agency, responsibleAuthority: "", authorityBasis: "", periodStart: "", periodEnd: "", introduction: "", staffing: "", financialNotes: "", currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [] };
}
export function WorkProgramEditor({ programId, workspaceId, userId, agency, initial, documents, projects, canWrite, staff = [], contracts = [] }: Props) {
  const [preparation, setPreparation] = useState(initial);
  const [draft, setDraft] = useState(initial.latest?.content_json ?? emptyDraft(agency));
  const [baseRevision, setBaseRevision] = useState(initial.latest?.revision ?? 0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recovered, setRecovered] = useState(false);
  const [suggestions, setSuggestions] = useState<{ existingId: string; proposed: WorkProgramElement }[]>([]);
  const [corruptRecovery, setCorruptRecovery] = useState<string | null>(null);
  const pending = useRef<PendingSave | null>(null);
  const storageKey = `openplan-work-program:${workspaceId}:${userId}:${programId}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(preparation.latest?.content_json ?? emptyDraft(agency));
  useEffect(() => {
    try {
      const archived = sessionStorage.getItem(`${storageKey}:unreadable`);
      if (archived && canWrite) setCorruptRecovery(archived);
      const saved = sessionStorage.getItem(storageKey);
      if (saved && canWrite) {
        const local = recoverWorkProgramDraft(saved);
        if (local) {
          setDraft(local.draft); setBaseRevision(local.baseRevision); pending.current = local.pending; setRecovered(true);
          setMessage("Recovered this tab's local proposal. Compare its base revision with the saved revision before saving.");
        } else {
          setCorruptRecovery(saved);
          sessionStorage.setItem(`${storageKey}:unreadable`, saved);
          setMessage("This tab's saved draft is damaged and could not be rendered safely. Its original content is retained below for recovery; the saved program revision is unchanged.");
        }
      }
    } catch { setMessage("Local recovery is unavailable. Save revisions before leaving this page."); }
    setReady(true);
  }, [storageKey, canWrite]);
  useEffect(() => {
    if (!ready || !canWrite) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, baseRevision, pending: pending.current })); }
    catch { /* Saving to the server remains available when browser storage is full. */ }
  }, [draft, baseRevision, storageKey, ready, canWrite]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = <K extends keyof WorkProgramDraft>(key: K, value: WorkProgramDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function refreshSources() {
    const response = await fetch(`/api/programs/${programId}/work-program`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not reload the saved sources");
    setPreparation(result);
  }
  async function save() {
    const parsed = workProgramDraftSchema.safeParse(upgradeWorkProgramDraft(draft));
    if (!parsed.success) { setMessage(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ")); return; }
    setBusy(true); setMessage("");
    if (!pending.current || JSON.stringify(pending.current.draft) !== JSON.stringify(parsed.data) || pending.current.expectedRevision !== baseRevision) pending.current = { expectedRevision: baseRevision, requestId: crypto.randomUUID(), draft: parsed.data };
    try {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, baseRevision, pending: pending.current })); } catch { /* The confirmed server revision is the durable record. */ }
      const response = await fetch(`/api/programs/${programId}/work-program`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The save could not be confirmed");
      const revision = result.revision as WorkProgramRevision;
      setBaseRevision(revision.revision); setDraft(revision.content_json); pending.current = null; setRecovered(false);
      setPreparation((current) => ({ ...current, latest: revision, revisions: [revision, ...current.revisions.filter((row) => row.id !== revision.id)] }));
      setMessage(`Saved revision ${revision.revision}. Export this revision for review.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The save could not be confirmed. Retry with the same proposal."); }
    finally { setBusy(false); }
  }
  async function loadLatest() {
    setBusy(true);
    try {
      const response = await fetch(`/api/programs/${programId}/work-program`, { cache: "no-store" });
      const result = await response.json() as WorkProgramPreparation & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load the latest revision");
      setPreparation(result); setDraft(result.latest?.content_json ?? emptyDraft(agency)); setBaseRevision(result.latest?.revision ?? 0); pending.current = null; setRecovered(false);
      setMessage("Loaded the latest saved revision. Local changes were discarded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load the saved revision"); }
    finally { setBusy(false); }
  }
  const totals = reconcileWorkProgram(draft);
  const selectedSources = selectWorkProgramSources(draft, preparation.sources);
  const reconciliation = draft.preparation ? reconcileStructuredWorkProgram(draft) : null;
  const coverage = workProgramCoverage(draft, preparation.sources);
  return <div className="min-w-0 space-y-6">
    <div className="rounded-lg border p-4 text-sm"><p>Preparation draft. This draft does not adopt a program, authorize spending, assign live work or log actual costs.</p><p className="mt-2">Editing from revision {baseRevision}. Latest loaded revision: {preparation.latest?.revision ?? "none"}.{dirty ? " Local changes are not saved to the program." : ""}{recovered ? " A local recovery was loaded." : ""}</p></div>
    <WorkProgramSources programId={programId} workspaceId={workspaceId} sources={selectedSources} documents={documents} canWrite={canWrite && !busy} onAttached={refreshSources} onSelectVersion={(sourceId, versionId) => {
      const converted = upgradeWorkProgramDraft(draft);
      const p = converted.preparation!;
      setDraft({ ...converted, preparation: { ...p, extractionSelections: [...p.extractionSelections.filter((row) => row.sourceId !== sourceId), { sourceId, versionId }] } });
      setMessage("Source review version selected. Existing proposal text and manual corrections are unchanged. Review differences before accepting a proposed replacement.");
    }} onPropose={(source, elements) => {
      setSuggestions(elements.flatMap((element) => {
        const existing = draft.elements.find((row) => row.source?.sourceId === source.id && row.source.elementKey === element.key);
        return existing ? [{ existingId: existing.id, proposed: proposeSourceElement(source, element) }] : [];
      }));
      const additions = elements.filter((element) => !draft.elements.some((row) => row.source?.sourceId === source.id && row.source.elementKey === element.key));
      update("elements", [...draft.elements, ...additions.map((element) => proposeSourceElement(source, element))]);
      setMessage(`${additions.length} work elements added for review. Repeated source elements were kept once. Source figures, owners and schedules remain in the original until you propose them.`);
    }} />
    {suggestions.length > 0 && <section className="space-y-4 rounded border p-4"><h3 className="font-semibold">Proposed extraction differences</h3><p className="text-sm">Existing edits stay in place until you accept an individual replacement. Earlier saved revisions remain unchanged.</p>{suggestions.map(({ existingId, proposed }) => {
      const existing = draft.elements.find((row) => row.id === existingId);
      if (!existing) return null;
      return <details key={existingId} className="rounded border p-3"><summary className="cursor-pointer">{existing.code} · compare source text</summary>{(["title", "objective", "discussion"] as const).map((field) => <div key={field} className="my-3 space-y-2"><p className="text-sm font-medium">{field}</p><p className="whitespace-pre-wrap text-sm">Current proposal: {existing[field]}</p><p className="whitespace-pre-wrap text-sm">New extraction: {proposed[field]}</p><Button type="button" variant="outline" disabled={!canWrite} onClick={() => update("elements", draft.elements.map((row) => row.id === existingId ? { ...row, [field]: proposed[field], sourceRefs: [...(row.sourceRefs ?? []), ...(proposed.source ? [{ ...proposed.source, purpose: field }] : [])] } : row))}>Accept extracted {field}</Button></div>)}{(["tasks", "products"] as const).map((kind) => <div key={kind} className="my-4 space-y-2"><h4 className="font-medium">{kind}</h4><p className="text-sm">Current proposal: {existing[kind].map((row) => row.description).join("; ") || "None"}</p>{proposed[kind].map((activity) => <div key={activity.id} className="space-y-2 border p-2"><p className="text-sm whitespace-pre-wrap">Extracted: {activity.description}</p><Button type="button" variant="outline" disabled={!canWrite || existing[kind].some((row) => row.description === activity.description)} onClick={() => update("elements", draft.elements.map((row) => row.id === existingId ? { ...row, [kind]: [...row[kind], { ...activity, sourceRefs: proposed.source ? [proposed.source] : [] }] } : row))}>Add this extracted {kind === "tasks" ? "task" : "product"}</Button><SelectField label="Replace only an existing description" value="" onChange={(id) => { if (id) update("elements", draft.elements.map((row) => row.id === existingId ? { ...row, [kind]: row[kind].map((current) => current.id === id ? { ...current, description: activity.description, sourceRefs: [...(current.sourceRefs ?? []), ...(proposed.source ? [proposed.source] : [])] } : current) } : row)); }}><option value="">Keep existing descriptions</option>{existing[kind].map((current) => <option key={current.id} value={current.id}>{current.description.slice(0,160)}</option>)}</SelectField></div>)}</div>)}<Button type="button" variant="outline" onClick={() => setSuggestions((rows) => rows.filter((row) => row.existingId !== existingId))}>Keep current proposal and close comparison</Button></details>;
    })}</section>}
    <WorkProgramComparison draft={draft} sources={selectedSources} />
    {corruptRecovery && <details className="rounded border p-3"><summary className="cursor-pointer">Recover damaged local content</summary><textarea aria-label="Retained damaged draft text" readOnly className="mt-3 w-full" rows={10} value={corruptRecovery} /></details>}
    <fieldset disabled={!canWrite || busy || !ready} className="min-w-0 space-y-6">
      <section className="space-y-4 rounded-lg border p-4"><h2 className="text-xl font-semibold">Agency and proposed cycle</h2><div className="grid min-w-0 gap-4 md:grid-cols-2">
        <SelectField label="Work program kind" value={draft.documentKind} onChange={(value) => update("documentKind", value as WorkProgramDraft["documentKind"])}><option value="owp">Overall work program</option><option value="upwp">Unified planning work program</option><option value="agency_work_program">Agency work program</option></SelectField>
        <Field label="Responsible agency" value={draft.agency} onChange={(value) => update("agency", value)} /><Field label="Responsible authority or adopting body" value={draft.responsibleAuthority} onChange={(value) => update("responsibleAuthority", value)} /><Field label="Authority basis and source reference" value={draft.authorityBasis} onChange={(value) => update("authorityBasis", value)} /><Field label="Program starts" type="date" value={draft.periodStart} onChange={(value) => update("periodStart", value)} /><Field label="Program ends" type="date" value={draft.periodEnd} onChange={(value) => update("periodEnd", value)} />
      </div><Field label="Proposed program narrative" multiline value={draft.introduction} onChange={(value) => update("introduction", value)} /><Field label="Proposed agency staffing and organization" multiline value={draft.staffing} onChange={(value) => update("staffing", value)} /><Field label="Financial assumptions, agency-wide tables and reconciliation notes" multiline value={draft.financialNotes} onChange={(value) => update("financialNotes", value)} />
        <div className="grid gap-4 md:grid-cols-2"><Field label="Currency code" value={draft.currency} onChange={(value) => update("currency", value)} /><Field label="Prior-year balance for reference, blank if unresolved" type="number" value={draft.priorBalance === null ? "" : String(draft.priorBalance)} onChange={(value) => update("priorBalance", value === "" ? null : Number(value))} /></div><Field label="Prior balance source, period and restrictions" multiline value={draft.priorBalanceBasis} onChange={(value) => update("priorBalanceBasis", value)} />
      </section>
      {!draft.preparation && <Button type="button" variant="outline" onClick={() => setDraft(upgradeWorkProgramDraft(draft))}>Prepare structured funding and staffing tables</Button>}
      <StructuredWorkProgramEditor draft={draft} sources={selectedSources} staff={staff} contracts={contracts} onChange={(preparation) => update("preparation", preparation)} />
      <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold">Proposed work elements</h2>{draft.elements.map((element) => <WorkProgramElementEditor key={element.id} element={element} sources={selectedSources} projects={projects} structured={Boolean(draft.preparation)} onChange={(value) => update("elements", draft.elements.map((row) => row.id === value.id ? value : row))} />)}<Button type="button" variant="outline" onClick={() => update("elements", [...draft.elements, { id: crypto.randomUUID(), source: null, code: "", title: "", disposition: "unresolved", decisionNote: "", objective: "", discussion: "", responsible: "", schedule: "", personMonths: null, budgetTreatment: "unresolved", budgetTreatmentNote: "", tasks: [], products: [], budget: [], projectId: null }])}>Add work element manually</Button></section>
    </fieldset>
    <section className="space-y-3 rounded-lg border p-4"><h2 className="text-xl font-semibold">Proposal reconciliation</h2><p>Revenue: {totals.revenue ?? "unresolved"} {draft.currency}. Cost: {totals.cost ?? "unresolved"} {draft.currency}. Difference: {totals.difference ?? "unresolved"}.</p><p className="text-sm">Unresolved carry-forward decisions: {totals.unresolvedDecisions}. Unresolved budget treatments: {totals.unresolvedBudgetTreatments}. Elements missing revenue or cost lines: {totals.missingBudgetElements}. Unresolved line amounts: {totals.missingAmounts}. Prior balance: {totals.priorBalanceUnresolved ? "unresolved" : "documented for reference only"}.</p><p className="text-sm text-muted-foreground">A balanced proposal does not establish funding eligibility, adoption or spending authority. Review all retained agency-wide tables and appendices separately.</p></section>
    {reconciliation && <section className="space-y-3 rounded border p-4"><h3 className="font-semibold">Discrepancies and contributing rows</h3><p className="text-sm">Known work-element funding subtotal: {reconciliation.knownRevenue ?? "unresolved"}. Known expenditure subtotal: {reconciliation.knownCost ?? "unresolved"}. These subtotals exclude unresolved work-element totals.</p>{reconciliation.issues.length ? reconciliation.issues.map((issue, index) => <p key={index} className="text-sm">{issue.message} {issue.rowIds.map((id, i) => <a key={id + i} className="mr-2 underline" href={`#owp-row-${id}`} onClick={() => { const node = document.getElementById(`owp-row-${id}`); if (node) { let parent: HTMLElement | null = node; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } } }}>Contributing row {i + 1}</a>)}</p>) : <p>No discrepancy was detected in the entered rows. Source coverage and missing evidence remain separate checks.</p>}</section>}
    <section className="space-y-3 rounded border p-4"><h3 className="font-semibold">Source coverage</h3>{coverage.map((row) => <p key={row.sourceId} className="text-sm">{row.title}: {row.unmappedElements.length} unmatched work elements ({row.unmappedElements.map((element) => element.code).join(", ") || "none"}); {row.uncoveredPages.length} PDF pages without a recorded passage ({row.uncoveredPages.join(", ") || "none"}).{row.amendmentUnresolved ? " Amendment relationship unresolved." : ""}</p>)}</section>
    {message && <p role="status" className="break-words rounded border p-3 text-sm">{message}</p>}
    {canWrite && <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy || !ready} onClick={() => void save()}>{busy ? "Saving or loading…" : "Save proposal revision"}</Button><Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy || !ready} onClick={() => void loadLatest()}>Discard local changes and load saved revision</Button></div>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">Saved revisions</h2>{preparation.revisions.length === 0 ? <p>No saved revision yet.</p> : preparation.revisions.map((revision) => <div key={revision.id} className="rounded border p-3 text-sm"><p>Revision {revision.revision} · {revision.created_at}</p><WorkProgramExports programId={programId} revision={revision.revision} /><p className="break-all text-xs text-muted-foreground">SHA-256: {revision.content_sha256}</p></div>)}</section>
  </div>;
}
