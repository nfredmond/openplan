import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { authorizeRtpCycleWrite } from "@/lib/rtp/cycle-write-authorization";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readRetainedSourcePage } from "@/lib/rtp/extraction/source-pages";

const querySchema = z.object({ kbDocumentId: z.string().uuid(), documentExtractionId: z.string().uuid(), page: z.coerce.number().int().positive() }).strict();
export async function GET(request: NextRequest, context: { params: Promise<{ rtpCycleId: string }> }) {
  const audit = createApiAuditLogger("rtp.manual_source_page", request);
  try {
    const { rtpCycleId } = await context.params;
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!z.string().uuid().safeParse(rtpCycleId).success || !query.success) return NextResponse.json({ error: "Choose a document, retained version and page number." }, { status: 400 });
    const client = await createClient();
    const access = await authorizeRtpCycleWrite(client as unknown as Parameters<typeof authorizeRtpCycleWrite>[0], audit, rtpCycleId);
    if (!access.ok) return access.response;
    const result = await readRetainedSourcePage(client, { cycleId: rtpCycleId, documentId: query.data.kbDocumentId, extractionId: query.data.documentExtractionId, page: query.data.page });
    return NextResponse.json(result.ok ? result.page : { error: result.error, reason: result.reason }, { status: result.ok ? 200 : result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    audit.error("retained_page_read_unavailable");
    return NextResponse.json({ error: "Retained source pages are unavailable. Keep your draft and retry.", reason: "source_unavailable" }, { status: 503 });
  }
}
