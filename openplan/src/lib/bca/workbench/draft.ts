import { z } from "zod";
import { bcaDocumentSchema, type BcaDocument } from "./schema";

// Editing can temporarily violate calculation bounds. Retain the complete typed
// structure without requiring a finished analysis, so a reload can repair it.
function editableShape(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodString) return z.string();
  if (schema instanceof z.ZodNumber) return z.number().finite();
  if (schema instanceof z.ZodNullable) return editableShape(schema.unwrap()).nullable();
  if (schema instanceof z.ZodDefault) return editableShape(schema.removeDefault());
  if (schema instanceof z.ZodArray) return z.array(editableShape(schema.element));
  if (schema instanceof z.ZodObject) {
    return z.object(Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, editableShape(field as z.ZodType)]))).strict();
  }
  return schema;
}
export const bcaDraftSchema = editableShape(bcaDocumentSchema) as z.ZodType<BcaDocument>;
export const bcaRetainedSaveSchema = z.object({
  id: z.string().uuid(), document: bcaDocumentSchema,
}).strict();
export type BcaRetainedSave = z.infer<typeof bcaRetainedSaveSchema>;

/** Recover draft and pending request independently; callers preserve any unreadable original. */
export function readBcaDraft(raw: string, projectId: string) {
  const stored = z.object({document: z.unknown(), pending: z.unknown().optional()}).strict().parse(JSON.parse(raw));
  const draft = bcaDraftSchema.safeParse(stored.document);
  const save = stored.pending == null ? null : bcaRetainedSaveSchema.safeParse(stored.pending);
  const document = draft.success && draft.data.projectId === projectId ? draft.data : null;
  const pending = save?.success && save.data.document.projectId === projectId ? save.data : null;
  return { document, pending, unreadable: !document || (stored.pending != null && !pending) };
}
