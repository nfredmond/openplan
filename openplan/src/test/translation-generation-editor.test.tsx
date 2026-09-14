import { webcrypto } from "node:crypto";
import { resolutionTestPacket } from "./helpers/translation-resolution-fixture";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationGeneration } from "@/components/engagement/translation-generation-panel";
import { archivePendingGeneration, clearPendingGeneration, pendingGenerationKey, prepareRetainedPublication,
  prepareTranslationGeneration, readPendingGenerations, readViewedTranslationGeneration, retainPendingGeneration,
  type PendingGeneration } from "@/lib/engagement/translation-generation-editor";
import type { TranslationGenerationRead } from "@/lib/engagement/translation-generation-request";
import type { TranslationHistoryEntry } from "@/lib/engagement/translation-history";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId } from "./helpers/translation-editor-fixture";

const scope = { userId, workspaceId, campaignId: id(1) };
function fixture() {
  const snapshot = translationEditorFixture();
  const pending = prepareTranslationGeneration(scope, snapshot, [{ entityType: "campaign", entityId: id(1), field: "title" }], "es");
  const viewed: TranslationGenerationRead = { ...scope, actorId: userId, requestId: pending.intent.requestId, locale: "es", createdAt: pending.createdAt,
    fields: pending.intent.fields.map(field => ({ ...structuredClone(field), state: "completed", attemptId: id(7), failureCode: null,
      output: { status: "completed", text: " \u00a0SYNTHETIC retained output\ufeff ", model: "synthetic-model", sourceHash: "a".repeat(64), outputHash: "b".repeat(64), deliveryDigest: "c".repeat(64), acceptedState: "completed" } })) };
  // The HTTP DTO carries the requester as actorId, not the editor's userId.
  Reflect.deleteProperty(viewed, "userId");
  const { revision, ...record } = snapshot.translations[0];
  const history: TranslationHistoryEntry[] = [{ id: id(8), campaign_id: scope.campaignId, translation_id: record.id, revision, actor_id: userId,
    recorded_at: pending.createdAt, event: "legacy_baseline", record_sha256: "d".repeat(64), write_request_id: null, change: null,
    record: { ...record, created_at: pending.createdAt } }];
  return { snapshot, pending, viewed, history };
}
const publish = vi.fn(), refresh = vi.fn();
function Editor({ pending, canWrite = true, publicationBlocked = false }: { pending: PendingGeneration; canWrite?: boolean; publicationBlocked?: boolean }) {
  const generation = useTranslationGeneration({ ...scope, canWrite, publicationBlocked, onPublish: publish, onRefresh: refresh });
  return <><button disabled={generation.blocked || generation.busy} onClick={() => void generation.start(pending)}>Generate reviewed source</button>{generation.panel}</>;
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const sendButton = () => screen.getByRole("button", { name: "Generate reviewed source" });
const retryButton = () => screen.getByRole("button", { name: "Retry same generation request" });
function catalog(f: ReturnType<typeof fixture>) {
  return { schema: 1, campaignId: scope.campaignId, workspaceId, requests: [{ id: f.viewed.requestId, actorId: f.viewed.actorId, locale: "es",
    createdAt: "2026-09-13T00:00:00.123456Z", fieldCount: 1, counts: { queued: 0, reserved: 0, running: 0, completed: 1, incomplete: 0, failed: 0, interrupted: 0, cancelled: 0 } }], next: null };
}
beforeEach(() => { localStorage.clear(); publish.mockReset(); refresh.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("generation editor custody", () => {
  it("freezes exact source and original saved revision without sharing snapshot objects", () => {
    const f = fixture();
    expect(f.pending.intent.fields[0].address.expectedSource.text).toBe(f.snapshot.campaign.title);
    expect(f.pending.intent.fields[0].address.expectedTranslation).toEqual({ id: id(4), revision: 3 });
    f.snapshot.campaign.title = "SYNTHETIC replacement"; f.snapshot.translations[0].revision++;
    expect(f.pending.intent.fields[0].address.expectedSource.text).not.toBe(f.snapshot.campaign.title);
    expect(f.pending.intent.fields[0].address.expectedTranslation!.revision).toBe(3);
    expect(() => prepareTranslationGeneration({ ...scope, campaignId: id(99) }, f.snapshot, [], "es")).toThrow(/another campaign/);
  });
  it("retains exact request identity while allowing refusal phase updates", () => {
    const f = fixture(); retainPendingGeneration(localStorage, f.pending);
    const refused = { ...f.pending, phase: "refused" as const }; retainPendingGeneration(localStorage, refused);
    expect(readPendingGenerations(localStorage, scope)).toEqual({ pending: [refused], unreadable: [] });
    const changed = structuredClone(f.pending); changed.intent.fields[0].address.expectedSource.text = "SYNTHETIC different source";
    expect(() => retainPendingGeneration(localStorage, changed)).toThrow(/Another generation/);
    expect(() => clearPendingGeneration(localStorage, changed)).toThrow(/payload changed/);
    expect(JSON.parse(localStorage.getItem(pendingGenerationKey(f.pending))!)).toEqual(refused);
    clearPendingGeneration(localStorage, refused); expect(localStorage.length).toBe(0);
  });
  it("reports unreadable and wrong workspace copies without modifying their bytes", () => {
    const f = fixture(), key = pendingGenerationKey(f.pending), raw = JSON.stringify({ ...f.pending, workspaceId: id(99) });
    localStorage.setItem(key, raw);
    expect(readPendingGenerations(localStorage, scope)).toEqual({ pending: [], unreadable: [key] });
    expect(localStorage.getItem(key)).toBe(raw);
    localStorage.setItem(key, "SYNTHETIC damaged bytes");
    const archived = archivePendingGeneration(localStorage, key, scope);
    expect(localStorage.getItem(archived)).toBe("SYNTHETIC damaged bytes"); expect(localStorage.getItem(key)).toBeNull();
    expect(() => archivePendingGeneration(localStorage, key, { ...scope, userId: id(99) })).toThrow(/another scope/);
  });
  it.each(["request", "campaign", "workspace", "actor", "locale", "field", "source", "baseline", "partial", "duplicate_id", "duplicate_address"])("rejects a generation read with changed %s", kind => {
    const f = fixture(), field = f.viewed.fields[0];
    if (kind === "request") f.viewed.requestId = id(99);
    if (kind === "campaign") f.viewed.campaignId = id(99);
    if (kind === "workspace") f.viewed.workspaceId = id(99);
    if (kind === "actor") f.viewed.actorId = id(99);
    if (kind === "locale") f.viewed.locale = "fr";
    if (kind === "field") field.id = id(99);
    if (kind === "source") field.address.expectedSource.text = "SYNTHETIC replacement";
    if (kind === "baseline") field.address.expectedTranslation!.revision++;
    if (kind === "partial") { f.viewed.fields.push({ ...structuredClone(field), id: id(98), address: { ...structuredClone(field.address), field: "summary" } }); }
    if (kind === "duplicate_id") f.viewed.fields.push({ ...structuredClone(field), address: { ...structuredClone(field.address), field: "summary" } });
    if (kind === "duplicate_address") f.viewed.fields.push({ ...structuredClone(field), id: id(98) });
    expect(() => readViewedTranslationGeneration(f.viewed, { ...scope, requestId: f.pending.intent.requestId }, kind.startsWith("duplicate_") ? undefined : f.pending)).toThrow();
  });
  it("prepares publication from original history even when newer revisions exist and the requester differs", () => {
    const f = fixture(); f.viewed.actorId = id(97);
    f.history.unshift({ ...structuredClone(f.history[0]), id: id(99), revision: 4, event: "corrected", record: { ...f.history[0].record, translated_text: "SYNTHETIC later words" } });
    const pending = prepareRetainedPublication(scope, f.viewed, [f.viewed.fields[0].id], "SYNTHETIC decision", f.history);
    expect(pending.before[0]?.revision).toBe(3); expect(pending.before[0]?.entry.translated_text).toBe(f.snapshot.translations[0].translated_text);
    expect(pending.userId).toBe(userId); expect("retained" in pending && pending.retained[0].actorId).toBe(id(97));
    expect(pending.intent.entries[0].expectedTranslation).toEqual({ id: id(4), revision: 3 });
    expect(pending.intent.entries[0]).not.toHaveProperty("text");
  });
  it.each(["missing", "removed", "duplicate", "workspace", "campaign", "identity"])("refuses unusable original history %s", kind => {
    const f = fixture();
    if (kind === "missing") f.history = [];
    if (kind === "removed") f.history[0].event = "removed";
    if (kind === "duplicate") f.history.push(structuredClone(f.history[0]));
    if (kind === "workspace") f.history.push({ ...structuredClone(f.history[0]), id: id(98), translation_id: id(99), record: { ...f.history[0].record, id: id(99), workspace_id: id(99) } });
    if (kind === "campaign") f.history[0].campaign_id = id(99);
    if (kind === "identity") f.history[0].translation_id = id(99);
    expect(() => prepareRetainedPublication(scope, f.viewed, [f.viewed.fields[0].id], "SYNTHETIC reason", f.history)).toThrow();
  });
  it("publishes a null baseline without history but refuses incomplete retained output", () => {
    const f = fixture(); f.viewed.fields[0].address.expectedTranslation = null;
    expect(prepareRetainedPublication(scope, f.viewed, [f.viewed.fields[0].id], "SYNTHETIC reason", []).before).toEqual([null]);
    f.viewed.fields[0].state = "interrupted";
    expect(() => prepareRetainedPublication(scope, f.viewed, [f.viewed.fields[0].id], "SYNTHETIC reason", [])).toThrow();
  });
  it("does not dispatch when storage cannot retain the frozen intent", async () => {
    const f = fixture(), fetch = vi.spyOn(globalThis, "fetch");
    const put = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota"); });
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton());
    await screen.findByText(/generation was not sent/); expect(fetch).not.toHaveBeenCalled(); expect(sendButton()).toBeDisabled();
    put.mockRestore(); fetch.mockResolvedValueOnce(reply({ requestId: f.pending.intent.requestId, created: true }, 202)).mockResolvedValueOnce(reply(f.viewed));
    fireEvent.click(retryButton()); await screen.findByText(/retained on the server/);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(f.pending.intent);
  });
  it("retains before dispatch and retries the exact request after response loss and storage deletion", async () => {
    const f = fixture(); let reject!: (error: Error) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => {
      expect(JSON.parse(localStorage.getItem(pendingGenerationKey(f.pending))!)).toEqual(f.pending);
      return new Promise<Response>((_, fail) => { reject = fail; });
    });
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton()); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    localStorage.removeItem(pendingGenerationKey(f.pending)); act(() => window.dispatchEvent(new StorageEvent("storage")));
    await act(async () => reject(new Error("SYNTHETIC response loss"))); expect(sendButton()).toBeDisabled();
    fetch.mockResolvedValueOnce(reply({ requestId: f.pending.intent.requestId, created: false })).mockResolvedValueOnce(reply(f.viewed));
    fireEvent.click(retryButton()); await screen.findByText(/retained on the server/);
    expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);
    expect(localStorage.getItem(pendingGenerationKey(f.pending))).toBeNull(); expect(sendButton()).toBeEnabled();
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Publish this retained output with a machine label" }));
    expect(publish).toHaveBeenCalledWith(f.viewed, [f.viewed.fields[0].id]);
  });
  it("keeps recovery after an acknowledgement for a different request", async () => {
    const f = fixture(), fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ requestId: id(99), created: true }, 202));
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton()); await screen.findByText(/Generation is unconfirmed/);
    expect(fetch).toHaveBeenCalledOnce(); expect(localStorage.getItem(pendingGenerationKey(f.pending))).not.toBeNull(); expect(sendButton()).toBeDisabled();
  });
  it("keeps recovery when the server read changes the original intent", async () => {
    const f = fixture(), changed = structuredClone(f.viewed); changed.fields[0].address.expectedTranslation!.revision++;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ requestId: f.pending.intent.requestId, created: false })).mockResolvedValueOnce(reply(changed));
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton()); await screen.findByText(/Generation is unconfirmed/);
    expect(localStorage.getItem(pendingGenerationKey(f.pending))).not.toBeNull(); expect(screen.queryByLabelText("Retained machine output")).not.toBeInTheDocument();
  });
  it("discovers and views retained output without browser request storage or provider calls", async () => {
    const f = fixture(), fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(catalog(f))).mockResolvedValueOnce(reply(f.viewed));
    render(<Editor pending={f.pending}/>); fireEvent.click(screen.getByRole("button", { name: "Machine translation requests" }));
    fireEvent.click(await screen.findByRole("button", { name: /1 of 1 fields completed/ }));
    await screen.findByLabelText("Retained machine output");
    expect(screen.getByText(/SYNTHETIC retained output/).textContent).toBe(f.viewed.fields[0].output!.text);
    expect(fetch.mock.calls.map(call => [String(call[0]), call[1]?.method ?? "GET"])).toEqual([
      [`/api/engagement/campaigns/${scope.campaignId}/translations/generation`, "GET"],
      [`/api/engagement/campaigns/${scope.campaignId}/translations/generation?requestId=${f.pending.intent.requestId}`, "GET"]]);
    expect(localStorage.length).toBe(0); expect(publish).not.toHaveBeenCalled();
  });
  it("disables publication after a failed status read while retaining the viewed words", async () => {
    const f = fixture(); vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(catalog(f))).mockResolvedValueOnce(reply(f.viewed)).mockResolvedValueOnce(reply({ error: "SYNTHETIC access lost" }, 403));
    render(<Editor pending={f.pending}/>); fireEvent.click(screen.getByRole("button", { name: "Machine translation requests" }));
    fireEvent.click(await screen.findByRole("button", { name: /1 of 1 fields completed/ })); await screen.findByLabelText("Retained machine output");
    fireEvent.click(screen.getByRole("button", { name: "Refresh request status" })); await screen.findByText(/retained output could not be verified/);
    expect(screen.getByRole("button", { name: "Publish this retained output with a machine label" })).toBeDisabled();
    expect(screen.getByText(/SYNTHETIC retained output/).textContent).toBe(f.viewed.fields[0].output!.text);
  });
  it("refuses dispatch when retained request readback differs", async () => {
    const f = fixture(), key = pendingGenerationKey(f.pending);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ requestId: f.pending.intent.requestId, created: true }, 202)).mockResolvedValueOnce(reply(f.viewed));
    const nativeGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name: string) {
      const raw = nativeGet.call(this, name);
      return name === key && raw !== null ? "SYNTHETIC mismatched readback" : raw;
    });
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton());
    await screen.findByText(/generation was not sent/);
    expect(fetch).not.toHaveBeenCalled(); expect(sendButton()).toBeDisabled();
    expect(JSON.parse(nativeGet.call(localStorage, key)!)).toEqual(f.pending);
    expect(screen.getByRole("button", { name: "Download generation request" })).toBeEnabled();
  });
  it("retains a refused phase in memory when its storage update fails", async () => {
    const f = fixture(), key = pendingGenerationKey(f.pending);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ kind: "conflict" }, 409));
    const nativePut = Storage.prototype.setItem; let writes = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name: string, raw: string) {
      if (name === key && ++writes === 2) throw new Error("SYNTHETIC refusal storage failure");
      nativePut.call(this, name, raw);
    });
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton());
    await screen.findByRole("heading", { name: "Refused generation request" });
    expect(JSON.parse(localStorage.getItem(key)!).phase).toBe("unconfirmed");
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    expect(screen.getByRole("heading", { name: "Refused generation request" })).toBeInTheDocument();
    expect(sendButton()).toBeDisabled(); expect(refresh).not.toHaveBeenCalled();
  });
  it("preserves unreadable recovery when the saved request cannot be retrieved", async () => {
    const f = fixture(), key = pendingGenerationKey(f.pending), raw = "SYNTHETIC unreadable generation request";
    localStorage.setItem(key, raw);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ kind: "forbidden" }, 403));
    render(<Editor pending={f.pending}/>);
    fireEvent.click(screen.getByRole("button", { name: "Recover saved generation request" }));
    await screen.findByText(/saved request could not be matched/);
    expect(localStorage.getItem(key)).toBe(raw); expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download stored generation copy" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1]?.method ?? "GET").toBe("GET");
    expect(publish).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  });
  it("clears the earlier unconfirmed message after verified resolution", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const f = fixture(), fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("SYNTHETIC queue acknowledgement lost"));
    render(<Editor pending={f.pending}/>); fireEvent.click(sendButton());
    await screen.findByText(/^Generation is unconfirmed/);
    fetch.mockImplementation(async (_url, init) => reply(resolutionTestPacket(scope, JSON.parse(String(init?.body)))));
    fireEvent.click(screen.getByRole("button", { name: "Review request resolution" }));
    expect(retryButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm resolution and preserve copies" }));
    await screen.findByText(/Resolution confirmed and copies archived/);
    expect(screen.queryByText(/^Generation is unconfirmed/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry same generation request" })).toBeNull();
    expect(localStorage.getItem(pendingGenerationKey(f.pending))).toBeNull();
    expect(refresh).toHaveBeenCalledOnce(); expect(sendButton()).toBeEnabled();
  });
  it("keeps the refused source copy when archive readback fails", async () => {
    const f = fixture(), refused = { ...f.pending, phase: "refused" as const }, key = pendingGenerationKey(refused);
    retainPendingGeneration(localStorage, refused); const original = localStorage.getItem(key);
    const nativeGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name: string) {
      const raw = nativeGet.call(this, name);
      return name.startsWith("openplan:translation-resolution-archive:") && raw !== null ? "SYNTHETIC archive mismatch" : raw;
    });
    vi.stubGlobal("crypto", webcrypto);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => reply(resolutionTestPacket(scope, JSON.parse(String(init?.body)))));
    render(<Editor pending={refused}/>);
    fireEvent.click(screen.getByRole("button", { name: "Review request resolution" }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm resolution and preserve copies" }));
    await screen.findByText(/archive could not be saved/);
    expect(localStorage.getItem(key)).toBe(original); expect(sendButton()).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });

});
