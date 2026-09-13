import { describe, expect, it } from "vitest";
import { archiveTranslationDrafts, readTranslationDraftState, readTranslationDrafts, retainTranslationDrafts, translationDraftRecordSchema,
  translationDraftStorageKey, type TranslationDraftRecord } from "@/lib/engagement/translation-drafts";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId } from "./helpers/translation-editor-fixture";

const scope = { userId, workspaceId, campaignId: id(1) };
function record(): TranslationDraftRecord {
  const snapshot = translationEditorFixture(); const { revision, ...entry } = snapshot.translations[0];
  return { version: 1, ...scope, reason: "\u00a0SYNTHETIC reason\ufeff", entries: [{ locale: "es", entityType: "campaign", entityId: id(1), field: "title",
    text: "\u00a0SYNTHETIC unsaved words\ufeff", source: { text: snapshot.campaign.title, sourceLocale: null, available: true }, before: { revision, entry } }] };
}
function storage() {
  const rows = new Map<string, string>();
  return { rows, getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}
const key = translationDraftStorageKey(scope);

describe("unsent translation draft custody", () => {
  it("keeps raw words, reasons and starting copies without imposing the submission word limit", () => {
    const target = storage(), draft = record(); draft.entries[0].text += "a".repeat(9000);
    expect(retainTranslationDrafts(target, draft, target.getItem(key))).toEqual(draft); expect(readTranslationDrafts(target, scope)).toEqual(draft);
    draft.entries[0].text = ""; retainTranslationDrafts(target, draft, target.getItem(key)); expect(readTranslationDrafts(target, scope).entries[0].text).toBe("");
    const unsupported = record(); unsupported.entries[0].locale = "qaa"; unsupported.entries[0].before!.entry.locale = "qaa";
    expect(translationDraftRecordSchema.parse(unsupported)).toEqual(unsupported);
  });
  it("returns the exact observed bytes from a single storage read", () => {
    const target = storage(), raw = JSON.stringify(record(), null, 2); let reads = 0;
    target.getItem = () => ++reads === 1 ? raw : "SYNTHETIC different next read";
    expect(readTranslationDraftState(target, scope)).toEqual({ raw, record: record() }); expect(reads).toBe(1);
  });
  it("refuses to replace an active copy that differs from the observed bytes", () => {
    const target = storage(), raw = "SYNTHETIC another stored copy"; target.setItem(key, raw);
    expect(() => retainTranslationDrafts(target, record(), null)).toThrow("Stored draft changed"); expect(target.getItem(key)).toBe(raw);
  });
  it("recognizes an identical retained result without attempting another storage write", () => {
    const target = storage(), draft = record(); retainTranslationDrafts(target, draft, null);
    target.setItem = () => { throw new Error("SYNTHETIC quota full"); };
    expect(retainTranslationDrafts(target, draft, null)).toEqual(draft);
  });
  it("archives page-only drafts even when no active copy was retained", () => {
    const target = storage(), draft = record(); archiveTranslationDrafts(target, scope, draft);
    expect([...target.rows.values()].map(raw => JSON.parse(raw))).toEqual([draft]); expect(target.getItem(key)).toBeNull();
  });
  it("does not clear the active copy if the second archive cannot be retained", () => {
    const target = storage(), raw = "SYNTHETIC damaged active"; target.setItem(key, raw); let writes = 0;
    target.setItem = (name, value) => { if (++writes === 1) target.rows.set(name, value); };
    expect(() => archiveTranslationDrafts(target, scope, record())).toThrow("Draft archive failed"); expect(target.getItem(key)).toBe(raw);
  });
  it("verifies the first archive again after writing the second copy", () => {
    const target = storage(), raw = "SYNTHETIC damaged active"; target.setItem(key, raw); let first: string | null = null;
    target.setItem = (name, value) => { target.rows.set(name, value); if (first) target.rows.set(first, "SYNTHETIC changed archive"); else first = name; };
    expect(() => archiveTranslationDrafts(target, scope, record())).toThrow("Draft archive failed"); expect(target.getItem(key)).toBe(raw);
  });
  it("refuses to archive a page draft under a different editor scope", () => {
    const target = storage(), draft = record(); draft.userId = id(99);
    expect(() => archiveTranslationDrafts(target, scope, draft)).toThrow("Page draft belongs to another editor"); expect(target.rows.size).toBe(0);
  });
  it("treats only an absent record as empty and preserves damaged original bytes", () => {
    const target = storage(); expect(readTranslationDrafts(target, scope)).toEqual({ version: 1, ...scope, reason: "", entries: [] });
    for (const raw of ["", "{broken", JSON.stringify({ ...record(), version: 2 })]) {
      target.setItem(key, raw); expect(() => readTranslationDrafts(target, scope)).toThrow(); expect(target.getItem(key)).toBe(raw);
    }
  });
  it.each(["userId", "workspaceId", "campaignId"] as const)("refuses a retained draft belonging to another %s", field => {
    const target = storage(), draft = record(); draft[field] = id(99);
    if (field !== "userId") draft.entries[0].before = null;
    target.setItem(key, JSON.stringify(draft)); expect(() => readTranslationDrafts(target, scope)).toThrow("Draft belongs to another editor");
  });
  it.each(["campaign_id", "workspace_id", "locale", "entity_type", "entity_id", "field"] as const)("refuses an original copy with a different %s", field => {
    const draft = record(), before = draft.entries[0].before!.entry;
    const changed = { ...before, [field]: field === "locale" ? "fr" : field === "entity_type" ? "category" : field === "field" ? "summary" : id(99) };
    expect(translationDraftRecordSchema.safeParse({ ...draft, entries: [{ ...draft.entries[0], before: { ...draft.entries[0].before, entry: changed } }] }).success).toBe(false);
  });
  it("refuses duplicate draft addresses", () => {
    const draft = record(); draft.entries.push({ ...draft.entries[0], text: "SYNTHETIC conflicting duplicate" });
    expect(translationDraftRecordSchema.safeParse(draft).success).toBe(false);
  });
  it("detects a storage write that returned without retaining the draft", () => {
    const target = storage(); target.setItem = () => {};
    expect(() => retainTranslationDrafts(target, record(), null)).toThrow("Draft was not retained");
  });
  it("archives exact damaged bytes before clearing the active copy", () => {
    const target = storage(), raw = "\u00a0{SYNTHETIC damaged draft\ufeff"; target.setItem(key, raw);
    archiveTranslationDrafts(target, scope); expect(target.getItem(key)).toBeNull();
    expect([...target.rows.entries()]).toEqual([[expect.stringMatching(new RegExp(`^${key}:archive:`)), raw]]);
  });
  it("keeps the active draft when writing its archive fails", () => {
    const target = storage(), raw = JSON.stringify(record()); target.setItem(key, raw); target.setItem = () => {};
    expect(() => archiveTranslationDrafts(target, scope)).toThrow("Draft archive failed"); expect(target.getItem(key)).toBe(raw);
  });
  it("does not remove a newer active copy when it changes during archiving", () => {
    const target = storage(), raw = JSON.stringify(record()); target.setItem(key, raw);
    const newer = "SYNTHETIC newer bytes";
    target.setItem = (name, value) => { target.rows.set(name, value); target.rows.set(key, newer); };
    expect(() => archiveTranslationDrafts(target, scope)).toThrow("active copy changed"); expect(target.getItem(key)).toBe(newer);
    expect([...target.rows.values()]).toContain(raw);
  });
  it("reports a failed active removal without losing either copy", () => {
    const target = storage(), raw = JSON.stringify(record()); target.setItem(key, raw); target.removeItem = () => {};
    expect(() => archiveTranslationDrafts(target, scope)).toThrow("Active draft was not cleared");
    expect([...target.rows.values()]).toEqual([raw, raw]);
  });
});
