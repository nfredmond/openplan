import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRANSLATION_LANGUAGES } from "./translation-languages";

const id = z.string().uuid().toLowerCase();
// Fixed UTC microseconds sort exactly as PostgreSQL timestamps. Do not pass a
// cursor through Date.toISOString(), which would discard its last three digits.
const createdAt = z.string().datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
export const translationGenerationCursorSchema = z.object({ createdAt, id }).strict();
export type TranslationGenerationCursor = z.infer<typeof translationGenerationCursorSchema>;
const count = z.number().int().min(0).max(25);
const counts = z.object({ queued: count, reserved: count, running: count, completed: count, incomplete: count, failed: count, interrupted: count, cancelled: count }).strict();
export const translationGenerationCatalogSchema = z.object({ schema: z.literal(1), campaignId: id, workspaceId: id,
  requests: z.array(z.object({ id, actorId: id, locale: z.enum(TRANSLATION_LANGUAGES), createdAt,
    fieldCount: z.number().int().min(1).max(25), counts }).strict()).max(20), next: translationGenerationCursorSchema.nullable(),
}).strict();
export type TranslationGenerationCatalog = z.infer<typeof translationGenerationCatalogSchema>;
function earlier(left: TranslationGenerationCursor, right: TranslationGenerationCursor) {
  return left.createdAt < right.createdAt || left.createdAt === right.createdAt && left.id < right.id;
}

// A page is scoped, internally reconciled and ordered. Pagination exposes saved
// jobs after browser storage loss; it never creates or retries model dispatches.
export function readTranslationGenerationCatalog(raw: unknown, scope: { campaignId: string; workspaceId: string }, cursor: TranslationGenerationCursor | null = null) {
  const page = translationGenerationCatalogSchema.parse(raw);
  const wantedCursor = cursor === null ? null : translationGenerationCursorSchema.parse(cursor);
  if (page.campaignId !== scope.campaignId.toLowerCase() || page.workspaceId !== scope.workspaceId.toLowerCase() ||
    new Set(page.requests.map(request => request.id)).size !== page.requests.length) throw new Error("translation_generation_catalog_scope_invalid");
  let previous = wantedCursor;
  for (const request of page.requests) {
    if (Object.values(request.counts).reduce((sum, value) => sum + value, 0) !== request.fieldCount ||
      previous !== null && !earlier(request, previous)) throw new Error("translation_generation_catalog_page_invalid");
    previous = request;
  }
  const last = page.requests.at(-1);
  if (page.next !== null && (page.requests.length !== 20 || !last || page.next.id !== last.id || page.next.createdAt !== last.createdAt)) {
    throw new Error("translation_generation_catalog_cursor_invalid");
  }
  return page;
}

export async function loadTranslationGenerationCatalog(client: Pick<SupabaseClient, "rpc">, scope: { campaignId: string; workspaceId: string }, cursor: TranslationGenerationCursor | null = null) {
  const checked = cursor === null ? null : translationGenerationCursorSchema.parse(cursor);
  const response = await client.rpc("list_translation_generation_requests", { p_campaign: scope.campaignId,
    p_before_created_at: checked?.createdAt ?? null, p_before_id: checked?.id ?? null }).abortSignal(AbortSignal.timeout(10000));
  if (response.error) return { page: null, forbidden: response.error.code === "42501" } as const;
  return { page: readTranslationGenerationCatalog(response.data, scope, checked), forbidden: false } as const;
}
