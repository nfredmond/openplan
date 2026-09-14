import { NextRequest, NextResponse } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

/** Older clients have no frozen versions or request identity. Never infer them or replay their writes. */
function retiredTranslationWrite(request: NextRequest) {
  createApiAuditLogger("engagement.translations.retired", request).warn("engagement_translation_write_retired", { status: 410 });
  return NextResponse.json({
    kind: "retired",
    error: "This translation editor is out of date. Keep a copy of any unsaved words, then reopen the campaign's translation editor before saving, generating, accepting or withdrawing translations.",
    details: "This request did not change saved translations or request machine generation.",
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}

export function POST(request: NextRequest) { return retiredTranslationWrite(request); }
export function DELETE(request: NextRequest) { return retiredTranslationWrite(request); }
