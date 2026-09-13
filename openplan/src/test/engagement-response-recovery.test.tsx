import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
import { ResponseBroadcastNotice } from "@/components/engagement/response-broadcast-notice";
import { clearPendingResponse, pendingResponseKey, readPendingResponse, retainPendingResponse, type PendingResponse } from "@/lib/engagement/pending-response";

const campaignId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const otherId = "40000000-0000-4000-8000-000000000001";
const userId = "staff-1";
const key = pendingResponseKey(userId, campaignId);
const version = "2026-09-13T08:00:00.123456+00:00";
const later = "2026-09-13T08:01:00.654321+00:00";
const entry = { id: entryId, campaign_id: campaignId, category_id: null, theme_title: "Crossings", you_said: "Original input", we_did: "Original response", status: "draft" as const, ai_assisted: true,
  source_item_ids: [otherId], sort_order: 0, published_at: null, created_at: version, updated_at: version };
const pending = { version: 1, userId, campaignId, origin: "entry", phase: "unconfirmed", before: entry,
  intent: { operation: "update", entryId, body: { requestId, expectedUpdatedAt: version, reason: "Correct the work program reference", weDid: "My retained words" } } } satisfies PendingResponse;
function reply(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function receipt(init: RequestInit, changes = {}) {
  const body = JSON.parse(String(init.body));
  return { entry: { ...entry, we_did: body.weDid ?? entry.we_did, updated_at: later }, entryId, requestId: body.requestId,
    replayed: false, removed: init.method === "DELETE", becamePublished: false, ...changes };
}
function mount(rows = [entry], owner = userId) {
  return render(<EngagementCloseLoopBuilder userId={owner} campaignId={campaignId} categories={[]} initialEntries={rows} />);
}
function startEdit() {
  fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Correct the work program reference" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getAllByLabelText("We did")[0], { target: { value: "My retained words" } });
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("pending response custody", () => {
  it("retains exact microsecond versions, words and reasons in the user/campaign scope", () => {
    expect(retainPendingResponse(sessionStorage, pending)).toEqual(pending);
    expect(readPendingResponse(sessionStorage, userId, campaignId)).toEqual(pending);
    expect(readPendingResponse(sessionStorage, "another-user", campaignId)).toBeNull();
    expect(readPendingResponse(sessionStorage, userId, otherId)).toBeNull();
    clearPendingResponse(sessionStorage, pending);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("refuses a foreign scope or baseline instead of rebinding another person's intent", () => {
    sessionStorage.setItem(key, JSON.stringify({ ...pending, userId: "another-user" }));
    expect(() => readPendingResponse(sessionStorage, userId, campaignId)).toThrow();
    expect(() => retainPendingResponse(sessionStorage, { ...pending, before: { ...entry, updated_at: later } })).toThrow();
    expect(() => retainPendingResponse(sessionStorage, { ...pending, before: { ...entry, id: otherId } })).toThrow();
  });
  it("detects a storage write that returned without retaining the request", () => {
    const storage = { setItem: vi.fn(), getItem: () => null, removeItem: vi.fn() };
    expect(() => retainPendingResponse(storage, pending)).toThrow(/not retained/);
  });
  it("does not clear a newer pending request", () => {
    retainPendingResponse(sessionStorage, { ...pending, intent: { ...pending.intent, body: { ...pending.intent.body, requestId: otherId } } });
    expect(() => clearPendingResponse(sessionStorage, pending)).toThrow(/Another response request/);
    expect(readPendingResponse(sessionStorage, userId, campaignId)?.intent.body.requestId).toBe(otherId);
  });
});

it("retains before transport, refuses duplicate clicks, and clears only after a confirmed receipt", async () => {
  let finish: ((response: Response) => void) | undefined;
  let submitted: RequestInit | undefined;
  const fetcher = vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
    const saved = readPendingResponse(sessionStorage, userId, campaignId);
    expect(saved?.intent.body).toEqual(JSON.parse(String(init?.body)));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    submitted = init;
    return new Promise(resolve => { finish = resolve; });
  });
  mount(); startEdit();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Retry same save" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: /Generate drafts/ })).toBeDisabled();
  finish!(reply(receipt(submitted!)));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(screen.queryByRole("region", { name: "Pending response change" })).toBeNull();
  expect(screen.getByText("My retained words")).toBeVisible();
  expect(screen.getByText("Response saved.")).toHaveFocus();
});

it("does not contact the server when the tab cannot retain the request", async () => {
  const fetcher = vi.spyOn(global, "fetch");
  mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  startEdit();
  expect(await screen.findByText(/no save was sent/)).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Pending response change" })).toHaveTextContent("My retained words");
});

it("recovers an interrupted correction after reload with exactly the same body", async () => {
  const fetcher = vi.spyOn(global, "fetch").mockRejectedValue(new Error("disconnect"));
  const page = mount(); startEdit();
  await screen.findByText(/This save is unconfirmed/);
  await waitFor(() => expect(screen.getByRole("region", { name: "Pending response change" })).toHaveFocus());
  const firstBody = fetcher.mock.calls[0][1]?.body;
  page.unmount();
  fetcher.mockImplementation(async (_url, init) => reply(receipt(init!, { replayed: true })));
  mount([{ ...entry, we_did: "My retained words", updated_at: later }]);
  expect(screen.getByRole("region", { name: "Pending response change" })).toHaveTextContent("My retained words");
  fireEvent.click(screen.getByRole("button", { name: "Retry same save" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(fetcher.mock.calls[1][1]?.body).toBe(firstBody);
  expect(screen.getByText(/0 published, 1 total/)).toBeVisible();
});

it("keeps a committed removal retry available when the current card is absent after reload", async () => {
  retainPendingResponse(sessionStorage, { ...pending, intent: { operation: "remove", entryId, body: { requestId, expectedUpdatedAt: version, reason: "Replace obsolete response" } } });
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => reply(receipt(init!, { replayed: true })));
  mount([]);
  expect(screen.getByRole("region", { name: "Pending response change" })).toHaveTextContent("Response you asked to remove");
  fireEvent.click(screen.getByRole("button", { name: "Retry same save" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(fetcher.mock.calls[0][1]?.method).toBe("DELETE");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ requestId, expectedUpdatedAt: version, reason: "Replace obsolete response" });
  expect(screen.getByText(/0 published, 0 total/)).toBeVisible();
});

it.each(["foreign request", "missing receipt", "malformed entry"])("keeps the pending draft after a successful HTTP response with %s", async failure => {
  vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => reply(failure === "missing receipt" ? { entry } : receipt(init!, failure === "malformed entry" ? { entry: { ...entry, theme_title: 12 } } : { requestId: otherId })));
  mount(); startEdit();
  await screen.findByText(/This save is unconfirmed/);
  expect(readPendingResponse(sessionStorage, userId, campaignId)?.intent.body).toMatchObject({ weDid: "My retained words" });
  expect(screen.getByRole("button", { name: /Generate drafts/ })).toBeDisabled();
});

it("requires current-copy review before replacing a conflicted intent, then keeps the new version and reason", async () => {
  let writes = 0;
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
    if (!init?.method) return reply({ entries: [{ ...entry, we_did: "Other staff correction", updated_at: later }] });
    writes++;
    return writes === 1 ? reply({ kind: "conflict" }, 409) : reply(receipt(init));
  });
  mount(); startEdit();
  await screen.findByText(/saved response or request has changed/);
  const first = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(screen.queryByRole("button", { name: "Save reviewed change" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review current saved responses" }));
  expect(await screen.findByText("Other staff correction")).toBeVisible();
  expect(screen.getByText("Copy you started from")).toBeVisible();
  expect(screen.getByLabelText("Reviewed we did")).toHaveValue("My retained words");
  expect(writes).toBe(1);
  fireEvent.change(screen.getByLabelText("Reason for reviewed change"), { target: { value: "Reviewed the intervening correction" } });
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed change" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  const last = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
  expect(last).toMatchObject({ weDid: "My retained words", expectedUpdatedAt: later, reason: "Reviewed the intervening correction" });
  expect(last.requestId).not.toBe(first.requestId);
  expect(writes).toBe(2);
});

it("does not overwrite an intervening text correction when reviewing only a publication change", async () => {
  retainPendingResponse(sessionStorage, { ...pending, phase: "conflict", intent: { operation: "update", entryId,
    body: { requestId, expectedUpdatedAt: version, reason: "Reviewed for publication", status: "published" } } });
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => init?.method
    ? reply(receipt(init)) : reply({ entries: [{ ...entry, we_did: "Other staff correction", updated_at: later }] }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Review current saved responses" }));
  await screen.findByText("Other staff correction");
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed change" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).not.toHaveProperty("weDid");
});

it("keeps the draft and refuses replacement when current-copy review is incomplete or foreign", async () => {
  retainPendingResponse(sessionStorage, { ...pending, phase: "conflict" });
  vi.spyOn(global, "fetch").mockResolvedValue(reply({ entries: [{ ...entry, campaign_id: otherId }] }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Review current saved responses" }));
  await screen.findByText(/could not be read completely/);
  expect(screen.queryByRole("button", { name: "Save reviewed change" })).toBeNull();
  expect(readPendingResponse(sessionStorage, userId, campaignId)?.intent.body.requestId).toBe(requestId);
});

it("resolves a confirmed absent current response without inventing a removal receipt", async () => {
  retainPendingResponse(sessionStorage, { ...pending, phase: "missing" });
  const fetcher = vi.spyOn(global, "fetch").mockResolvedValue(reply({ entries: [] }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Review current saved responses" }));
  await screen.findByText(/does not confirm who removed it/);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss pending change to the absent response" }));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(screen.getByText(/0 published, 0 total/)).toBeVisible();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it("does not expose another user's retained draft", () => {
  retainPendingResponse(sessionStorage, pending);
  mount([], "another-user");
  expect(screen.queryByText("My retained words")).toBeNull();
  expect(screen.queryByRole("region", { name: "Pending response change" })).toBeNull();
  expect(readPendingResponse(sessionStorage, userId, campaignId)).toEqual(pending);
});

it("requires a recorded reason before publication or removal", () => {
  const fetcher = vi.spyOn(global, "fetch");
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(screen.getByText("Record a reason for this change.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
  expect(screen.getByText("Record a reason for this removal.")).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
});

it("refreshes complete email states without turning provider acceptance into inbox delivery", async () => {
  const report = { campaignId, requestId, state: "queued", preparedCount: null, counts: {} };
  const fetcher = vi.spyOn(global, "fetch").mockResolvedValue(reply({ broadcast: { ...report, state: "prepared", preparedCount: 3, counts: { accepted: 1, uncertain: 1, skipped: 1 } } }));
  render(<ResponseBroadcastNotice campaignId={campaignId} entryId={entryId} requestId={requestId} initialReport={report} />);
  expect(screen.getByText(/recipient count is not known yet/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh email status" }));
  await screen.findByText(/inbox delivery is not confirmed/);
  expect(screen.getByText(/automatic resend is disabled/)).toBeVisible();
  expect(screen.getByText(/no email service was configured/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith(`/api/engagement/campaigns/${campaignId}/closeloop/broadcasts/${requestId}`, expect.objectContaining({ cache: "no-store" }));
  fetcher.mockResolvedValue(reply({ broadcast: { ...report, campaignId: otherId } }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh email status" }));
  expect(await screen.findByText(/status is unknown/)).toBeVisible();
});

it.each([
  ["prepared", 0, "no confirmed, active subscriptions"], ["no_share_token", null, "unsubscribe links"],
  ["cancelled", null, "cancelled before messages were prepared"],
] as const)("shows %s distinctly and gives repeated cards unique anchors", (state, preparedCount, text) => {
  const report = { campaignId, requestId, state, preparedCount, counts: {} };
  render(<><ResponseBroadcastNotice campaignId={campaignId} entryId={entryId} requestId={requestId} initialReport={report} />
    <ResponseBroadcastNotice campaignId={campaignId} entryId={otherId} requestId={requestId} initialReport={report} /></>);
  const notices = screen.getAllByTestId("closeloop-broadcast-notice");
  expect(new Set(notices.map(n => n.id)).size).toBe(2);
  expect(within(notices[0]).getByRole("status")).toHaveTextContent(text);
});

it("recovers a created response after reload without appending a duplicate", async () => {
  retainPendingResponse(sessionStorage, { version: 1, userId, campaignId, origin: "manual", phase: "unconfirmed", before: null,
    intent: { operation: "create", body: { requestId, themeTitle: entry.theme_title, youSaid: entry.you_said, weDid: entry.we_did } } });
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => reply(receipt(init!, { replayed: true })));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Retry same save" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(screen.getByText(/0 published, 1 total/)).toBeVisible();
  expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).requestId).toBe(requestId);
});

it("can correct a rejected theme tag without losing retained contribution provenance", async () => {
  retainPendingResponse(sessionStorage, { ...pending, phase: "rejected", intent: { ...pending.intent, body: { ...pending.intent.body, categoryId: otherId, sourceItemIds: [otherId], aiAssisted: true } } });
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => init?.method ? reply(receipt(init)) : reply({ entries: [entry] }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Review current saved responses" }));
  const select = await screen.findByLabelText("Reviewed theme tag");
  fireEvent.change(select, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed change" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ categoryId: null, sourceItemIds: [otherId], aiAssisted: true });
});

it("leaves an invalid unsent edit editable instead of trapping it as an unknown save", async () => {
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => reply(receipt(init!)));
  mount([]);
  fireEvent.change(screen.getByPlaceholderText(/Safer crossings downtown/), { target: { value: "Crossings" } });
  fireEvent.change(screen.getByLabelText("We did"), { target: { value: "x".repeat(5001) } });
  fireEvent.click(screen.getByRole("button", { name: /Add entry/ }));
  await screen.findByText(/no save was sent/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Pending response change" })).toBeNull();
  expect(screen.getByLabelText("We did")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("We did"), { target: { value: "Corrected within the text limit" } });
  fireEvent.click(screen.getByRole("button", { name: /Add entry/ }));
  await screen.findByText("Corrected within the text limit");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("offers reviewed correction after an HTTP body-size refusal", async () => {
  vi.spyOn(global, "fetch").mockResolvedValue(reply({ error: "Request body is too large" }, 413));
  mount(); startEdit();
  expect(await screen.findByRole("button", { name: "Review current saved responses" })).toBeVisible();
  expect(readPendingResponse(sessionStorage, userId, campaignId)?.phase).toBe("rejected");
});

it("preserves unreadable recovery bytes before reopening the editor", async () => {
  const damaged = '{"userId":"staff-1","words":"retain these words"';
  sessionStorage.setItem(key, damaged);
  const fetcher = vi.spyOn(global, "fetch");
  mount();
  expect(screen.getByRole("button", { name: /Generate drafts/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preserve unreadable copy and reopen editor" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Generate drafts/ })).toBeEnabled());
  const archives = Object.keys(sessionStorage).filter(name => name.startsWith(`${key}:unreadable:`));
  expect(archives).toHaveLength(1);
  expect(sessionStorage.getItem(archives[0])).toBe(damaged);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("removes an accepted AI suggestion when retained text was trimmed", async () => {
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => String(url).endsWith("/draft")
    ? reply({ drafts: [{ themeTitle: "  Crossings  ", youSaid: "  Original input  ", sourceItemIds: [otherId] }], source: "ai", model: "synthetic-local", itemCount: 1 })
    : reply(receipt(init!)));
  mount([]);
  fireEvent.click(screen.getByRole("button", { name: /Generate drafts/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Add as draft entry" }));
  await screen.findByText("Response saved.");
  expect(screen.queryByRole("button", { name: "Add as draft entry" })).toBeNull();
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ themeTitle: "Crossings", youSaid: "Original input", sourceItemIds: [otherId], aiAssisted: true });
});

it("keeps an unreadable active record when its preservation copy cannot be retained", async () => {
  sessionStorage.setItem(key, "damaged original bytes");
  mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Preserve unreadable copy and reopen editor" }));
  expect(await screen.findByText(/Nothing was discarded/)).toBeVisible();
  expect(sessionStorage.getItem(key)).toBe("damaged original bytes");
  expect(screen.getByRole("button", { name: /Generate drafts/ })).toBeDisabled();
});

it("does not archive a valid request that replaced an unreadable record", async () => {
  sessionStorage.setItem(key, "damaged original bytes");
  mount();
  retainPendingResponse(sessionStorage, pending);
  fireEvent.click(screen.getByRole("button", { name: "Preserve unreadable copy and reopen editor" }));
  expect(await screen.findByText(/Nothing was discarded/)).toBeVisible();
  expect(readPendingResponse(sessionStorage, userId, campaignId)).toEqual(pending);
  fireEvent.click(screen.getByRole("button", { name: "Retry recovery" }));
  expect(screen.getByRole("region", { name: "Pending response change" })).toHaveTextContent("My retained words");
});

it("refreshes history opened during a pending correction after its acknowledgement", async () => {
  let saved = false;
  let acknowledge: (() => void) | undefined;
  const original = { id: requestId, campaign_id: campaignId, response_id: entryId, revision: 1,
    actor_id: null, event: "created", recorded_at: version, record_sha256: "a".repeat(64), record: entry };
  const fetcher = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/history")) return reply({ history: saved ? [original, {
      ...original, id: otherId, revision: 2, event: "corrected", record: { ...entry, we_did: "My retained words", updated_at: later },
    }] : [original] });
    return new Promise<Response>(resolve => { acknowledge = () => { saved = true; resolve(reply(receipt(init!))); }; });
  });
  mount(); startEdit();
  fireEvent.click(screen.getByRole("button", { name: "Response history" }));
  await screen.findByText(/1 retained revisions/);
  screen.getByRole("combobox").focus();
  acknowledge!();
  await screen.findByText(/2 retained revisions/);
  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/history"))).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Close response history" })).toBeVisible();
});
