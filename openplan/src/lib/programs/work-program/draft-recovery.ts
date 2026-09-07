import { z } from "zod";
import { workProgramDraftSchema, type WorkProgramDraft } from "./schema";
import { emptyStructuredPreparation } from "./reconciliation";

export type PendingWorkProgramSave = { expectedRevision: number; requestId: string; draft: WorkProgramDraft };

/** Validate nested render structure while retaining legitimate incomplete edits for correction. */
export function recoverWorkProgramDraft(raw: string): { draft: WorkProgramDraft; baseRevision: number; pending: PendingWorkProgramSave | null } | null {
  try {
    const envelope = z.object({ draft: z.unknown(), baseRevision: z.number().int().min(0), pending: z.unknown().nullable() }).strict().parse(JSON.parse(raw));
    const result = workProgramDraftSchema.safeParse(envelope.draft);
    // Business-rule errors remain editable. Wrong object/array/value types must never reach render.
    if (!result.success && result.error.issues.some((issue) => issue.code !== "custom" && issue.code !== "invalid_format" && !(issue.code === "too_small" && issue.origin === "string"))) return null;
    const draft = envelope.draft as WorkProgramDraft;
    const pending = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), draft: workProgramDraftSchema }).strict().safeParse(envelope.pending);
    return { draft, baseRevision: envelope.baseRevision, pending: pending.success && pending.data.expectedRevision === envelope.baseRevision ? pending.data : null };
  } catch { return null; }
}

/** Conversion is a new local proposal, never a rewrite of the saved historical revision. */
export function upgradeWorkProgramDraft(draft: WorkProgramDraft): WorkProgramDraft {
  if (draft.preparation) return draft;
  const preparation = emptyStructuredPreparation();
  for (const element of draft.elements) for (const line of element.budget) {
    const sourceRefs = line.sourceRefs ?? (element.source ? [element.source] : []);
    if (line.kind === "revenue") {
      const id = crypto.randomUUID();
      preparation.funds.push({ id, sourceRefs, name: line.label, vintage: line.fundingYear, periodStart: draft.periodStart, periodEnd: draft.periodEnd, kind: "proposed", amount: line.amount, basis: "unresolved", note: `Converted historical line. Confirm funding vintage, availability and source: ${line.note}` });
      preparation.allocations.push({ id: crypto.randomUUID(), sourceRefs, fundId: id, elementId: element.id, taskId: null, amount: line.amount, matchForFundId: null, note: "Converted historical proposal allocation; funding basis remains unresolved." });
    } else preparation.costs.push({ id: crypto.randomUUID(), sourceRefs, elementId: element.id, taskId: null, label: line.label, category: "direct", amount: line.amount, contractId: null, indirectPoolId: null, note: `Converted historical category; review direct/consultant/indirect/labor treatment. ${line.note}` });
  }
  return { ...draft, preparation };
}
