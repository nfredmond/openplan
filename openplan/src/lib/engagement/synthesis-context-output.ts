import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/), index = z.number().int().nonnegative().safe();
// JSON Schema maxLength counts Unicode code points, not UTF-16 code units.
const textSchema = z.string().min(1).refine(text => Array.from(text).length <= 4000, "Context text exceeds 4000 code points");
const citationSchema = z.object({ partId: hash, quote: textSchema }).strict();
const noteSchema = z.object({ id: index, text: textSchema,
  citations: z.array(citationSchema).min(1), relatedNoteIds: z.array(index) }).strict();
export const synthesisContextOutputSchema = z.object({ status: z.enum(["complete", "incomplete"]), coveredPartIds: z.array(hash),
  notes: z.array(noteSchema), uncertainties: z.array(textSchema) }).strict();
export type SynthesisContextOutput = z.infer<typeof synthesisContextOutputSchema>;
