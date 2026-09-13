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
