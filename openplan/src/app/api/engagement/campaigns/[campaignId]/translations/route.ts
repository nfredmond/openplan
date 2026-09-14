import { NextResponse } from "next/server";

/** Older clients have no frozen versions or request identity. Never infer them or replay their writes. */
function retiredTranslationWrite() {
  return NextResponse.json({
    kind: "retired",
    error: "This translation editor is out of date. Keep a copy of any unsaved words, then reopen the campaign's translation editor before saving, generating, accepting or withdrawing translations.",
    details: "This request did not change saved translations or request machine generation.",
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}

export function POST() { return retiredTranslationWrite(); }
export function DELETE() { return retiredTranslationWrite(); }
