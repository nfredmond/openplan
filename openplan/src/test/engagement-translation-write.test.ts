import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readTranslationWriteResult, translationWriteIntentSchema, writeTranslations, type TranslationWriteIntent, type TranslationWriteResult } from "@/lib/engagement/translation-write";
import { archivePendingTranslation, clearPendingTranslation, confirmPendingTranslation, pendingTranslationKey, pendingTranslationSchema, readPendingTranslations, retainPendingTranslation, type PendingTranslation, type TranslationStorage } from "@/lib/engagement/pending-translation";

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2) };
const user = id(3);
function intent(): TranslationWriteIntent {
  return { requestId: id(4), operation: "save", locale: "es", reason: null,
    entries: [{ entityType: "campaign", entityId: scope.campaignId, field: "title",
      expectedSource: { text: "\u00a0SYNTHETIC source\ufeff", sourceLocale: null, available: true },
      expectedTranslation: null, text: "\u00a0SYNTHETIC translated words\ufeff" }] };
}
function reply(): TranslationWriteResult {
  return { campaignId: scope.campaignId, requestId: id(4), operation: "save", locale: "es", replayed: false,
    entries: [{ entry: { id: id(5), workspace_id: scope.workspaceId, campaign_id: scope.campaignId, entity_type: "campaign", entity_id: scope.campaignId,
      field: "title", locale: "es", translated_text: "\u00a0SYNTHETIC translated words\ufeff", source: "operator", machine_model: null,
      source_text_hash: null, created_by: user, updated_at: "2026-09-13T00:00:00Z" }, revision: 1, removed: false }] };
}
function pending(): PendingTranslation {
  return { version: 1, userId: user, ...scope, createdAt: "2026-09-13T00:00:00Z", phase: "unconfirmed", intent: intent(), before: [null] };
}
function rpc(data: unknown, error: { code: string; message: string } | null = null) {
  const call = vi.fn().mockResolvedValue({ data, error });
  return { call, client: { rpc: call } as unknown as Pick<SupabaseClient, "rpc"> };
}
function storage() {
  const values = new Map<string, string>();
  const store: TranslationStorage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  return { store, values };
}
function existing(operation: "save" | "accept" | "withdraw"): PendingTranslation {
  const value = pending();
  const before = reply().entries[0];
  before.entry.source = "machine"; before.entry.machine_model = "SYNTHETIC model"; before.entry.created_by = id(8);
  const observed = { ...value.intent.entries[0], expectedTranslation: { id: before.entry.id, revision: before.revision } };
  value.intent = operation === "save"
    ? { ...value.intent, operation, reason: "\u00a0SYNTHETIC correction reason\ufeff", entries: [{ ...observed, text: "SYNTHETIC corrected words" }] }
    : { requestId: value.intent.requestId, operation, locale: "es", reason: "SYNTHETIC review reason", entries: [{ entityType: observed.entityType, entityId: observed.entityId,
      field: observed.field, expectedSource: observed.expectedSource, expectedTranslation: observed.expectedTranslation }] };
  value.before = [{ entry: before.entry, revision: before.revision }];
  return value;
}

describe("exact translation command boundary", () => {
  it("sends raw words, null source locale and the caller's request identity once", async () => {
    const request = intent(); const response = reply(); const mock = rpc(response);
    const result = await writeTranslations(mock.client, scope, request);
    expect(result.error).toBeNull();
    expect(result.result).toEqual(response);
    expect(mock.call.mock.calls).toEqual([["write_engagement_translations", {
      p_campaign: scope.campaignId, p_request: id(4), p_operation: "save", p_locale: "es", p_reason: null,
      p_entries: [{ entityType: "campaign", entityId: scope.campaignId, field: "title",
        expectedSource: { text: "\u00a0SYNTHETIC source\ufeff", sourceLocale: null, available: true }, expectedTranslation: null,
        text: "\u00a0SYNTHETIC translated words\ufeff" }],
    }]]);
  });

  it("accepts a full multilingual batch with code-point length limits and preserves correction reasons", () => {
    const value = existing("save").intent;
    expect(translationWriteIntentSchema.parse(value).reason).toBe("\u00a0SYNTHETIC correction reason\ufeff");
    const request = intent();
    if (request.operation !== "save") throw new Error("Fixture mismatch");
    request.entries = Array.from({ length: 200 }, (_, i) => ({ ...request.entries[0], entityType: "category", entityId: id(100 + i), field: "label", text: "😀".repeat(8000) }));
    expect(translationWriteIntentSchema.safeParse(request).success).toBe(true);
    request.entries[0].text += "😀";
    expect(translationWriteIntentSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    ["missing request", (v: Record<string, unknown>) => { delete v.requestId; }],
    ["extra actor", (v: Record<string, unknown>) => { v.actorId = id(99); }],
    ["invalid language", (v: Record<string, unknown>) => { v.locale = "not a language"; }],
    ["empty batch", (v: Record<string, unknown>) => { v.entries = []; }],
    ["duplicate address", (v: Record<string, unknown>) => { const entries = v.entries as unknown[]; entries.push(entries[0]); }],
    ["unsupported source field", (v: Record<string, unknown>) => { (v.entries as Array<Record<string, unknown>>)[0].field = "private_metadata"; }],
    ["blank words", (v: Record<string, unknown>) => { (v.entries as Array<Record<string, unknown>>)[0].text = "\u00a0"; }],
    ["missing observed state", (v: Record<string, unknown>) => { delete (v.entries as Array<Record<string, unknown>>)[0].expectedTranslation; }],
  ] as const)("refuses %s without calling the database", async (_name, change) => {
    const request: Record<string, unknown> = structuredClone(intent()); change(request);
    const mock = rpc(reply());
    const result = await writeTranslations(mock.client, scope, request as TranslationWriteIntent);
    expect(result.error?.kind).toBe("invalid"); expect(mock.call).not.toHaveBeenCalled();
  });

  it("requires a reason for corrections and an observed machine version for acceptance", () => {
    const correction = existing("save"); correction.intent.reason = "\u00a0";
    expect(pendingTranslationSchema.safeParse(correction).success).toBe(false);
    const acceptance = existing("accept"); acceptance.intent.entries[0].expectedTranslation = null;
    expect(pendingTranslationSchema.safeParse(acceptance).success).toBe(false);
    const unobservedMachine = existing("accept"); unobservedMachine.before[0]!.entry.source = "operator";
    expect(pendingTranslationSchema.safeParse(unobservedMachine).success).toBe(false);
  });

  it("allows withdrawal of unpublished words but refuses saving or accepting them", () => {
    for (const operation of ["save", "accept", "withdraw"] as const) {
      const value = existing(operation); value.intent.entries[0].expectedSource.available = false;
      expect(pendingTranslationSchema.safeParse(value).success).toBe(operation === "withdraw");
    }
  });

  it.each([
    ["campaign", (r: TranslationWriteResult) => { r.campaignId = id(99); }],
    ["request", (r: TranslationWriteResult) => { r.requestId = id(99); }],
    ["operation", (r: TranslationWriteResult) => { r.operation = "accept"; }],
    ["locale", (r: TranslationWriteResult) => { r.locale = "fr"; }],
    ["partial batch", (r: TranslationWriteResult) => { r.entries = []; }],
    ["workspace", (r: TranslationWriteResult) => { r.entries[0].entry.workspace_id = id(99); }],
    ["source address", (r: TranslationWriteResult) => { r.entries[0].entry.entity_id = id(99); }],
    ["removal", (r: TranslationWriteResult) => { r.entries[0].removed = true; }],
    ["new version", (r: TranslationWriteResult) => { r.entries[0].revision = 2; }],
    ["changed words", (r: TranslationWriteResult) => { r.entries[0].entry.translated_text = "SYNTHETIC wrong words"; }],
    ["changed authorship", (r: TranslationWriteResult) => { r.entries[0].entry.source = "machine"; }],
  ] satisfies Array<[string, (r: TranslationWriteResult) => void]>)("does not confirm a receipt with mismatched %s", async (_name, change) => {
    const response = reply(); change(response);
    const mock = rpc(response);
    expect((await writeTranslations(mock.client, scope, intent())).error?.kind).toBe("unavailable");
    expect(mock.call).toHaveBeenCalledTimes(1);
  });

  it.each(["PT409", "42501", "22023", "PT503"])("keeps a %s response distinct without retrying", async code => {
    const mock = rpc(reply(), { code, message: "SYNTHETIC refusal" });
    const result = await writeTranslations(mock.client, scope, intent());
    expect(result.result).toBeNull();
    expect(result.error?.kind).toBe(({ PT409: "conflict", "42501": "forbidden", "22023": "invalid", PT503: "unavailable" } as Record<string, string>)[code]);
    expect(mock.call).toHaveBeenCalledTimes(1);
  });

  it("retains an uncertain transport outcome without an automatic second request", async () => {
    const mock = rpc(null); mock.call.mockRejectedValue(new Error("SYNTHETIC connection lost"));
    expect((await writeTranslations(mock.client, scope, intent())).error?.kind).toBe("unavailable");
    expect(mock.call).toHaveBeenCalledTimes(1);
  });
});

describe("translation recovery custody", () => {
  it("retains independent requests across reloads and separates users and campaigns", () => {
    const { store } = storage(); const first = pending(); const second = pending(); second.intent.requestId = id(6);
    retainPendingTranslation(store, first); retainPendingTranslation(store, second);
    expect(readPendingTranslations(store, user, scope.campaignId, scope.workspaceId).pending).toEqual([first, second]);
    expect(readPendingTranslations(store, id(99), scope.campaignId, scope.workspaceId).pending).toEqual([]);
    expect(readPendingTranslations(store, user, id(99), scope.workspaceId).pending).toEqual([]);
    clearPendingTranslation(store, first);
    expect(readPendingTranslations(store, user, scope.campaignId, scope.workspaceId).pending).toEqual([second]);
  });

  it("allows a status change but never replaces different words at the same recovery key", () => {
    const { store } = storage(); const value = pending(); retainPendingTranslation(store, value);
    retainPendingTranslation(store, { ...value, phase: "conflict" });
    const changed = pending(); if (changed.intent.operation === "save") changed.intent.entries[0].text = "SYNTHETIC different words";
    expect(() => retainPendingTranslation(store, changed)).toThrow(/different request/);
    expect(() => clearPendingTranslation(store, changed)).toThrow(/Another translation payload/);
    expect(readPendingTranslations(store, user, scope.campaignId, scope.workspaceId).pending[0].phase).toBe("conflict");
  });

  it("refuses a mismatched before-copy instead of inventing a baseline", () => {
    const value = existing("save"); value.before[0]!.revision++;
    expect(pendingTranslationSchema.safeParse(value).success).toBe(false);
    value.before = [];
    expect(pendingTranslationSchema.safeParse(value).success).toBe(false);
  });

  it("detects a storage write that did not retain the proposed request", () => {
    const { store } = storage(); store.setItem = () => {};
    expect(() => retainPendingTranslation(store, pending())).toThrow(/not retained/);
  });

  it("preserves unreadable bytes before removing the active key", () => {
    const { store, values } = storage(); const key = pendingTranslationKey(pending());
    values.set(key, "SYNTHETIC damaged JSON");
    expect(readPendingTranslations(store, user, scope.campaignId, scope.workspaceId)).toEqual({ pending: [], unreadableKeys: [key] });
    const archived = archivePendingTranslation(store, key, user, scope.campaignId)!;
    expect(values.get(archived)).toBe("SYNTHETIC damaged JSON"); expect(values.has(key)).toBe(false);
    expect(readPendingTranslations(store, user, scope.campaignId, scope.workspaceId).unreadableKeys).toEqual([]);
  });

  it("does not discard a request if archiving failed or another writer changed it", () => {
    const { store, values } = storage(); const key = pendingTranslationKey(pending()); values.set(key, "SYNTHETIC original bytes");
    store.setItem = () => {};
    expect(() => archivePendingTranslation(store, key, user, scope.campaignId)).toThrow(/archive was not retained/);
    expect(values.get(key)).toBe("SYNTHETIC original bytes");
    store.setItem = (archiveKey, raw) => { values.set(archiveKey, raw); values.set(key, "SYNTHETIC concurrent bytes"); };
    expect(() => archivePendingTranslation(store, key, user, scope.campaignId)).toThrow(/changed during archiving/);
    expect(values.get(key)).toBe("SYNTHETIC concurrent bytes");
  });

  it("confirms exact retries and preserves the original model words on acceptance and withdrawal", () => {
    const created = pending(); const original = reply(); original.replayed = true;
    expect(confirmPendingTranslation(original, created).replayed).toBe(true);
    for (const operation of ["accept", "withdraw"] as const) {
      const value = existing(operation); const response = reply(); response.operation = operation;
      response.entries[0] = { entry: { ...value.before[0]!.entry }, revision: 2, removed: operation === "withdraw" };
      if (operation === "accept") { response.entries[0].entry.source = "operator"; response.entries[0].entry.machine_model = null; }
      expect(confirmPendingTranslation(response, value).operation).toBe(operation);
      response.entries[0].entry.translated_text = "SYNTHETIC altered acknowledgement";
      expect(() => confirmPendingTranslation(response, value)).toThrow(/retained baseline/);
    }
  });
});
