import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResponseHistory } from "@/components/engagement/response-history";
const campaignId = "10000000-0000-4000-8000-000000000001";
const responseId = "20000000-0000-4000-8000-000000000001";
const row = {
  id: "30000000-0000-4000-8000-000000000001", campaign_id: campaignId, response_id: responseId,
  revision: 1, actor_id: null, event: "legacy_baseline", recorded_at: "2026-09-12T00:00:00Z", record_sha256: "a".repeat(64),
  record: { id: responseId, campaign_id: campaignId, category_id: null, theme_title: "Crossings", you_said: "Original words", we_did: "Original answer", status: "draft", ai_assisted: false,
    source_item_ids: [], sort_order: 0, published_at: null, created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" },
};
afterEach(() => vi.unstubAllGlobals());
const open = () => fireEvent.click(screen.getByRole("button", { name: "Response history" }));
it("loads on demand, exposes retained removed copies and states the unknown baseline", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [row, { ...row, id: "30000000-0000-4000-8000-000000000002", revision: 2, event: "removed" }] }) });
  vi.stubGlobal("fetch", fetcher); render(<ResponseHistory campaignId={campaignId} />);
  expect(fetcher).not.toHaveBeenCalled(); open();
  expect(await screen.findByText("Revision 2: Removed from current responses")).toBeVisible();
  expect(screen.getByText(/Earlier changes are unknown/)).toBeVisible();
  expect(screen.getByRole("option")).toHaveTextContent("(removed)");
  expect(fetcher).toHaveBeenCalledWith(`/api/engagement/campaigns/${campaignId}/closeloop/history`, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
});
it("keeps failed reads distinct from empty and retries on request", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ history: [] }) });
  vi.stubGlobal("fetch", fetcher); render(<ResponseHistory campaignId={campaignId} />); open();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be read and verified completely");
  expect(screen.queryByText(/No response history has been retained/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry response history" }));
  expect(await screen.findByText(/No response history has been retained/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("refuses a foreign history payload", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [{ ...row, campaign_id: responseId }] }) }));
  render(<ResponseHistory campaignId={campaignId} />); open();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Original answer")).toBeNull();
});
it("aborts interrupted reads and reads again when reopened", async () => {
  const fetcher = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
  vi.stubGlobal("fetch", fetcher); render(<ResponseHistory campaignId={campaignId} />); open();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole("button", { name: "Close response history" }));
  expect(signal.aborted).toBe(true);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ history: [row] }) }); open();
  expect(await screen.findByText("Revision 1: Retained baseline")).toBeVisible();
});

it("shows retained staff and source-withdrawal reasons while leaving older reasons unknown", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [row,
    { ...row, id: "30000000-0000-4000-8000-000000000002", revision: 2, event: "corrected", change_origin: "staff", change_reason: "Correct the adopted reference", write_request_id: "40000000-0000-4000-8000-000000000001" },
    { ...row, id: "30000000-0000-4000-8000-000000000003", revision: 3, event: "unpublished", change_origin: "source_withdrawal", change_reason: "A linked contribution was withdrawn", write_request_id: "40000000-0000-4000-8000-000000000002" },
  ] }) }));
  render(<ResponseHistory campaignId={campaignId} />); open();
  expect(await screen.findByText(/Correct the adopted reference/)).toBeVisible();
  expect(screen.getByText(/A linked contribution was withdrawn/)).toBeVisible();
  expect(screen.getByText("Staff-reviewed change.")).toBeVisible();
  expect(screen.getByText(/Automatically withdrawn following/)).toBeVisible();
  expect(screen.getByText(/Earlier changes are unknown/)).toBeVisible();
  expect(screen.getByText(/Earlier reasons remain unknown/i)).toBeVisible();
});

it("reopens a retained publication's email status from history after a reload", async () => {
  const publicationRequest = "40000000-0000-4000-8000-000000000003";
  const fetcher = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith("/history")
    ? { history: [{ ...row, event: "published", write_request_id: publicationRequest }] }
    : { broadcast: { campaignId, requestId: publicationRequest, state: "prepared", preparedCount: 1, counts: { uncertain: 1 } } } }));
  vi.stubGlobal("fetch", fetcher);
  render(<ResponseHistory campaignId={campaignId} />); open();
  const refresh = await screen.findByRole("button", { name: "Refresh email status" });
  fireEvent.click(refresh);
  expect(await screen.findByText(/automatic resend is disabled/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith(`/api/engagement/campaigns/${campaignId}/closeloop/broadcasts/${publicationRequest}`, expect.objectContaining({ cache: "no-store" }));
  expect(screen.getByTestId("closeloop-broadcast-notice").id).toBe(`response-history-broadcast-${row.id}`);
});

it("refreshes open history after a confirmed save and preserves selection", async () => {
  const secondId = "20000000-0000-4000-8000-000000000002";
  const second = { ...row, id: "30000000-0000-4000-8000-000000000004", response_id: secondId,
    record: { ...row.record, id: secondId, theme_title: "Second response" } };
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ history: [row, second] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ history: [row, second,
      { ...second, id: "30000000-0000-4000-8000-000000000005", revision: 2, event: "corrected", record: { ...second.record, we_did: "Confirmed correction" } },
    ] }) });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<ResponseHistory campaignId={campaignId} revision={0} />); open();
  await screen.findByRole("combobox"); screen.getByRole("combobox").focus(); fireEvent.change(screen.getByRole("combobox"), { target: { value: secondId } });
  view.rerender(<ResponseHistory campaignId={campaignId} revision={1} />);
  expect(screen.getByText("Refreshing response history. Showing the last verified copy.")).toBeVisible();
  expect(await screen.findByText(/Confirmed correction/)).toBeVisible();
  expect(screen.getByRole("combobox")).toHaveValue(secondId);
  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
