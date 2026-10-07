import { randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesisRequestHistoryPanel } from "@/components/engagement/synthesis-request-history-panel";
import type { SynthesisRequestHistoryPage } from "@/lib/engagement/synthesis-request-history";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const scope = { workspaceId: randomUUID(), campaignId: randomUUID(), sourceId: randomUUID(), sourceSha256: "a".repeat(64) };
  const userId = randomUUID(), onAccessLost = vi.fn();
  const entry = { requestId: randomUUID(), actorId: userId, intentSha256: "b".repeat(64),
    createdAt: "2026-10-06T12:00:00.123456Z", stage: "segment" as const, parentRequestId: null, cancelled: false };
  const page: SynthesisRequestHistoryPage = { schemaVersion: 1, ...scope, pageSize: 25, entries: [entry], nextCursor: null };
  return { props: { ...scope, userId, onAccessLost }, page, entry };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("staff generation history", () => {
  it("reads the selected source with current account headers and displays original identity without claiming execution", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(f.page));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisRequestHistoryPanel {...f.props} />);
    expect(await screen.findByText("Contribution analysis")).toBeTruthy();
    expect(screen.getByText("Request saved")).toBeTruthy();
    expect(screen.getByText(f.entry.requestId)).toBeTruthy();
    expect(screen.getByText(f.entry.actorId)).toBeTruthy();
    expect(screen.getByText(f.entry.intentSha256)).toBeTruthy();
    expect(screen.getByText(/does not mean analysis has finished/)).toBeTruthy();
    const [url, init] = fetcher.mock.calls[0], parsed = new URL(String(url), "http://localhost");
    expect(parsed.pathname).toBe(`/api/engagement/campaigns/${f.props.campaignId}/synthesis/generation/history`);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ sourceId: f.props.sourceId, sourceSha256: f.props.sourceSha256 });
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: {
      "x-openplan-expected-user": f.props.userId, "x-openplan-expected-workspace": f.props.workspaceId,
    } });
  });

  it("shows all stages and a recorded cancellation separately from saved requests", async () => {
    const f = fixture();
    f.page.entries = [f.entry, { ...f.entry, requestId: randomUUID(), createdAt: "2026-10-05T12:00:00Z", stage: "context", parentRequestId: f.entry.requestId, cancelled: true },
      { ...f.entry, requestId: randomUUID(), createdAt: "2026-10-04T12:00:00Z", stage: "thematic", parentRequestId: f.entry.requestId, actorId: randomUUID() }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(f.page))); render(<SynthesisRequestHistoryPanel {...f.props} />);
    expect(await screen.findByText("Combined context")).toBeTruthy();
    expect(screen.getByText("Themes")).toBeTruthy();
    expect(screen.getByText("Cancellation recorded")).toBeTruthy();
    expect(screen.getByText(/Requested by another staff account/)).toBeTruthy();
  });

  it("continues with the exact cursor and appends older requests", async () => {
    const f = fixture(); f.page.entries = Array.from({ length: 25 }, (_, n) => ({ ...f.entry, requestId: randomUUID(), createdAt: new Date(Date.UTC(2026, 9, 6, 12, 0, 59 - n)).toISOString() }));
    const last = f.page.entries[24]; f.page.nextCursor = { id: last.requestId, createdAt: last.createdAt };
    const older = { ...f.page, entries: [{ ...f.entry, createdAt: "2026-10-05T12:00:00Z" }], nextCursor: null };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.page)).mockResolvedValueOnce(json(older));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisRequestHistoryPanel {...f.props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load older generation requests" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(26));
    const query = new URL(String(fetcher.mock.calls[1][0]), "http://localhost").searchParams;
    expect(query.get("beforeId")).toBe(last.requestId); expect(query.get("beforeCreatedAt")).toBe(last.createdAt);
    expect(screen.queryByRole("button", { name: "Load older generation requests" })).toBeNull();
  });

  it.each(["sourceId", "sourceSha256", "workspaceId", "campaignId"] as const)("refuses a page with a different %s", async field => {
    const f = fixture(), page = { ...f.page, [field]: field === "sourceSha256" ? "c".repeat(64) : randomUUID() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(page))); render(<SynthesisRequestHistoryPanel {...f.props} />);
    expect(await screen.findByRole("alert")).toBeTruthy(); expect(screen.queryByText(f.entry.requestId)).toBeNull();
    expect(screen.queryByText(/No generation requests were found/)).toBeNull();
  });

  it("clears private rows on denied refresh and notifies the parent", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.page)).mockResolvedValueOnce(json({}, 403));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisRequestHistoryPanel {...f.props} />);
    await screen.findByText(f.entry.requestId); fireEvent.click(screen.getByRole("button", { name: "Refresh generation requests" }));
    await screen.findByRole("alert"); expect(f.props.onAccessLost).toHaveBeenCalledOnce(); expect(screen.queryByText(f.entry.requestId)).toBeNull();
  });

  it("recovers an unavailable read without presenting it as an empty history", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json({ ...f.page, entries: [] }));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisRequestHistoryPanel {...f.props} />);
    await screen.findByRole("alert"); expect(screen.queryByText(/No generation requests were found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh generation requests" }));
    expect(await screen.findByText("No generation requests were found for this saved source.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("discards a late response after the selected source changes", async () => {
    const a = fixture(), b = fixture(); let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValueOnce(pending).mockResolvedValueOnce(json(b.page)));
    const view = render(<SynthesisRequestHistoryPanel {...a.props} />);
    view.rerender(<SynthesisRequestHistoryPanel {...b.props} />);
    await screen.findByText(b.entry.requestId);
    await act(async () => { resolve(json(a.page)); });
    expect(screen.queryByText(a.entry.requestId)).toBeNull(); expect(screen.getByText(b.entry.requestId)).toBeTruthy();
  });
});
