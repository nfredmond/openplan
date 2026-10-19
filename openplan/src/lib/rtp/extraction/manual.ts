import { z } from "zod";
import { RTP_EXTRACTION_TARGET_KINDS, RTP_EXTRACTION_TARGETS } from "./contract";

export const manualProposalSchema = z.object({
  requestId: z.string().uuid(), kbDocumentId: z.string().uuid(),
  documentExtractionId: z.string().uuid(), sourcePage: z.number().int().positive(),
  documentChecksum: z.string().min(1).max(200), contentSha256: z.string().min(1).max(200),
  targetKind: z.enum(RTP_EXTRACTION_TARGET_KINDS), quote: z.string().min(1).max(8000),
  fields: z.record(z.string(), z.union([z.string().max(8000), z.number().finite(), z.null()])),
}).strict();

/** Money in these existing contracts is whole dollars. Reject fractions before Number coercion. */
export function manualFieldRefusal(kind: (typeof RTP_EXTRACTION_TARGET_KINDS)[number], fields: Record<string, unknown>) {
  const spec = RTP_EXTRACTION_TARGETS[kind];
  if (kind === "financial_line" && typeof fields.sourceName === "string"
    && /^(?:(?:grand|sub)[ -]?)?total\b|^subtotal\b|^(?:net\s+)?balance\b/i.test(fields.sourceName.trim())) {
    return "Enter the individual revenue or cost row. Totals, subtotals and balances belong to the existing calculations.";
  }
  for (const [key, value] of Object.entries(fields)) {
    const field = spec.fields.find((entry) => entry.key === key);
    if (!field) return `The ${key} field is not part of this source record.`;
    if (value === null || value === "") continue;
    if (field.zeroMeansUnpriced) {
      const digits = typeof value === "string" ? value.replace(/[$,\s]/g, "") : String(value);
      if (!/^\d+$/.test(digits) || !Number.isSafeInteger(Number(digits)) || Number(digits) > (field.max ?? Number.MAX_SAFE_INTEGER)) {
        return "Enter the exact whole-dollar source amount without rounding. Leave an unknown project cost blank. Fractional dollars are outside this transcription contract.";
      }
    }
  }
  return null;
}
