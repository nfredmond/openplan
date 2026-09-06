"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { reconcileWorkProgram, workProgramDraftSchema, type WorkProgramDraft } from "@/lib/programs/work-program/schema";
import { proposeSourceElement } from "@/lib/programs/work-program/source-review";
import type { WorkProgramPreparation, WorkProgramRevision } from "@/lib/programs/work-program/types";
import { Field, SelectField } from "./fields";
import { WorkProgramSources } from "./sources";
import { WorkProgramElementEditor } from "./element-editor";

type Props = { programId: string; workspaceId: string; userId: string; agency: string; initial: WorkProgramPreparation; documents: { id: string; title: string }[]; projects: { id: string; name: string }[]; canWrite: boolean };
type PendingSave = { expectedRevision: number; requestId: string; draft: WorkProgramDraft };
function emptyDraft(agency: string): WorkProgramDraft {
  return { schemaVersion: 1, documentKind: "owp", agency, responsibleAuthority: "", authorityBasis: "", periodStart: "", periodEnd: "", introduction: "", staffing: "", financialNotes: "", currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [] };
}
export function WorkProgramEditor({ programId, workspaceId, userId, agency, initial, documents, projects, canWrite }: Props) {
  const [preparation, setPreparation] = useState(initial);
  const [draft, setDraft] = useState(initial.latest?.content_json ?? emptyDraft(agency));
  const [baseRevision, setBaseRevision] = useState(initial.latest?.revision ?? 0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recovered, setRecovered] = useState(false);
  const pending = useRef<PendingSave | null>(null);
  const storageKey = `openplan-work-program:${workspaceId}:${userId}:${programId}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(preparation.latest?.content_json ?? emptyDraft(agency));
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && canWrite) {
        const local = JSON.parse(saved) as { draft: WorkProgramDraft; baseRevision: number; pending: PendingSave | null };
        // Local storage is recovery convenience, never an authorization or
        // validation boundary. The server checks the complete proposal again.
        if (local.draft?.schemaVersion === 1 && Array.isArray(local.draft.elements) && Number.isInteger(local.baseRevision)) {
          setDraft(local.draft); setBaseRevision(local.baseRevision); pending.current = local.pending; setRecovered(true);
          setMessage("Recovered this tab's local proposal. Compare its base revision with the saved revision before saving.");
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
    const parsed = workProgramDraftSchema.safeParse(draft);
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
      setMessage(`Saved revision ${revision.revision}. Export this revision for separate planner and finance review.`);
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
  return <div className="min-w-0 space-y-6">
    <div className="rounded-lg border p-4 text-sm"><p>Preparation draft. This draft does not adopt a program, authorize spending, assign live work or log actual costs.</p><p className="mt-2">Editing from revision {baseRevision}. Latest loaded revision: {preparation.latest?.revision ?? "none"}.{dirty ? " Local changes are not saved to the program." : ""}{recovered ? " A local recovery was loaded." : ""}</p></div>
    <WorkProgramSources programId={programId} workspaceId={workspaceId} sources={preparation.sources} documents={documents} canWrite={canWrite && !busy} onAttached={refreshSources} onPropose={(source, elements) => {
      const additions = elements.filter((element) => !draft.elements.some((row) => row.source?.sourceId === source.id && row.source.elementKey === element.key));
      update("elements", [...draft.elements, ...additions.map((element) => proposeSourceElement(source, element))]);
      setMessage(`${additions.length} work elements added for review. Repeated source elements were kept once. Source figures, owners and schedules remain in the original until you propose them.`);
    }} />
    <fieldset disabled={!canWrite || busy || !ready} className="min-w-0 space-y-6">
      <section className="space-y-4 rounded-lg border p-4"><h2 className="text-xl font-semibold">Agency and proposed cycle</h2><div className="grid min-w-0 gap-4 md:grid-cols-2">
        <SelectField label="Work program kind" value={draft.documentKind} onChange={(value) => update("documentKind", value as WorkProgramDraft["documentKind"])}><option value="owp">Overall work program</option><option value="upwp">Unified planning work program</option><option value="agency_work_program">Agency work program</option></SelectField>
        <Field label="Responsible agency" value={draft.agency} onChange={(value) => update("agency", value)} /><Field label="Responsible authority or adopting body" value={draft.responsibleAuthority} onChange={(value) => update("responsibleAuthority", value)} /><Field label="Authority basis and source reference" value={draft.authorityBasis} onChange={(value) => update("authorityBasis", value)} /><Field label="Program starts" type="date" value={draft.periodStart} onChange={(value) => update("periodStart", value)} /><Field label="Program ends" type="date" value={draft.periodEnd} onChange={(value) => update("periodEnd", value)} />
      </div><Field label="Proposed program narrative" multiline value={draft.introduction} onChange={(value) => update("introduction", value)} /><Field label="Proposed agency staffing and organization" multiline value={draft.staffing} onChange={(value) => update("staffing", value)} /><Field label="Financial assumptions, agency-wide tables and reconciliation notes" multiline value={draft.financialNotes} onChange={(value) => update("financialNotes", value)} />
        <div className="grid gap-4 md:grid-cols-2"><Field label="Currency code" value={draft.currency} onChange={(value) => update("currency", value)} /><Field label="Prior-year balance for reference, blank if unresolved" type="number" value={draft.priorBalance === null ? "" : String(draft.priorBalance)} onChange={(value) => update("priorBalance", value === "" ? null : Number(value))} /></div><Field label="Prior balance source, period and restrictions" multiline value={draft.priorBalanceBasis} onChange={(value) => update("priorBalanceBasis", value)} />
      </section>
      <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold">Proposed work elements</h2>{draft.elements.map((element) => <WorkProgramElementEditor key={element.id} element={element} sources={preparation.sources} projects={projects} onChange={(value) => update("elements", draft.elements.map((row) => row.id === value.id ? value : row))} />)}<Button type="button" variant="outline" onClick={() => update("elements", [...draft.elements, { id: crypto.randomUUID(), source: null, code: "", title: "", disposition: "unresolved", decisionNote: "", objective: "", discussion: "", responsible: "", schedule: "", personMonths: null, budgetTreatment: "unresolved", budgetTreatmentNote: "", tasks: [], products: [], budget: [], projectId: null }])}>Add work element manually</Button></section>
    </fieldset>
    <section className="space-y-3 rounded-lg border p-4"><h2 className="text-xl font-semibold">Proposal reconciliation</h2><p>Revenue: {totals.revenue ?? "unresolved"} {draft.currency}. Cost: {totals.cost ?? "unresolved"} {draft.currency}. Difference: {totals.difference ?? "unresolved"}.</p><p className="text-sm">Unresolved carry-forward decisions: {totals.unresolvedDecisions}. Unresolved budget treatments: {totals.unresolvedBudgetTreatments}. Elements missing revenue or cost lines: {totals.missingBudgetElements}. Unresolved line amounts: {totals.missingAmounts}. Prior balance: {totals.priorBalanceUnresolved ? "unresolved" : "documented for reference only"}.</p><p className="text-sm text-muted-foreground">A balanced proposal does not establish funding eligibility, adoption or spending authority. Review all retained agency-wide tables and appendices separately.</p></section>
    {message && <p role="status" className="break-words rounded border p-3 text-sm">{message}</p>}
    {canWrite && <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy || !ready} onClick={() => void save()}>{busy ? "Saving or loading…" : "Save proposal revision"}</Button><Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy || !ready} onClick={() => void loadLatest()}>Discard local changes and load saved revision</Button></div>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">Saved revisions</h2>{preparation.revisions.length === 0 ? <p>No saved revision yet.</p> : preparation.revisions.map((revision) => <div key={revision.id} className="rounded border p-3 text-sm"><p>Revision {revision.revision} · {revision.created_at}</p><div className="my-2 flex flex-wrap gap-4">{(["html", "pdf", "xlsx"] as const).map((format) => <a key={format} className="underline" href={`/api/programs/${programId}/work-program/export?revision=${revision.revision}&format=${format}`} target={format === "html" ? "_blank" : undefined} rel="noreferrer">{format === "html" ? "Read proposal" : `Export ${format.toUpperCase()}`}</a>)}</div><p className="break-all text-xs text-muted-foreground">SHA-256: {revision.content_sha256}</p></div>)}</section>
  </div>;
}
