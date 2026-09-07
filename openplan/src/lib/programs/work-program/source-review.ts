import type { WorkProgramDraft, WorkProgramElement } from "./schema";
import type { WorkProgramSource } from "./types";
import type { WorkProgramSourceElement } from "./source-extraction";

/** Split numbered source activities without inventing a schedule or assignee. */
function sourceActivities(text: string, responsible: string) {
  return text.trim().split(/\n(?=\d+\.\s)/).filter(Boolean).map((part) => {
    const line = part.replace(/\s+/g, " ").trim();
    const scheduled = line.match(/(?:\.{2,}|…)[.\s…]*(.*)$/)
      ?? line.match(/(?<=\))\s*\.?\s*((?:as needed|ongoing|quarterly|annually|monthly|July|August|September|October|November|December|January|February|March|April|May|June)\b.*)$/i);
    const explicitRole = line.match(/\(([^()]*(?:staff|consultant|director|planner|operator)[^()]*)\)/i)?.[1];
    return { id: crypto.randomUUID(), description: (scheduled ? line.slice(0, scheduled.index) : line).replace(/^\d+\.\s*/, "").trim(), responsible: explicitRole ?? responsible, schedule: scheduled?.[1].replace(explicitRole ? `(${explicitRole})` : /$^/, "").replace(/[.…]{2,}/g, " ").replace(/\s+/g, " ").trim() ?? "" };
  });
}

/** Copies narrative into a review draft; prior figures and commitments remain in the source. */
export function proposeSourceElement(source: WorkProgramSource, element: WorkProgramSourceElement): WorkProgramElement {
  return {
    id: crypto.randomUUID(),
    source: { sourceId: source.id, extractionVersionId: source.selectedVersionId ?? null, elementKey: element.key, pageFrom: element.pageFrom, pageTo: element.pageTo, tableLabel: "Work element narrative and budget" },
    code: element.code, title: element.title, disposition: "unresolved", decisionNote: "",
    objective: element.objective, discussion: element.discussion, responsible: element.responsible ?? "", schedule: element.schedule ?? "", personMonths: null,
    budgetTreatment: "unresolved", budgetTreatmentNote: "",
    tasks: sourceActivities(element.currentActivities, element.responsible ?? ""),
    products: sourceActivities(element.products, element.responsible ?? ""),
    budget: [], projectId: null,
  };
}

/** Server-side references must resolve to the retained source, including manual page citations. */
export function validateWorkProgramSources(draft: WorkProgramDraft, sources: WorkProgramSource[]): string | null {
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const selected of draft.preparation?.extractionSelections ?? []) {
    const source = byId.get(selected.sourceId);
    if (!source || (selected.versionId && !source.versions?.some((version) => version.id === selected.versionId))) return "A selected extraction version does not belong to this program source.";
  }
  for (const ref of workProgramReferences(draft)) {
    const source = byId.get(ref.sourceId);
    if (!source) return "A cited source is not attached to this program.";
    const version = ref.extractionVersionId ? source.versions?.find((candidate) => candidate.id === ref.extractionVersionId) : null;
    if (ref.extractionVersionId && !version) return "A citation names an extraction version outside this retained source.";
    const pageCount = version?.page_count ?? source.page_count;
    const extraction = version?.extraction_json ?? source.extraction_json;
    if (ref.pageFrom < 1 || ref.pageTo < ref.pageFrom || ref.pageTo > pageCount) return "A source page reference falls outside its retained document.";
    if (ref.elementKey) {
      const original = extraction.elements.find((candidate) => candidate.key === ref.elementKey);
      if (!original || original.pageFrom !== ref.pageFrom || original.pageTo !== ref.pageTo) return "A source work-element reference does not match the retained extraction. Use a manual page citation for a different passage.";
    }
  }
  for (const row of draft.preparation?.amendments ?? []) if (!byId.has(row.amendmentSourceId) || !byId.has(row.modifiesSourceId)) return "An amendment relationship names a source outside this program.";
  return null;
}

export function workProgramReferences(draft: WorkProgramDraft) {
  const elements = draft.elements.flatMap((element) => [
    ...(element.source ? [element.source] : []), ...(element.sourceRefs ?? []),
    ...[...element.tasks, ...element.products, ...element.budget].flatMap((row) => row.sourceRefs ?? []),
  ]);
  const p = draft.preparation;
  return p ? [...elements, ...[...(p.referenceFigures ?? []), ...p.funds, ...p.allocations, ...p.costs, ...p.staffing, ...p.indirectPools, ...p.mappings, ...p.sourceSections, ...p.amendments, ...p.conflicts].flatMap((row) => row.sourceRefs)] : elements;
}

/** Selecting a newer extraction never changes the proposal or its manual corrections. */
export function selectWorkProgramSources(draft: WorkProgramDraft, sources: WorkProgramSource[]) {
  return sources.map((source) => {
    const id = draft.preparation?.extractionSelections.find((selection) => selection.sourceId === source.id)?.versionId ?? null;
    const version = id ? source.versions?.find((candidate) => candidate.id === id) : null;
    return version ? { ...source, extraction_json: version.extraction_json, page_count: version.page_count, selectedVersionId: version.id } : { ...source, selectedVersionId: null };
  });
}

export function workProgramCoverage(draft: WorkProgramDraft, sources: WorkProgramSource[]) {
  const refs = workProgramReferences(draft);
  return selectWorkProgramSources(draft, sources).map((source) => {
    const matching = refs.filter((ref) => ref.sourceId === source.id && (ref.extractionVersionId ?? null) === (source.selectedVersionId ?? null));
    const unmappedElements = source.extraction_json.elements.filter((element) => !matching.some((ref) => ref.elementKey === element.key));
    const uncoveredPages = Array.from({ length: source.page_count }, (_, index) => index + 1).filter((page) => !matching.some((ref) => ref.pageFrom <= page && ref.pageTo >= page));
    const amendmentUnresolved = source.source_role === "amendment" && !draft.preparation?.amendments.some((row) => row.amendmentSourceId === source.id && row.status !== "unresolved" && row.note.trim());
    return { sourceId: source.id, title: source.title, unmappedElements, uncoveredPages, amendmentUnresolved };
  });
}
