import { z } from "zod";

/** One full retained page per read. Oversized pages refuse rather than truncate. */
export const RETAINED_PAGE_MAX_CHARS = 200_000;
export const retainedPageSchema = z.object({
  documentId: z.string().uuid(), extractionId: z.string().uuid(),
  checksum: z.string().min(1), contentSha256: z.string().min(1),
  source: z.enum(["text_layer", "ocr"]), page: z.number().int().positive(),
  pageCount: z.number().int().positive(), text: z.string().min(1).max(RETAINED_PAGE_MAX_CHARS).refine((value) => value.trim().length > 0),
});
export type RetainedSourcePage = z.infer<typeof retainedPageSchema>;

type PageClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message: string; code?: string } | null;
  }>;
};

/** The RPC projects only the selected page and binds it to cycle, original and job mode. */
export async function readRetainedSourcePage(client: PageClient, input: {
  cycleId: string; documentId: string; extractionId: string; page: number;
}) {
  const result = await client.rpc("read_rtp_retained_source_page", {
    p_cycle_id: input.cycleId, p_document_id: input.documentId,
    p_extraction_id: input.extractionId, p_page: input.page,
  });
  if (result.error) return { ok: false as const, status: result.error.code === "PT409" ? 409 : 503,
    reason: result.error.code === "PT409" ? "source_drift" : "source_unavailable",
    error: "The retained page could not be read. Check the selected version and retry; no proposal was stored." };
  if (result.data === null) return { ok: false as const, status: 404,
    reason: "source_missing", error: "That retained page is missing or is outside this plan's permitted documents." };
  const parsed = retainedPageSchema.safeParse(result.data);
  if (!parsed.success) return { ok: false as const, status: 409, reason: "source_uncheckable",
    error: "This page has no checkable text or exceeds the 200,000-character page limit. Use the retained original; verified intake remains unavailable for this page." };
  if (parsed.data.documentId !== input.documentId || parsed.data.extractionId !== input.extractionId
    || parsed.data.page !== input.page || parsed.data.pageCount < input.page) return {
    ok: false as const, status: 409, reason: "source_drift", error: "The returned page does not match the selected source version. Nothing was stored.",
  };
  return { ok: true as const, page: parsed.data };
}
