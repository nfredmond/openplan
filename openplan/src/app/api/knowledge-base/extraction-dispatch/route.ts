import { NextRequest, NextResponse } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { pendingExtractionRequests, pendingExtractionCancellations } from "@/lib/knowledge-base/extraction-jobs";

/** The configured Documents worker recovers jobs after either process restarts. */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("documents.extraction.dispatch", request);
  const secret = process.env.OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secret || !timingSafeSecretEquals(supplied, secret)) { audit.warn("dispatch_unauthorized"); return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    return NextResponse.json({ requests: await pendingExtractionRequests(new URL(request.url).origin), cancelRequestIds: await pendingExtractionCancellations(new URL(request.url).origin) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    audit.error("dispatch_unavailable");
    return NextResponse.json({ error: "Dispatch is unavailable; retained jobs will be retried." }, { status: 503 });
  }
}
