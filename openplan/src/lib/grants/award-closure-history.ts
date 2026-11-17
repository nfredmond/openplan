import { z } from "zod";

// A counted read either returns every retained receipt within this limit or refuses.
export const AWARD_CLOSURE_HISTORY_LIMIT = 500;
export const AWARD_CLOSURE_RECEIPT_SELECT = "id, award_id, workspace_id, revision_id, event, basis, actor_id, created_at";

export const awardClosureReceiptSchema = z.object({
  id: z.string().uuid(),
  award_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  revision_id: z.string().uuid().nullable(),
  event: z.enum(["earned_coverage", "reconciled_with_balance", "recorded_on_import", "reopen"]),
  // The database permits any JSON shape. Do not turn legacy payloads into facts.
  basis: z.unknown().refine((value) => value !== undefined, "Retained basis required"),
  actor_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
});

export type AwardClosureReceipt = z.infer<typeof awardClosureReceiptSchema>;

const historySchema = z.object({
  state: z.literal("available"),
  awardId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  limit: z.literal(AWARD_CLOSURE_HISTORY_LIMIT),
  receipts: z.array(awardClosureReceiptSchema).max(AWARD_CLOSURE_HISTORY_LIMIT),
});

export type AwardClosureHistory = z.infer<typeof historySchema>;

/** Bind both server rows and browser responses to the validated award scope. */
export function readAwardClosureHistory(value: unknown, awardId: string): AwardClosureHistory | null {
  const parsed = historySchema.safeParse(value);
  if (!parsed.success || parsed.data.awardId !== awardId) return null;
  const history = parsed.data;
  if (history.receipts.some((row) => row.award_id !== awardId || row.workspace_id !== history.workspaceId)) return null;
  if (new Set(history.receipts.map((row) => row.id)).size !== history.receipts.length) return null;
  return history;
}

const previousClosureSchema = z.object({
  basis: z.string().nullable(),
  closedAt: z.string().datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
});
const commonBasisSchema = z.object({
  previousClosure: previousClosureSchema,
  expectedCurrent: z.string().uuid().nullable(),
  note: z.string().nullable(),
});
const reopenBasisSchema = commonBasisSchema.extend({
  reopenSpendingStatus: z.enum(["not_started", "active", "delayed"]).optional(),
});
const coverageBasisSchema = commonBasisSchema.extend({
  ceiling: z.string().regex(/^\d+(?:\.\d+)?$/),
  paid: z.string().regex(/^\d+(?:\.\d+)?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  invoices: z.array(z.unknown()),
});

// Written by funding_award_closeout_command (20261117000000) for awards with no
// handoff revision: no revision, no currency, and the open-request count the
// close-out was checked against.
const unmanagedCloseBasisSchema = commonBasisSchema.extend({
  ceiling: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  paid: z.string().regex(/^\d+(?:\.\d+)?$/),
  openRequests: z.number().int().min(0),
  released: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
});

/** Interpret only the shapes written by the retained close-out functions. */
export function readClosureBasis(receipt: AwardClosureReceipt) {
  if (receipt.event === "reopen") {
    const parsed = reopenBasisSchema.safeParse(receipt.basis);
    return parsed.success && parsed.data.expectedCurrent === receipt.revision_id
      ? { kind: "reopen" as const, ...parsed.data } : { kind: "unassessed" as const };
  }
  if (receipt.event === "earned_coverage" && receipt.revision_id !== null) {
    const parsed = coverageBasisSchema.safeParse(receipt.basis);
    return parsed.success && parsed.data.expectedCurrent === receipt.revision_id
      ? { kind: "earned_coverage" as const, ...parsed.data, released: null } : { kind: "unassessed" as const };
  }
  if (receipt.revision_id === null) {
    const parsed = unmanagedCloseBasisSchema.safeParse(receipt.basis);
    if (!parsed.success || parsed.data.expectedCurrent !== null) return { kind: "unassessed" as const };
    if (receipt.event === "recorded_on_import") return { kind: "imported" as const, ...parsed.data };
    if (receipt.event === "reconciled_with_balance") {
      return parsed.data.released
        ? { kind: "reconciled" as const, ...parsed.data, currency: null, released: parsed.data.released }
        : { kind: "unassessed" as const };
    }
    return { kind: "earned_coverage" as const, ...parsed.data, currency: null, released: null };
  }
  return { kind: "unassessed" as const };
}
