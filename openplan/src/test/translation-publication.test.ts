// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readTranslationPublicationResult, translationPublicationIntentSchema, type TranslationPublicationIntent, type TranslationPublicationResult } from "@/lib/engagement/translation-publication";
import type { TranslationGenerationRead } from "@/lib/engagement/translation-generation-request";
const id = (n: number) => `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const scope = { campaignId: id(1), workspaceId: id(2), publisherId: id(4) };
  const generation: TranslationGenerationRead = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: id(3), requestId: id(10), locale: "es", createdAt: "2026-09-13T12:00:00Z", fields: [] };
  // The DTO does not carry publication identity; generation and publication
  // remain distinct actors even when the original actor has lost access.
  generation.fields = ["title", "summary"].map((field, i) => ({ id: id(30+i), address: { entityType: "campaign", entityId: scope.campaignId, field,
    expectedSource: { text: `  Source ${i}  `, sourceLocale: null, available: true }, expectedTranslation: null }, state: "completed", attemptId: id(40+i), failureCode: null,
    output: { status: "completed", text: ` \u00a0Salida ${i}\ufeff `, model: "synthetic-model", sourceHash: hash(`  Source ${i}  `), outputHash: hash(` \u00a0Salida ${i}\ufeff `), deliveryDigest: hash(`delivery-${i}`), acceptedState: "completed" } }));
  const intent: TranslationPublicationIntent = { requestId: id(20), operation: "publish_generated", locale: "es", reason: "SYNTHETIC publication decision",
    entries: generation.fields.map(field => ({ ...structuredClone(field.address), generation: { requestId: generation.requestId, fieldId: field.id, attemptId: field.attemptId!, deliveryDigest: field.output!.deliveryDigest } })) };
  const result: TranslationPublicationResult = { campaignId: scope.campaignId, requestId: intent.requestId, operation: "publish_generated", locale: "es", replayed: false,
    entries: generation.fields.map((field, i) => ({ revision: 1, removed: false, generation: { ...intent.entries[i].generation, actorId: generation.actorId, outputHash: field.output!.outputHash },
      entry: { id: id(50+i), workspace_id: scope.workspaceId, campaign_id: scope.campaignId, entity_type: "campaign", entity_id: scope.campaignId, field: field.address.field, locale: "es",
        translated_text: field.output!.text, source: "machine", machine_model: field.output!.model, source_text_hash: hash(field.address.expectedSource.text!.trim()), created_by: scope.publisherId,
        created_at: "2026-09-13T12:01:00Z", updated_at: "2026-09-13T12:01:00Z" } })) };
  return { scope, generation, intent, result };
}
function confirm(f: ReturnType<typeof fixture>) { return readTranslationPublicationResult(f.result, f.scope, f.intent, [f.generation]); }
describe("retained publication receipt", () => {
  it("confirms exact words, distinct actors and reordered batch receipts", () => {
    const f = fixture(); f.result.entries.reverse(); expect(confirm(f)).toEqual(f.result);
    f.result.replayed = true; expect(confirm(f).replayed).toBe(true);
  });
  it("confirms a new history revision for identical replacement words", () => {
    const f = fixture();
    f.intent.entries.forEach((entry, i) => { entry.expectedTranslation = { id: f.result.entries[i].entry.id, revision: 7 }; f.generation.fields[i].address.expectedTranslation = entry.expectedTranslation; f.result.entries[i].revision = 8; });
    expect(confirm(f).entries[0].revision).toBe(8);
  });
  it.each(["campaign", "request", "locale", "count", "row_campaign", "row_workspace", "row_locale", "publisher", "same_row_id", "same_field", "words", "model", "operator", "generation_actor", "generation_digest", "generation_output_hash", "revision", "saved_id"])("rejects changed receipt %s", kind => {
    const f = fixture(), first = f.result.entries[0];
    if (kind === "campaign") f.result.campaignId = id(99);
    if (kind === "request") f.result.requestId = id(99);
    if (kind === "locale") f.result.locale = "fr";
    if (kind === "count") f.result.entries.pop();
    if (kind === "row_campaign") first.entry.campaign_id = id(99);
    if (kind === "row_workspace") first.entry.workspace_id = id(99);
    if (kind === "row_locale") first.entry.locale = "fr";
    if (kind === "publisher") first.entry.created_by = f.generation.actorId;
    if (kind === "same_row_id") f.result.entries[1].entry.id = first.entry.id;
    if (kind === "same_field") { f.result.entries[1] = structuredClone(first); f.result.entries[1].entry.id = id(99); }
    if (kind === "words") first.entry.translated_text = first.entry.translated_text.trim();
    if (kind === "model") first.entry.machine_model = "other-model";
    if (kind === "operator") first.entry.source = "operator";
    if (kind === "generation_actor") first.generation.actorId = f.scope.publisherId;
    if (kind === "generation_digest") first.generation.deliveryDigest = hash("different");
    if (kind === "generation_output_hash") first.generation.outputHash = hash("different");
    if (kind === "revision") first.revision = 2;
    if (kind === "saved_id") { f.intent.entries[0].expectedTranslation = { id: id(98), revision: 1 }; f.generation.fields[0].address.expectedTranslation = f.intent.entries[0].expectedTranslation; first.revision = 2; }
    expect(() => confirm(f)).toThrow();
  });
  it.each(["request", "campaign", "workspace", "locale", "field", "attempt", "digest", "address", "baseline", "job_state", "output_status", "accepted_state", "missing_output"])("rejects changed retained generation %s", kind => {
    const f = fixture(), field = f.generation.fields[0];
    if (kind === "request") f.generation.requestId = id(99);
    if (kind === "campaign") f.generation.campaignId = id(99);
    if (kind === "workspace") f.generation.workspaceId = id(99);
    if (kind === "locale") f.generation.locale = "fr";
    if (kind === "field") field.id = id(99);
    if (kind === "attempt") field.attemptId = id(99);
    if (kind === "digest") field.output!.deliveryDigest = hash("different");
    if (kind === "address") field.address.expectedSource.text = "Different source";
    if (kind === "baseline") field.address.expectedTranslation = { id: id(99), revision: 1 };
    if (kind === "job_state") field.state = "cancelled";
    if (kind === "output_status") field.output!.status = "incomplete";
    if (kind === "accepted_state") field.output!.acceptedState = "interrupted";
    if (kind === "missing_output") field.output = null;
    expect(() => confirm(f)).toThrow();
  });
  it("rejects repeated retained request identities", () => {
    const f = fixture(); expect(() => readTranslationPublicationResult(f.result, f.scope, f.intent, [f.generation, structuredClone(f.generation)])).toThrow();
  });
  it("bounds a publication batch and reason without truncating words", () => {
    const f = fixture();
    f.intent.reason = "😀".repeat(2000);
    f.intent.entries = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(f.intent.entries[0]), entityType: "category", entityId: id(1000+i), field: "label", generation: { ...f.intent.entries[0].generation, fieldId: id(2000+i) } }));
    expect(translationPublicationIntentSchema.safeParse(f.intent).success).toBe(true);
    f.intent.entries.push({ ...structuredClone(f.intent.entries[0]), entityId: id(9000), generation: { ...f.intent.entries[0].generation, fieldId: id(9001) } });
    expect(translationPublicationIntentSchema.safeParse(f.intent).success).toBe(false);
    f.intent.entries.pop(); f.intent.reason = "x".repeat(2001);
    expect(translationPublicationIntentSchema.safeParse(f.intent).success).toBe(false);
    f.intent.reason = "Decision"; f.intent.entries = [];
    expect(translationPublicationIntentSchema.safeParse(f.intent).success).toBe(false);
  });
  it.each(["text", "reference_extra", "duplicate_address", "duplicate_field", "unavailable", "blank_source", "blank_reason"])("refuses publication intent %s", kind => {
    const f = fixture();
    if (kind === "text") Object.assign(f.intent.entries[0], { text: "FORGED words" });
    if (kind === "reference_extra") Object.assign(f.intent.entries[0].generation, { model: "FORGED model" });
    if (kind === "duplicate_address") f.intent.entries[1].field = f.intent.entries[0].field;
    if (kind === "duplicate_field") f.intent.entries[1].generation.fieldId = f.intent.entries[0].generation.fieldId;
    if (kind === "unavailable") f.intent.entries[0].expectedSource.available = false;
    if (kind === "blank_source") f.intent.entries[0].expectedSource.text = "\u00a0";
    if (kind === "blank_reason") f.intent.reason = "\u00a0";
    expect(translationPublicationIntentSchema.safeParse(f.intent).success).toBe(false);
  });
});
