import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CampaignTranslationsPanel } from "@/components/engagement/campaign-translations-panel";
import { campaignTranslationStateFromSnapshot } from "@/lib/engagement/campaign-translations";
import { readPendingTranslations } from "@/lib/engagement/pending-translation";
import type { TranslationWriteIntent } from "@/lib/engagement/translation-write";
import { confirmDestructiveAction } from "./helpers/confirm-dialog";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId,
  rawTranslationSource, rawOriginalTranslation } from "./helpers/translation-editor-fixture";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const corrected = "\u00a0SYNTHETIC corrected wording\ufeff";
function props(snapshot = translationEditorFixture()) {
  return { ...campaignTranslationStateFromSnapshot(snapshot), userId, workspaceId, campaignId: snapshot.campaignId, canWrite: true,
    machineTranslationAvailable: false, machineBatchMax: 25, acceptBatchMax: 200 };
}
function requestBody(mock: ReturnType<typeof vi.spyOn>, index = 0): TranslationWriteIntent {
  return JSON.parse(String((mock.mock.calls[index][1] as RequestInit).body));
}
function receipt(requestId: string, words = corrected, revision = 4) {
  const { revision: _revision, ...entry } = translationEditorFixture().translations[0];
  return { campaignId: id(1), requestId, operation: "save", locale: "es", replayed: false,
    entries: [{ entry: { ...entry, translated_text: words, updated_at: "2026-09-13T01:00:00Z" }, revision, removed: false }] };
}
function writeDraft(words = corrected, reason = "\u00a0SYNTHETIC correction reason\ufeff") {
  fireEvent.change(screen.getByLabelText(/^In .*Spanish/), { target: { value: words } });
  fireEvent.change(screen.getByLabelText("Reason for changing saved wording"), { target: { value: reason } });
  fireEvent.click(screen.getByRole("button", { name: "Save as our wording" }));
}
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); refresh.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe("translation editor retained requests", () => {
  it("preserves an unsent draft and its starting version across a remount with newer source data", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ kind: "conflict" }), { status: 409 }));
    const view = render(<CampaignTranslationsPanel {...props()} />);
    fireEvent.change(screen.getByLabelText(/^In .*Spanish/), { target: { value: corrected } });
    fireEvent.change(screen.getByLabelText("Reason for changing saved wording"), { target: { value: "SYNTHETIC retained draft reason" } });
    view.unmount();
    const newer = translationEditorFixture(); newer.translations[0].revision = 9; newer.translations[0].translated_text = "SYNTHETIC newer saved words";
    newer.campaign.title = "SYNTHETIC newer source";
    render(<CampaignTranslationsPanel {...props(newer)} />);
    expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue(corrected);
    expect(screen.getByLabelText("Reason for changing saved wording")).toHaveValue("SYNTHETIC retained draft reason");
    fireEvent.click(screen.getByRole("button", { name: "Save as our wording" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(requestBody(fetch).entries[0]).toMatchObject({ text: corrected, expectedSource: { text: rawTranslationSource }, expectedTranslation: { id: id(4), revision: 3 } });
  });

  it("does not rebase a typed draft silently when fresh props arrive in the same mounted editor", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ kind: "conflict" }), { status: 409 }));
    const view = render(<CampaignTranslationsPanel {...props()} />);
    fireEvent.change(screen.getByLabelText(/^In .*Spanish/), { target: { value: corrected } });
    const newer = translationEditorFixture(); newer.translations[0].revision = 8;
    view.rerender(<CampaignTranslationsPanel {...props(newer)} />);
    fireEvent.change(screen.getByLabelText("Reason for changing saved wording"), { target: { value: "SYNTHETIC reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as our wording" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(requestBody(fetch).entries[0].expectedTranslation).toEqual({ id: id(4), revision: 3 });
  });
  it("retains exact words and observed versions before sending and clears only a matching acknowledgement", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body: TranslationWriteIntent = JSON.parse(String(init?.body));
      const stored = readPendingTranslations(window.localStorage, userId, id(1), workspaceId).pending;
      expect(stored).toHaveLength(1); expect(stored[0].intent).toEqual(body);
      expect(stored[0].before[0]?.entry.translated_text).toBe(rawOriginalTranslation);
      return new Response(JSON.stringify(receipt(body.requestId)), { status: 200 });
    });
    render(<CampaignTranslationsPanel {...props()} />); writeDraft();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`/api/engagement/campaigns/${id(1)}/translations/commands`);
    expect(requestBody(fetch)).toMatchObject({ operation: "save", locale: "es", reason: "\u00a0SYNTHETIC correction reason\ufeff", entries: [{
      entityType: "campaign", entityId: id(1), field: "title", expectedSource: { text: rawTranslationSource, sourceLocale: null, available: true },
      expectedTranslation: { id: id(4), revision: 3 }, text: corrected,
    }] });
    expect(readPendingTranslations(window.localStorage, userId, id(1), workspaceId).pending).toEqual([]);
    expect(screen.queryByRole("region", { name: "Pending translation change" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as our wording" })).toBeDisabled();
  });

  it("retries the identical request after reload even when current words and versions have changed", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("SYNTHETIC lost acknowledgement"));
    const first = render(<CampaignTranslationsPanel {...props()} />); writeDraft();
    await waitFor(() => expect(screen.getByRole("region", { name: "Pending translation change" })).toBeVisible());
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry same translation request" })).toBeEnabled());
    const originalBody = String(fetch.mock.calls[0][1]?.body);
    first.unmount();
    const newer = translationEditorFixture(); newer.campaign.title = "SYNTHETIC newer source"; newer.translations[0].revision = 8;
    newer.translations[0].translated_text = "SYNTHETIC colleague correction";
    render(<CampaignTranslationsPanel {...props(newer)} />);
    fetch.mockImplementationOnce(async (_url, init) => new Response(JSON.stringify({ ...receipt(JSON.parse(String(init?.body)).requestId), replayed: true }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2); expect(String(fetch.mock.calls[1][1]?.body)).toBe(originalBody);
    expect(readPendingTranslations(window.localStorage, userId, id(1), workspaceId).pending).toEqual([]);
  });

  it("keeps words and retry identity after an invalid success acknowledgement", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(JSON.stringify(receipt(JSON.parse(String(init?.body)).requestId, "SYNTHETIC wrong acknowledgement")), { status: 200 }));
    render(<CampaignTranslationsPanel {...props()} />); writeDraft();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry same translation request" })).toBeEnabled());
    expect(refresh).not.toHaveBeenCalled();
    const retained = readPendingTranslations(window.localStorage, userId, id(1), workspaceId).pending;
    expect(retained).toHaveLength(1); expect(retained[0].intent).toEqual(requestBody(fetch));
    expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue(corrected);
    expect(screen.getByRole("button", { name: "Save as our wording" })).toBeDisabled();
  });

  it("does not send a request when local storage cannot retain it", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota exceeded"); });
    render(<CampaignTranslationsPanel {...props()} />); writeDraft();
    await waitFor(() => expect(screen.getByText(/could not retain the request, so no save was sent/)).toBeVisible());
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue(corrected);
    expect(screen.getByRole("button", { name: "Download retained request" })).toBeEnabled();
  });

  it("requires a correction reason before sending a saved version", async () => {
    const fetch = vi.spyOn(globalThis, "fetch"); render(<CampaignTranslationsPanel {...props()} />); writeDraft(corrected, " ");
    await waitFor(() => expect(screen.getByText(/No translation was sent. Enter nonblank wording/)).toBeVisible());
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue(corrected);
  });

  it("reviews a conflict and retains its earlier copy before reopening against a fresh version", async () => {
    const current = translationEditorFixture(); current.translations[0].revision = 4; current.translations[0].translated_text = "SYNTHETIC colleague correction";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ kind: "conflict" }), { status: 409 }));
    const view = render(<CampaignTranslationsPanel {...props()} />); writeDraft();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review current saved translations" })).toBeEnabled());
    const originalBody = requestBody(fetch);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: current }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Review current saved translations" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep this copy and reopen editor" })).toBeEnabled());
    expect(within(screen.getByRole("region", { name: "Pending translation change" })).getByText(/SYNTHETIC colleague correction/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep this copy and reopen editor" }));
    expect(readPendingTranslations(window.localStorage, userId, id(1), workspaceId).pending).toEqual([]);
    const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).find(key => key.startsWith("openplan:translation-archive:"))!;
    expect(JSON.parse(localStorage.getItem(key)!).intent).toEqual(originalBody);
    view.rerender(<CampaignTranslationsPanel {...props(current)} />);
    expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue(corrected);
    expect(screen.getByLabelText("Reason for changing saved wording")).toHaveValue("");
    fetch.mockImplementationOnce(async (_url, init) => new Response(JSON.stringify(receipt(JSON.parse(String(init?.body)).requestId, corrected, 5)), { status: 200 }));
    writeDraft(corrected, "SYNTHETIC reviewed correction");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const reviewed = requestBody(fetch, 2);
    expect(reviewed.requestId).not.toBe(originalBody.requestId); expect(reviewed.entries[0].expectedTranslation).toEqual({ id: id(4), revision: 4 });
    expect(JSON.parse(localStorage.getItem(key)!).intent).toEqual(originalBody);
  });

  it("withholds reopening after an incomplete current read and offers no new request for an uncertain outcome", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("SYNTHETIC timeout"));
    render(<CampaignTranslationsPanel {...props()} />); writeDraft();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry same translation request" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Review current saved translations" })).not.toBeInTheDocument();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ kind: "conflict" }), { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: "Retry same translation request" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review current saved translations" })).toBeEnabled());
    const partial = translationEditorFixture(); partial.translations = [];
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: partial }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Review current saved translations" }));
    await waitFor(() => expect(screen.getByText(/Current translations could not be read completely/)).toBeVisible());
    expect(screen.queryByRole("button", { name: "Keep this copy and reopen editor" })).not.toBeInTheDocument();
    expect(readPendingTranslations(window.localStorage, userId, id(1), workspaceId).pending).toHaveLength(1);
  });

  it("withdraws retained wording with a blank source using its exact observed version", async () => {
    const snapshot = translationEditorFixture(); snapshot.campaign.title = null;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const original = receipt(body.requestId, rawOriginalTranslation);
      return new Response(JSON.stringify({ ...original, operation: "withdraw", entries: [{ ...original.entries[0], removed: true }] }), { status: 200 });
    });
    render(<CampaignTranslationsPanel {...props(snapshot)} />);
    expect(screen.getByRole("button", { name: "Save as our wording" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for changing saved wording"), { target: { value: "SYNTHETIC obsolete source" } });
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw$/ })); await confirmDestructiveAction("Withdraw this translation");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(requestBody(fetch)).toMatchObject({ operation: "withdraw", entries: [{ expectedSource: { text: null, sourceLocale: null, available: false }, expectedTranslation: { id: id(4), revision: 3 } }] });
  });

  it("keeps unsupported recorded languages visible and permits withdrawal of their saved copies", async () => {
    const snapshot = translationEditorFixture(); snapshot.campaign.default_content_locale = "qaa"; snapshot.translations[0].locale = "qaa";
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const { revision: _revision, ...entry } = snapshot.translations[0];
      return new Response(JSON.stringify({ campaignId: id(1), requestId: body.requestId, operation: "withdraw", locale: "qaa", replayed: false,
        entries: [{ entry, revision: 4, removed: true }] }), { status: 200 });
    });
    render(<CampaignTranslationsPanel {...props(snapshot)} />);
    expect(screen.getByText(/The recorded source language is qaa/)).toBeVisible();
    expect(screen.queryByText(/Nobody has recorded/)).not.toBeInTheDocument();
    const other = screen.getByRole("region", { name: "Other saved wording" }); expect(within(other).getByText(/SYNTHETIC original translation/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Reason for changing saved wording"), { target: { value: "SYNTHETIC withdraw retained copy" } });
    fireEvent.click(within(other).getByRole("button", { name: "Withdraw saved qaa wording" })); await confirmDestructiveAction("Withdraw this translation");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); expect(requestBody(fetch).locale).toBe("qaa");
  });
});
