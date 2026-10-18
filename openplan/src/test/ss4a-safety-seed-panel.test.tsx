/** DOM fixtures do not establish real navigation, responsive layout, artifact usability or a browser console. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyPlanSeedPanel } from "@/components/grants/safety-plan-seed-panel";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { buildSafetySeedPreview } from "@/lib/grants/ss4a-safety-seed";
import { safetySeedFixture } from "./fixtures/grants/safety-seed";

const rows = safetySeedFixture(); const preview = buildSafetySeedPreview(rows);
const artifacts = [{ id: rows.artifact.id, reportTitle: "Example Safety report", artifactKind: "html", generatedAt: rows.artifact.generated_at }];
const fetchMock = vi.fn();
const sourcesMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset(); sourcesMock.mockReset().mockResolvedValue(response({ artifacts, nextCursor: null, requiresProject: false }));
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => init?.method === "POST" ? fetchMock(url, init) : sourcesMock(url, init));
});
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

describe("explicit Safety artifact preview and apply UI", () => {
  it("requires selection and review, sends only the bound preview, and refreshes after apply", async () => {
    fetchMock.mockResolvedValueOnce(response({ preview })).mockResolvedValueOnce(response({ applied: true }));
    const onApplied = vi.fn().mockResolvedValue(undefined);
    render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} onApplied={onApplied} />);
    expect(screen.getByText(SAFETY_SEED_CAVEAT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview Safety seed" })).toBeDisabled();
    await screen.findByRole("option", { name: /Example Safety report/ });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: rows.artifact.id } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview Safety seed" }));
    await screen.findByRole("button", { name: "Apply six working drafts" });
    expect(screen.getAllByRole("group")).toHaveLength(6);
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply six working drafts" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain(`/funding-opportunities/${rows.opportunity.id}/application/safety-seed`);
    expect(JSON.parse(init.body)).toEqual({ operation: "apply", artifactId: rows.artifact.id, previewHash: preview.previewHash });
    expect(screen.getByRole("status")).toHaveTextContent("Final text, prior drafts and attachments are retained");
  });
  it("clears stale previews but keeps the exact request available after a lost response", async () => {
    const onApplied = vi.fn();
    fetchMock.mockResolvedValueOnce(response({ preview })).mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(response({ error: "Preview stale" }, 409));
    render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} onApplied={onApplied} />);
    await screen.findByRole("option", { name: /Example Safety report/ });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: rows.artifact.id } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Safety seed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply six working drafts" }));
    await screen.findByText("Lost response");
    expect(screen.getByRole("button", { name: "Apply six working drafts" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply six working drafts" }));
    await screen.findByText("Preview stale");
    expect(screen.queryByRole("button", { name: "Apply six working drafts" })).toBeNull();
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect(onApplied).not.toHaveBeenCalled();
  });
  it("pages the dedicated project source and keeps existing choices without auto preview", async () => {
    sourcesMock.mockResolvedValueOnce(response({ artifacts, nextCursor: rows.artifact.id, requiresProject: false }))
      .mockResolvedValueOnce(response({ artifacts: [{ ...artifacts[0], id: rows.report.id, reportTitle: "Older Safety report" }], nextCursor: null, requiresProject: false }));
    render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} onApplied={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more Safety reports" }));
    await screen.findByRole("option", { name: /Older Safety report/ });
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(sourcesMock.mock.calls[0][0]).toBe(`/api/funding-opportunities/${rows.opportunity.id}/application/safety-seed`);
    expect(sourcesMock.mock.calls[1][0]).toBe(`/api/funding-opportunities/${rows.opportunity.id}/application/safety-seed?before=${rows.artifact.id}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows loading, source failure and empty project as different states", async () => {
    let release!: (value: unknown) => void;
    sourcesMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} onApplied={vi.fn()} />);
    expect(screen.getByText("Loading linked-project Safety reports.")).toBeTruthy();
    expect(screen.queryByText(/No Safety reports/)).toBeNull();
    release(response({ error: "Sources unavailable" }, 500));
    await screen.findByText("Sources unavailable");
    expect(screen.queryByText(/No Safety reports/)).toBeNull();
    sourcesMock.mockResolvedValueOnce(response({ artifacts: [], nextCursor: null, requiresProject: true }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Safety sources" }));
    await screen.findByText("Link this opportunity to the Safety report project first.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses malformed source responses and aborts its pending source read on unmount", async () => {
    sourcesMock.mockResolvedValueOnce(response({ artifacts: [{ id: "bad" }], nextCursor: null, requiresProject: false }));
    const view = render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} onApplied={vi.fn()} />);
    await screen.findByText("Safety source response is unavailable");
    expect(screen.queryByText(/No Safety reports/)).toBeNull();
    sourcesMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Safety sources" }));
    const signal = sourcesMock.mock.calls.at(-1)![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false); view.unmount(); expect(signal.aborted).toBe(true);
  });
});
