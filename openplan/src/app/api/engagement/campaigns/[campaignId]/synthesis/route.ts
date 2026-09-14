import { NextRequest, NextResponse } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

/** Old requests have neither retained sources nor recoverable command identity. Do not replay them. */
export function POST(request: NextRequest) {
  createApiAuditLogger("engagement.synthesis.retired", request).warn("engagement_synthesis_write_retired", { status: 410 });
  return NextResponse.json({
    kind: "retired",
    error: "This synthesis generator is retired. Keep a copy of any unsaved text, then reopen Analysis and use retained synthesis sources and staff reviews.",
    details: "This request did not change saved summaries or request machine generation. Earlier summaries remain available as historical records. Staff reviews do not generate AI themes or approve findings.",
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
