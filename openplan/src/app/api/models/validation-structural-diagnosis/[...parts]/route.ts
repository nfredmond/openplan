import { NextRequest, NextResponse } from "next/server";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { readPublishedStructuralDiagnosisDownload } from "@/lib/models/published-structural-diagnosis";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ parts: string[] }> },
) {
  const audit = createApiAuditLogger("models.validation_structural_diagnosis.download", request);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    audit.warn("authentication_required");
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const requestedParts = (await params).parts;
    const download = await readPublishedStructuralDiagnosisDownload(requestedParts);
    if (!download) {
      audit.info("file_not_found", { requestedParts });
      return NextResponse.json({ error: "Published diagnosis file not found" }, { status: 404 });
    }
    audit.info("download_succeeded", {
      requestedParts,
      sha256: download.sha256,
    });
    return new Response(new Uint8Array(download.bytes), {
      headers: {
        "Content-Type": download.contentType,
        "Content-Disposition": `attachment; filename="${download.filename}"`,
        "Cache-Control": "private, no-store",
        "X-OpenPlan-SHA256": download.sha256,
      },
    });
  } catch (error) {
    audit.error("download_failed", { error });
    return NextResponse.json({ error: "Published diagnosis file is unavailable" }, { status: 503 });
  }
}
