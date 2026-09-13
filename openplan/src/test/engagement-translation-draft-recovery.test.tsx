import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTranslationDrafts } from "@/components/engagement/translation-draft-recovery";
import { pendingTranslationSchema } from "@/lib/engagement/pending-translation";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId } from "./helpers/translation-editor-fixture";

const scope = { userId, workspaceId, campaignId: id(1) };
const address = { entityType: "campaign" as const, entityId: id(1), field: "title" };
const words = "\u00a0SYNTHETIC proposed words\ufeff";
function pending() {
  const snapshot = translationEditorFixture(), { revision, ...entry } = snapshot.translations[0];
  return pendingTranslationSchema.parse({ version: 1, ...scope, createdAt: "2026-09-13T00:00:00Z", phase: "unconfirmed",
    before: [{ revision, entry }], intent: { operation: "save", requestId: id(5), locale: "es", reason: "SYNTHETIC reason", entries: [{ ...address,
      text: words, expectedSource: { text: snapshot.campaign.title, sourceLocale: null, available: true }, expectedTranslation: { id: entry.id, revision } }] } });
}
beforeEach(() => sessionStorage.clear());
describe("translation draft acknowledgement custody", () => {
  it("clears only the draft matching the confirmed save and leaves other drafts alone", () => {
    const hook = renderHook(() => useTranslationDrafts(scope));
    act(() => { hook.result.current.setText(translationEditorFixture(), address, "es", words); hook.result.current.setText(translationEditorFixture(), address, "fr", "SYNTHETIC other language"); hook.result.current.setReason("SYNTHETIC reason"); });
    act(() => hook.result.current.clearConfirmed(pending()));
    expect(hook.result.current.record?.entries).toHaveLength(1); expect(hook.result.current.record?.entries[0].locale).toBe("fr"); expect(hook.result.current.reason).toBe("");
  });
  it.each(["words", "source", "identity", "revision"])("preserves a newer draft with changed %s after a delayed acknowledgement", changed => {
    const hook = renderHook(() => useTranslationDrafts(scope));
    act(() => hook.result.current.setText(translationEditorFixture(), address, "es", words));
    if (changed === "words") act(() => hook.result.current.setText(translationEditorFixture(), address, "es", words + " NEWER"));
    else {
      const newer = translationEditorFixture();
      if (changed === "source") newer.campaign.title = "SYNTHETIC new source";
      if (changed === "identity") newer.translations[0].id = id(99);
      if (changed === "revision") newer.translations[0].revision = 4;
      act(() => hook.result.current.reopen(pending(), newer));
    }
    const before = structuredClone(hook.result.current.record);
    act(() => hook.result.current.clearConfirmed(pending()));
    expect(hook.result.current.record?.entries).toEqual(before?.entries); expect(hook.result.current.record?.entries).toHaveLength(1);
  });
  it("preserves a newer reason after a delayed acknowledgement", () => {
    const hook = renderHook(() => useTranslationDrafts(scope));
    act(() => { hook.result.current.setText(translationEditorFixture(), address, "es", words); hook.result.current.setReason("SYNTHETIC next reason"); });
    act(() => hook.result.current.clearConfirmed(pending()));
    expect(hook.result.current.reason).toBe("SYNTHETIC next reason");
  });
});
