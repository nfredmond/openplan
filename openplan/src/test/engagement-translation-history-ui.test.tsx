import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TranslationHistory } from "@/components/engagement/translation-history";
const campaignId = "10000000-0000-4000-8000-000000000001";
const translationId = "20000000-0000-4000-8000-000000000001";
const row = {
  id: "30000000-0000-4000-8000-000000000001", campaign_id: campaignId, translation_id: translationId,
  revision: 1, actor_id: null, write_request_id: null, change: null, event: "legacy_baseline", recorded_at: "2026-09-12T00:00:00Z", record_sha256: "a".repeat(64),
  record: { id: translationId, workspace_id: "40000000-0000-4000-8000-000000000001", campaign_id: campaignId,
    entity_type: "campaign", entity_id: campaignId, field: "title", locale: "es", translated_text: "Original answer", source: "machine",
    machine_model: "synthetic-model", source_text_hash: null, created_by: null, created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" },
};
afterEach(() => vi.unstubAllGlobals());
const open = () => fireEvent.click(screen.getByRole("button", { name: "Translation history" }));
it("loads on demand, exposes retained removed copies and states the unknown baseline", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [row, { ...row, id: "30000000-0000-4000-8000-000000000002", revision: 2, event: "removed" }] }) });
  vi.stubGlobal("fetch", fetcher); render(<TranslationHistory campaignId={campaignId} />);
  expect(fetcher).not.toHaveBeenCalled(); open();
  expect(await screen.findByText("Revision 2: Withdrawn")).toBeVisible();
  expect(screen.getByText(/Earlier changes and actors are unknown/)).toBeVisible();
  expect(screen.getByRole("option")).toHaveTextContent("(withdrawn)");
  expect(fetcher).toHaveBeenCalledWith(`/api/engagement/campaigns/${campaignId}/translations/history`, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
});
it("keeps failed reads distinct from empty and retries on request", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ history: [] }) });
  vi.stubGlobal("fetch", fetcher); render(<TranslationHistory campaignId={campaignId} />); open();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be read and verified completely");
  expect(screen.queryByText(/No translation history has been retained/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry translation history" }));
  expect(await screen.findByText(/No translation history has been retained/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("refuses a foreign history payload", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [{ ...row, campaign_id: translationId }] }) }));
  render(<TranslationHistory campaignId={campaignId} />); open();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Original answer")).toBeNull();
});
it("aborts interrupted reads and reads again when reopened", async () => {
  const fetcher = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
  vi.stubGlobal("fetch", fetcher); render(<TranslationHistory campaignId={campaignId} />); open();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole("button", { name: "Close translation history" }));
  expect(signal.aborted).toBe(true);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ history: [row] }) }); open();
  expect(await screen.findByText("Revision 1: Retained baseline")).toBeVisible();
});

it("refreshes open history after a confirmed save and preserves selection", async () => {
  const secondId = "20000000-0000-4000-8000-000000000002";
  const second = { ...row, id: "30000000-0000-4000-8000-000000000004", translation_id: secondId,
    record: { ...row.record, id: secondId, translated_text: "Second translation" } };
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ history: [row, second] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ history: [row, second,
      { ...second, id: "30000000-0000-4000-8000-000000000005", revision: 2, event: "corrected", record: { ...second.record, translated_text: "Confirmed correction" } },
    ] }) });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<TranslationHistory campaignId={campaignId} revision={0} />); open();
  await screen.findByRole("combobox"); screen.getByRole("combobox").focus(); fireEvent.change(screen.getByRole("combobox"), { target: { value: secondId } });
  view.rerender(<TranslationHistory campaignId={campaignId} revision={1} />);
  expect(screen.getByText("Refreshing translation history. Showing the last verified copy.")).toBeVisible();
  expect(await screen.findByText("Confirmed correction")).toBeVisible();
  expect(screen.getByRole("combobox")).toHaveValue(secondId);
  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("shows the verified reason, exact checked source and starting version beside retained words", async () => {
  const reason = "\u00a0SYNTHETIC change reason\ufeff", source = "\u00a0SYNTHETIC checked source\ufeff";
  const requestId = "60000000-0000-4000-8000-000000000001";
  const linked = { ...row, event: "corrected", revision: 2, write_request_id: requestId,
    change: { requestId, operation: "save", reason, source: { text: source, sourceLocale: "es", available: true },
      expectedTranslation: { id: translationId, revision: 1 }, payloadSha256: "b".repeat(64), resultSha256: "c".repeat(64) } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [linked] }) }));
  render(<TranslationHistory campaignId={campaignId} />); open();
  const shownSource = await screen.findByText(/SYNTHETIC checked source/);
  expect(shownSource.textContent).toBe(source); expect(shownSource).toHaveAttribute("lang", "es"); expect(shownSource).toHaveAttribute("dir", "auto");
  expect(screen.getByText(/SYNTHETIC change reason/).textContent).toBe("Reason: " + reason);
  expect(screen.getByText("Started from saved revision 1.")).toBeVisible();
  expect(screen.getByText("Verified change receipt")).toBeVisible();
  expect(screen.queryByText(/Reason and checked source text were not retained/)).toBeNull();
});

it("shows an absent source and unknown recorded language without borrowing current wording", async () => {
  const requestId = "60000000-0000-4000-8000-000000000001";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [{ ...row, event: "removed", revision: 2,
    write_request_id: requestId, change: { requestId, operation: "withdraw", reason: "SYNTHETIC obsolete source",
      source: { text: null, sourceLocale: null, available: false }, expectedTranslation: { id: translationId, revision: 1 },
      payloadSha256: "b".repeat(64), resultSha256: "c".repeat(64) } }] }) }));
  render(<TranslationHistory campaignId={campaignId} />); open();
  expect(await screen.findByText("No source words recorded")).toBeVisible();
  expect(screen.getByText("Recorded source language: Not recorded.")).toBeVisible();
  expect(screen.getByText("Source was unavailable for new wording.")).toBeVisible();
});

it("refuses a linked history entry with missing or unrelated change evidence", async () => {
  const requestId = "60000000-0000-4000-8000-000000000001";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [{ ...row, write_request_id: requestId }] }) }));
  render(<TranslationHistory campaignId={campaignId} />); open();
  expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.queryByText("Original answer")).toBeNull();
});
