import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { useTranslationResolution } from "@/components/engagement/translation-resolution-panel";
import { pendingResolutionKey, readResolutionRecovery } from "@/lib/engagement/translation-resolution-recovery";
import { resolutionTestPacket } from "./helpers/translation-resolution-fixture";

const id = (n: number) => `77000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { userId: id(1), workspaceId: id(2), campaignId: id(3) };
const key = `openplan:translation-generation:${scope.userId}:${scope.campaignId}:${id(4)}`;
const original = "SYNTHETIC damaged\0\ud800 browser copy";
const resolved = vi.fn(), download = vi.fn();
function Editor({ canWrite = true, pageCopy, locked = false, editorScope = scope }: { canWrite?: boolean; pageCopy?: string; locked?: boolean; editorScope?: typeof scope }) {
  const [busy, setBusy] = useState(locked), busyRef = useRef(locked);
  const recovery = useTranslationResolution(editorScope, { canWrite, busy, download, onResolved: resolved,
    acquire: () => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); return true; },
    release: () => { busyRef.current = false; setBusy(false); },
  });
  return <><button onClick={() => recovery.begin(key, pageCopy)}>Review recovery</button>
    <button disabled={busy || recovery.blocked}>New generation</button>{recovery.panel}</>;
}
const confirm = () => screen.getByRole("button", { name: "Confirm resolution and preserve copies" });
const retry = () => screen.getByRole("button", { name: "Retry same resolution" });
const fresh = () => screen.getByRole("button", { name: "New generation" });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function successfulFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => reply(resolutionTestPacket(scope, JSON.parse(String(init?.body)))));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { localStorage.clear(); localStorage.setItem(key, original); resolved.mockReset(); download.mockReset(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("generation resolution controller", () => {
  it("retains both copies before dispatch with pinned login and archives confirmed receipts", async () => {
    const fetch = successfulFetch(); render(<Editor pageCopy="SYNTHETIC page-held copy"/>);
    fireEvent.click(screen.getByText("Review recovery")); expect(fetch).not.toHaveBeenCalled(); expect(fresh()).toBeDisabled();
    fetch.mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`/api/engagement/campaigns/${scope.campaignId}/translations/generation/resolutions`);
      const saved = readResolutionRecovery(localStorage, scope); expect(saved.pending).toHaveLength(1);
      expect(saved.pending[0].intents).toHaveLength(2); expect(localStorage.getItem(key)).toBe(original);
      expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId } });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const sent = JSON.parse(String(init?.body)); expect(saved.pending[0].intents).toContainEqual(sent);
      return reply(resolutionTestPacket(scope, sent));
    });
    fireEvent.click(confirm()); await screen.findByText(/Resolution confirmed and copies archived/);
    expect(fetch).toHaveBeenCalledTimes(2); expect(resolved).toHaveBeenCalledOnce(); expect(fresh()).toBeEnabled();
    expect(localStorage.getItem(key)).toBeNull();
    const saved = readResolutionRecovery(localStorage, scope); expect(saved.pending).toHaveLength(0); expect(saved.archives).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Download archived resolution 1" }));
    expect(download.mock.calls[0][0]).toBe(saved.archives[0].raw);
    const archive = JSON.parse(saved.archives[0].raw); expect(archive.receipts).toHaveLength(2);
    expect(archive.request.intents.map((intent: { copyJson: string }) => JSON.parse(intent.copyJson))).toEqual([original, "SYNTHETIC page-held copy"]);
  });
  it("does not send when proposed recovery is cancelled", () => {
    const fetch = successfulFetch(); render(<Editor/>); fireEvent.click(screen.getByText("Review recovery"));
    fireEvent.click(screen.getByRole("button", { name: "Download proposed resolution" })); expect(download).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Keep request unresolved" }));
    expect(fetch).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(original); expect(readResolutionRecovery(localStorage, scope).pending).toHaveLength(0);
  });
  it.each(["quota", "readback"])("does not dispatch when the intent has %s storage failure", async kind => {
    const fetch = successfulFetch(); render(<Editor/>); fireEvent.click(screen.getByText("Review recovery"));
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, raw) {
      if (name.startsWith("openplan:translation-resolution:")) { if (kind === "quota") throw new Error("quota"); return; } set.call(this, name, raw);
    });
    fireEvent.click(confirm()); await screen.findByText(/Resolution is unconfirmed/);
    expect(fetch).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(original); expect(fresh()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download proposed resolution" })).toBeEnabled();
  });
  it("retries the exact resolution after acknowledgement loss and lost browser storage", async () => {
    const fetch = successfulFetch(); fetch.mockRejectedValueOnce(new Error("lost ack")); render(<Editor/>);
    fireEvent.click(screen.getByText("Review recovery")); fireEvent.click(confirm()); await screen.findByText(/Resolution is unconfirmed/);
    const bundle = readResolutionRecovery(localStorage, scope).pending[0], sent = fetch.mock.calls[0][1]?.body;
    localStorage.removeItem(pendingResolutionKey(bundle)); act(() => window.dispatchEvent(new StorageEvent("storage")));
    expect(fresh()).toBeDisabled(); fireEvent.click(retry()); await screen.findByText(/Resolution confirmed/);
    expect(fetch.mock.calls[1][1]?.body).toBe(sent); expect(fetch).toHaveBeenCalledTimes(2); expect(resolved).toHaveBeenCalledOnce();
  });
  it("retains both resolution identities after only the second acknowledgement is lost", async () => {
    const fetch = successfulFetch(); fetch.mockImplementationOnce(async (_url, init) => reply(resolutionTestPacket(scope, JSON.parse(String(init?.body)))))
      .mockRejectedValueOnce(new Error("second ack lost")); render(<Editor pageCopy="second"/>);
    fireEvent.click(screen.getByText("Review recovery")); fireEvent.click(confirm()); await screen.findByText(/Resolution is unconfirmed/);
    expect(resolved).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(original);
    const first = fetch.mock.calls.slice(0, 2).map(call => call[1]?.body);
    fireEvent.click(retry()); await screen.findByText(/Resolution confirmed/);
    expect(fetch.mock.calls.slice(2).map(call => call[1]?.body)).toEqual(first);
  });
  it.each(["bad-checksum", "different-intent", "refused"])("keeps original and pending copies on %s response", async kind => {
    const fetch = successfulFetch(); fetch.mockImplementation(async (_url, init) => {
      const intent = JSON.parse(String(init?.body)), packet = resolutionTestPacket(scope, kind === "different-intent" ? { ...intent, reason: "different" } : intent);
      return reply(kind === "bad-checksum" ? { ...packet, payloadSha256: "a".repeat(64) } : packet, kind === "refused" ? 403 : 200);
    });
    render(<Editor/>); fireEvent.click(screen.getByText("Review recovery")); fireEvent.click(confirm()); await screen.findByText(/Resolution is unconfirmed/);
    expect(localStorage.getItem(key)).toBe(original); expect(readResolutionRecovery(localStorage, scope).pending).toHaveLength(1);
    expect(readResolutionRecovery(localStorage, scope).archives).toHaveLength(0); expect(resolved).not.toHaveBeenCalled(); expect(fresh()).toBeDisabled();
  });
  it("keeps a different source from another tab after successful resolution", async () => {
    const pending = deferred<Response>(), fetch = successfulFetch(); fetch.mockImplementationOnce(() => pending.promise);
    render(<Editor/>); fireEvent.click(screen.getByText("Review recovery")); fireEvent.click(confirm());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); localStorage.setItem(key, "different tab copy");
    await act(async () => { pending.resolve(reply(resolutionTestPacket(scope, JSON.parse(String(fetch.mock.calls[0][1]?.body))))); });
    await screen.findByText(/A different browser copy remains/); expect(localStorage.getItem(key)).toBe("different tab copy");
  });
  it.each(["unmount", "access-revoked", "workspace-changed"])("ignores late acknowledgement after %s", async kind => {
    const pending = deferred<Response>(), fetch = successfulFetch(); fetch.mockImplementationOnce(() => pending.promise);
    const view = render(<Editor/>); fireEvent.click(screen.getByText("Review recovery")); fireEvent.click(confirm());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const before = readResolutionRecovery(localStorage, scope).pending;
    if (kind === "unmount") view.unmount(); else if (kind === "workspace-changed") view.rerender(<Editor editorScope={{ ...scope, workspaceId: id(99) }}/>); else view.rerender(<Editor canWrite={false}/>);
    if (kind === "unmount") expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const digest = vi.spyOn(webcrypto.subtle, "digest");
    await act(async () => { pending.resolve(reply(resolutionTestPacket(scope, JSON.parse(String(fetch.mock.calls[0][1]?.body))))); });
    // A stale response must stop before asynchronous receipt verification begins.
    expect(digest).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(original); expect(readResolutionRecovery(localStorage, scope).pending).toEqual(before);
    expect(readResolutionRecovery(localStorage, scope).archives).toHaveLength(0); expect(resolved).not.toHaveBeenCalled();
  });
  it("prevents double dispatch while a resolution is in flight", async () => {
    const pending = deferred<Response>(), fetch = successfulFetch(); fetch.mockImplementationOnce(() => pending.promise);
    render(<Editor/>); fireEvent.click(screen.getByText("Review recovery")); const button = confirm();
    fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); expect(retry()).toBeDisabled();
    await act(async () => { pending.resolve(reply(resolutionTestPacket(scope, JSON.parse(String(fetch.mock.calls[0][1]?.body))))); });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["access", "busy"])("does not prepare resolution when blocked by %s", kind => {
    const fetch = successfulFetch(), view = render(<Editor canWrite={kind !== "access"} locked={kind === "busy"}/>);
    fireEvent.click(screen.getByText("Review recovery"));
    if (kind === "access") view.rerender(<Editor/>);
    expect(screen.queryByRole("button", { name: "Confirm resolution and preserve copies" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(original);
  });
});
