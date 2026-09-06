import type { WorkProgramDraft, WorkProgramElement } from "./schema";
import type { WorkProgramSource } from "./types";
import type { WorkProgramSourceElement } from "./source-extraction";

/** Copies narrative into a review draft; prior figures and commitments remain in the source. */
export function proposeSourceElement(source: WorkProgramSource, element: WorkProgramSourceElement): WorkProgramElement {
  return {
    id: crypto.randomUUID(),
    source: { sourceId: source.id, elementKey: element.key, pageFrom: element.pageFrom, pageTo: element.pageTo, tableLabel: "Work element narrative and budget" },
    code: element.code, title: element.title, disposition: "unresolved", decisionNote: "",
    objective: element.objective, discussion: element.discussion, responsible: "", schedule: "", personMonths: null,
    budgetTreatment: "unresolved", budgetTreatmentNote: "",
    tasks: element.currentActivities ? [{ id: crypto.randomUUID(), description: element.currentActivities, responsible: "", schedule: "" }] : [],
    products: element.products ? [{ id: crypto.randomUUID(), description: element.products, responsible: "", schedule: "" }] : [],
    budget: [], projectId: null,
  };
}

/** Server-side references must resolve to the retained source, including manual page citations. */
export function validateWorkProgramSources(draft: WorkProgramDraft, sources: WorkProgramSource[]): string | null {
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const element of draft.elements) {
    const ref = element.source;
    if (!ref) continue;
    const source = byId.get(ref.sourceId);
    if (!source) return `The source for work element ${element.code || element.title} is not attached to this program.`;
    if (ref.pageFrom < 1 || ref.pageTo < ref.pageFrom || ref.pageTo > source.page_count) return "A source page reference falls outside its retained document.";
    if (ref.elementKey) {
      const original = source.extraction_json.elements.find((candidate) => candidate.key === ref.elementKey);
      if (!original || original.pageFrom !== ref.pageFrom || original.pageTo !== ref.pageTo) return "A source work-element reference does not match the retained extraction. Use a manual page citation for a different passage.";
    }
  }
  return null;
}
