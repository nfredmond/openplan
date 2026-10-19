// DOM/fetch controls do not prove browser layout, real auth or persistence.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
import { FundingAwardClosureHistory } from "@/components/grants/funding-award-closure-history";
import { FundingAwardCloseoutPanel, type FundingAwardCloseoutAward } from "@/components/grants/funding-award-closeout-control";

const AWARD = "11111111-1111-4111-8111-111111111111";
const OTHER = "66666666-6666-4666-8666-666666666666";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";
const receipt = {
  id: "77777777-7777-4777-8777-777777777777", award_id: AWARD, workspace_id: WORKSPACE,
  revision_id: REVISION, actor_id: ACTOR, event: "earned_coverage",
  created_at: "2026-10-19T11:01:41.150334+00:00",
  basis: { previousClosure: { basis: null, closedAt: null, note: null }, expectedCurrent: REVISION, note: '<img src=x onerror="alert(1)"> & retained note', ceiling: "100.01", paid: "100.01", currency: "USD", invoices: [] },
};
const reopen = {
  ...receipt, id: "88888888-8888-4888-8888-888888888888", event: "reopen",
  created_at: "2026-10-19T11:02:41.150334+00:00",
  basis: { previousClosure: { basis: "earned_coverage", closedAt: receipt.created_at, note: receipt.basis.note }, expectedCurrent: REVISION, note: "Retained reopen reason", reopenSpendingStatus: "delayed" },
};
const history = (receipts: unknown[] = [receipt], awardId = AWARD) => ({ state: "available", awardId, workspaceId: WORKSPACE, limit: 500, receipts });
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
const showHistory = () => fireEvent.click(screen.getByRole("button", { name: "Close and reopen history" }));
const section = () => screen.getByRole("region", { name: "Award close and reopen history" });

// Observe committed text before passive effects can replace a stale response.
function CommitTextProbe({ children, onCommit }: { children: ReactNode; onCommit: (text: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { onCommit(root.current?.textContent ?? ""); });
  return <div ref={root}>{children}</div>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  refreshMock.mockReset();
});

describe("discoverable retained award transition reader", () => {
  it("loads only through the normal trigger and shows exact values, provenance and escaped note text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(history([receipt, reopen])));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="initial" />);
    expect(fetchMock).not.toHaveBeenCalled();
    showHistory();
    expect(await screen.findByText("Closed on recorded paid coverage (earned_coverage)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/funding-awards/${AWARD}/closure-history`, { cache: "no-store", signal: expect.any(AbortSignal) });
    const rows = within(section()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(receipt.id);
    expect(rows[1]).toHaveTextContent(reopen.id);
    expect(rows[0]).toHaveTextContent(receipt.created_at);
    expect(rows[0]).toHaveTextContent(REVISION);
    expect(rows[0]).toHaveTextContent(ACTOR);
    expect(rows[0]).toHaveTextContent("Retained ceiling: USD 100.01");
    expect(rows[0]).toHaveTextContent("Retained paid amount: USD 100.01");
    expect(rows[0]).toHaveTextContent(receipt.basis.note);
    expect(rows[1]).toHaveTextContent("Selected destination: Delayed");
    expect(rows[1]).toHaveTextContent("Retained reopen reason");
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
    expect(rows[0].querySelector("pre")?.textContent).toBe(JSON.stringify(receipt.basis, null, 2));
    expect(section()).toHaveTextContent("500-receipt limit");
  });

  it("shows an old receipt's missing destination as not recorded, without guessing active", async () => {
    const { reopenSpendingStatus: _destination, ...basis } = reopen.basis;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(history([{ ...reopen, basis }]))));
    render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="legacy" />);
    showHistory();
    await screen.findByText("Reopened (reopen)");
    expect(section()).toHaveTextContent("Selected destination: Not recorded");
    expect(section()).not.toHaveTextContent("Selected destination: Active");
    expect(section()).not.toHaveTextContent("Selected destination: Delayed");
  });

  it.each([null, [], "old shape", { note: "unassessed partial" }])("renders a legacy basis %j as unassessed with exact optional details", async (basis) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(history([{ ...receipt, basis }]))));
    const view = render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="legacy-basis" />);
    showHistory();
    await screen.findByText("Closed on recorded paid coverage (earned_coverage)");
    expect(section()).toHaveTextContent("Retained basis unassessed");
    expect(section()).not.toHaveTextContent("Retained paid amount:");
    expect(view.container.querySelector("pre")?.textContent).toBe(JSON.stringify(basis, null, 2));
  });

  it("distinguishes counted empty history and loads again after remount/reload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(history([])));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="reload" />);
    showHistory();
    expect(await screen.findByText(/No retained close or reopen receipts/)).toBeInTheDocument();
    expect(section()).not.toHaveTextContent("history unavailable");
    view.unmount();
    render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="reload" />);
    showHistory();
    await screen.findByText(/No retained close or reopen receipts/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    response({ error: "Permission denied" }, false),
    response(null),
    response({ ...history(), state: "partial" }),
    response({ ...history(), receipts: [{ ...receipt, actor_id: null }] }),
    response(history([{ ...receipt, award_id: OTHER }])),
    response(history([], OTHER)),
    response({ ...history(), limit: 100 }),
  ])("shows unavailable rather than empty or partial facts for invalid response %#", async (result) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result));
    render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="failure" />);
    showHistory();
    await screen.findByText(/Award transition history unavailable/);
    expect(section()).not.toHaveTextContent("No retained close or reopen receipts");
    expect(section()).not.toHaveTextContent("100.01");
  });

  it("offers a focused refresh after a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Network failure")).mockResolvedValueOnce(response(history()));
    vi.stubGlobal("fetch", fetchMock);
    render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="retry" />);
    showHistory();
    await screen.findByText(/Award transition history unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await screen.findByText("Closed on recorded paid coverage (earned_coverage)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("suppresses pending responses across award selection even if transport ignores abort", async () => {
    let resolveOld!: (result: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(response(history([], OTHER)));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<FundingAwardClosureHistory awardId={AWARD} refreshKey="selection" />);
    showHistory();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender(<FundingAwardClosureHistory awardId={OTHER} refreshKey="selection" />);
    await screen.findByText(/No retained close or reopen receipts/);
    await act(async () => { resolveOld(response(history())); await pending; });
    expect(section()).not.toHaveTextContent(receipt.id);
    expect(section()).not.toHaveTextContent(receipt.basis.note);
    expect(section()).toHaveTextContent("No retained close or reopen receipts");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("hides already settled history immediately on selection or revision refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(history())).mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const commits: string[] = [];
    const onCommit = (text: string) => { commits.push(text); };
    const view = render(<CommitTextProbe onCommit={onCommit}><FundingAwardClosureHistory awardId={AWARD} refreshKey="v1" /></CommitTextProbe>);
    showHistory();
    await screen.findByText("Closed on recorded paid coverage (earned_coverage)");
    commits.length = 0;
    view.rerender(<CommitTextProbe onCommit={onCommit}><FundingAwardClosureHistory awardId={OTHER} refreshKey="v2" /></CommitTextProbe>);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((text) => !text.includes(receipt.id))).toBe(true);
    expect(commits[0]).toContain("Loading award transition history");
    expect(section()).not.toHaveTextContent(receipt.id);
    expect(screen.getByRole("status")).toHaveTextContent("Loading award transition history");
  });
});

const award: FundingAwardCloseoutAward = { id: AWARD, title: "Synthetic source award", spendingStatus: "active", currentRevisionId: REVISION };
function panel(value: FundingAwardCloseoutAward = award, canClose = true) {
  return <FundingAwardCloseoutPanel projectName="Synthetic source project" awards={[value]} canClose={canClose} />;
}

describe("existing award-home integration", () => {
  it("offers the reader when write controls are withheld", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(history())));
    render(panel(award, false));
    expect(screen.queryByRole("button", { name: "Close out award" })).not.toBeInTheDocument();
    showHistory();
    await screen.findByText("Closed on recorded paid coverage (earned_coverage)");
  });

  it("keeps a dedicated history failure from blocking ordinary close-out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Unavailable" }, false)));
    render(panel());
    showHistory();
    await screen.findByText(/Award transition history unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Close out award" }));
    expect(screen.getByRole("button", { name: "Confirm close-out" })).toBeEnabled();
    expect(screen.getByText(award.title)).toBeInTheDocument();
  });

  it("refreshes an open history after successful close and reopen through ordinary controls", async () => {
    let receipts: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/closure-history")) return response(history(receipts));
      if (options?.method === "POST" && url.endsWith("/closeout")) {
        receipts = [receipt];
        return response({ status: "closed", closedAt: receipt.created_at });
      }
      if (options?.method === "PATCH" && url.endsWith(AWARD)) {
        receipts = [receipt, reopen];
        return response({ status: "reopened", spendingStatus: "delayed", priorClosureBasis: "earned_coverage" });
      }
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(panel());
    showHistory();
    await screen.findByText(/No retained close or reopen receipts/);
    fireEvent.click(screen.getByRole("button", { name: "Close out award" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));
    await screen.findByText("Closed on recorded paid coverage (earned_coverage)");
    const historyReadsAfterClose = fetchMock.mock.calls.filter(([url]) => url.endsWith("/closure-history")).length;
    expect(historyReadsAfterClose).toBe(2);
    view.rerender(panel({ ...award, spendingStatus: "fully_spent", closedAt: receipt.created_at }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/closure-history"))).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Re-open award" }));
    fireEvent.change(screen.getByLabelText("Status it returns to"), { target: { value: "delayed" } });
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: reopen.basis.note } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm re-open" }));
    await screen.findByText("Reopened (reopen)");
    expect(section()).toHaveTextContent("Selected destination: Delayed");
    expect(section()).toHaveTextContent(receipt.id);
    expect(section()).toHaveTextContent(reopen.id);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/closure-history"))).toHaveLength(4);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });
});
