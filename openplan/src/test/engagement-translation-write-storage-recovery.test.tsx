import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationWrites } from "@/components/engagement/translation-write-recovery";
import { pendingTranslationKey, pendingTranslationSchema, type PendingTranslation } from "@/lib/engagement/pending-translation";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId } from "./helpers/translation-editor-fixture";

const scope = { userId, workspaceId, campaignId: id(1) };
const confirmed = vi.fn(), reopened = vi.fn();
function request() {
  const snapshot = translationEditorFixture(), { revision, ...entry } = snapshot.translations[0];
  return pendingTranslationSchema.parse({ version: 1, ...scope, createdAt: "2026-09-13T00:00:00Z", phase: "unconfirmed",
    before: [{ revision, entry }], intent: { operation: "save", requestId: id(5), locale: "es", reason: "SYNTHETIC reason", entries: [{
      entityType: "campaign", entityId: id(1), field: "title", text: "SYNTHETIC page request",
      expectedSource: { text: snapshot.campaign.title, sourceLocale: null, available: true }, expectedTranslation: { id: entry.id, revision } }] } });
}
function Editor() {
  const writes = useTranslationWrites({ ...scope, canWrite: true, onConfirmed: confirmed, onReopen: reopened });
  return <><button disabled={writes.blocked || writes.busy} onClick={() => void writes.submit(request())}>Send proposed change</button>{writes.recovery}</>;
}
function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}
async function failRetention() {
  const put = Storage.prototype.setItem;
  const fault = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key.startsWith("openplan:translation-write:")) throw new DOMException("SYNTHETIC quota", "QuotaExceededError");
    put.call(this, key, value);
  });
  fireEvent.click(screen.getByRole("button", { name: "Send proposed change" }));
  await screen.findByText(/could not retain the request, so no save was sent/);
  fault.mockRestore();
}
beforeEach(() => { localStorage.clear(); confirmed.mockClear(); reopened.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe("translation write storage recovery", () => {
  it("removes the page request after an exact confirmation without restoring it from memory", async () => {
    const proposed = request(), { revision: _revision, ...entry } = translationEditorFixture().translations[0];
    if (proposed.intent.operation !== "save") throw new Error("Fixture operation");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ campaignId: id(1), requestId: proposed.intent.requestId,
      operation: "save", locale: "es", replayed: false, entries: [{ entry: { ...entry, translated_text: proposed.intent.entries[0].text }, revision: 4, removed: false }] }), { status: 200 }));
    render(<Editor />); fireEvent.click(screen.getByRole("button", { name: "Send proposed change" }));
    await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    expect(screen.queryByRole("button", { name: "Retry same translation request" })).not.toBeInTheDocument();
    expect(localStorage.getItem(pendingTranslationKey(proposed))).toBeNull();
    expect(screen.getByRole("button", { name: "Send proposed change" })).toBeEnabled();
  });

  it("retains a definite refusal phase when storage cannot save that phase", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota after dispatch"); });
      return new Response(JSON.stringify({ kind: "conflict" }), { status: 409 });
    });
    render(<Editor />); fireEvent.click(screen.getByRole("button", { name: "Send proposed change" }));
    await screen.findByRole("button", { name: "Review current saved translations" });
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    expect(screen.getByRole("button", { name: "Review current saved translations" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Send proposed change" })).toBeDisabled();
  });

  it.each(["deleted", "corrupted", "replaced"])("keeps the in-flight page request when its stored copy is %s", async change => {
    let rejectAttempt!: (reason: Error) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectAttempt = reject; }));
    const copies: Blob[] = [];
    vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: Blob) { copies.push(blob); return "blob:synthetic"; } static revokeObjectURL() {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<Editor />);
      fireEvent.click(screen.getByRole("button", { name: "Send proposed change" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const key = pendingTranslationKey(request());
      if (change === "deleted") localStorage.removeItem(key);
      else if (change === "corrupted") localStorage.setItem(key, "SYNTHETIC unreadable stored request");
      else {
        const different = request(); if (different.intent.operation !== "save") throw new Error("Fixture operation");
        different.intent.entries[0].text = "SYNTHETIC replacement after dispatch";
        localStorage.setItem(key, JSON.stringify(different));
      }
      act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
      await act(async () => rejectAttempt(new Error("SYNTHETIC lost response")));
      expect(screen.getByRole("button", { name: "Send proposed change" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Download retained request" }));
      expect(JSON.parse(await readBlob(copies[0])).intent).toEqual(request().intent);
      expect(screen.queryByText(/This attempt was not sent/)).not.toBeInTheDocument();
      if (change !== "deleted") expect(screen.getByRole("button", { name: "Download stored recovery copy" })).toBeVisible();
      else {
        fetch.mockRejectedValueOnce(new Error("SYNTHETIC second lost response"));
        fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual(request().intent);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("archives the page copy before reopening a refused request deleted from storage", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ kind: "conflict" }), { status: 409 }));
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Send proposed change" }));
    await screen.findByRole("button", { name: "Review current saved translations" });
    const key = pendingTranslationKey(request()); localStorage.removeItem(key);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: translationEditorFixture() }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Review current saved translations" }));
    await screen.findByRole("button", { name: "Keep this copy and reopen editor" });
    fireEvent.click(screen.getByRole("button", { name: "Keep this copy and reopen editor" }));
    expect(reopened).toHaveBeenCalledTimes(1);
    const archived = Object.keys(localStorage).filter(key => key.startsWith("openplan:translation-archive:"));
    expect(archived).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(archived[0])!).intent).toEqual(request().intent);
    expect(screen.queryByRole("button", { name: "Retry same translation request" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send proposed change" })).toBeEnabled();
  });

  it("preserves the page request and separate stored bytes when recovery finds a different payload with the same identity", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const copies: Blob[] = [];
    vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: Blob) { copies.push(blob); return "blob:synthetic"; } static revokeObjectURL() {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<Editor />); await failRetention();
      const different = request(); if (different.intent.operation !== "save") throw new Error("Fixture operation");
      different.intent.entries[0].text = "SYNTHETIC differing stored words";
      const raw = JSON.stringify(different), key = pendingTranslationKey(different); localStorage.setItem(key, raw);
      act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
      fireEvent.click(screen.getByRole("button", { name: "Download retained request" }));
      const page: PendingTranslation = JSON.parse(await readBlob(copies[0]));
      expect(page.intent).toEqual(request().intent);
      fireEvent.click(screen.getByRole("button", { name: "Download stored recovery copy" }));
      expect(await readBlob(copies[1])).toBe(raw);
      fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Retry same translation request" })).toBeEnabled());
      expect(fetch).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(raw);
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: translationEditorFixture() }), { status: 200 }));
      fireEvent.click(screen.getByRole("button", { name: "Review current saved translations" }));
      await screen.findByRole("button", { name: "Preserve stored copy and reopen editor" });
      fireEvent.click(screen.getByRole("button", { name: "Preserve stored copy and reopen editor" }));
      expect(localStorage.getItem(key)).toBeNull();
      expect(Object.keys(localStorage).some(key => key.startsWith("openplan:translation-archive:") && localStorage.getItem(key) === raw)).toBe(true);
      expect(screen.getByRole("button", { name: "Send proposed change" })).toBeDisabled();
      fetch.mockRejectedValueOnce(new Error("SYNTHETIC lost acknowledgement"));
      fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual(request().intent);
    } finally { vi.unstubAllGlobals(); }
  });

  it("retries the exact volatile request when storage returns and does not report identical stored words as damaged", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("SYNTHETIC lost acknowledgement"));
    render(<Editor />); await failRetention(); expect(fetch).not.toHaveBeenCalled();
    const saved = request(); saved.phase = "conflict";
    localStorage.setItem(pendingTranslationKey(saved), JSON.stringify(saved));
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    expect(screen.queryByRole("button", { name: "Download stored recovery copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review current saved translations" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(request().intent);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("keeps an earlier sent attempt uncertain when a later retention retry fails", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("SYNTHETIC lost acknowledgement"));
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Send proposed change" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry same translation request" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota"); });
    fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
    await screen.findByText(/An earlier attempt may have reached the server/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Review current saved translations" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send proposed change" })).toBeDisabled();
  });
});
