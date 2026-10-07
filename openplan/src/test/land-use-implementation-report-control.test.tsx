import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandUseImplementationReportControl } from "@/components/land-use-plans/land-use-implementation-report-control";
import { readImplementationReportRecovery, retainImplementationReport } from "@/lib/land-use-plans/implementation-report-recovery";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const command = { operation: "generate", commandId: id(4), versionId: id(5), expectedVersionHash: "a".repeat(64), reportingPeriodStart: "2026-01-01", reportingPeriodEnd: "2026-10-07", title: "SYNTHETIC report", summary: null };
const pending = { ...scope, schemaVersion: 1 as const, versionNumber: 2, savedAt: "2026-10-07T00:00:00Z", commandText: ` \n${JSON.stringify(command)}\n` };
const props = { ...scope, versionId: id(5), versionNumber: 2, contentHash: "a".repeat(64), adopted: true, canWrite: true, disabled: false, onRefresh: vi.fn<() => Promise<void>>() };
function response(body: string, replayed = false) {
  const value = JSON.parse(body);
  return Response.json({ ...scope, replayed, commandId: value.commandId, versionId: value.versionId,
    commandSha256: createHash("sha256").update(body).digest("hex"), adoptedVersionContentHash: value.expectedVersionHash,
    reportId: id(10), artifactId: id(11), implementationReportId: id(12), contentHash: "b".repeat(64),
    reportingPeriodStart: value.reportingPeriodStart, reportingPeriodEnd: value.reportingPeriodEnd, title: value.title, summary: value.summary,
    generatedAt: "2026-10-07T00:00:00Z" }, { status: replayed ? 200 : 201 });
}
function submit() {
  fireEvent.change(screen.getByLabelText("Reporting period start"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("Reporting period end"), { target: { value: "2026-10-07" } });
  fireEvent.change(screen.getByLabelText("Implementation report title"), { target: { value: "SYNTHETIC report" } });
  fireEvent.submit(screen.getByRole("button", { name: "Generate frozen implementation report" }).closest("form")!);
}
beforeEach(() => { localStorage.clear(); props.onRefresh.mockReset().mockResolvedValue(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("implementation report control custody", () => {
  it("retains before transport and acknowledges only a matching response", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const retained = readImplementationReportRecovery(localStorage, scope);
      expect(retained).toHaveLength(1); expect(retained[0].pending?.commandText).toBe(init?.body);
      return response(String(init?.body));
    });
    vi.stubGlobal("fetch", transport); render(<LandUseImplementationReportControl {...props} />);
    submit();
    await screen.findByText("The implementation report for adopted edition 2 is saved. Recorded statuses do not certify that work occurred.");
    expect(props.onRefresh).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1);
    expect(readImplementationReportRecovery(localStorage, scope)).toEqual([]);
  });
  it("does not send on mount, reload, storage events or restored copy", async () => {
    retainImplementationReport(localStorage, pending); const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    const first = render(<LandUseImplementationReportControl {...props} />);
    expect(screen.getByRole("button", { name: "Generate frozen implementation report" })).toBeDisabled();
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    first.unmount(); render(<LandUseImplementationReportControl {...props} adopted={false} />);
    expect(screen.getByRole("button", { name: "Check or retry saved report" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve copy and review current edition" }));
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(/Report request recovery/));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore saved request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Restore saved request" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing has been sent");
    expect(transport).not.toHaveBeenCalled(); expect(readImplementationReportRecovery(localStorage, scope).filter(record => !record.archived)).toHaveLength(1);
  });
  it("retries original bytes while a newer draft exists", async () => {
    retainImplementationReport(localStorage, pending);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(pending.commandText, true)); vi.stubGlobal("fetch", transport);
    render(<LandUseImplementationReportControl {...props} versionId={id(8)} contentHash={"c".repeat(64)} versionNumber={3} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Check or retry saved report" }));
    await screen.findByText("The implementation report for adopted edition 2 is saved. Recorded statuses do not certify that work occurred.");
    expect(transport.mock.calls[0][1]?.body).toBe(pending.commandText); expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
  it("keeps an unknown outcome for explicit retry and prevents duplicate clicks", async () => {
    let fail!: (error: Error) => void;
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; })); vi.stubGlobal("fetch", transport);
    render(<LandUseImplementationReportControl {...props} />); const button = screen.getByRole("button", { name: "Generate frozen implementation report" });
    submit(); submit(); expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error("Lost reply")));
    expect(screen.getByRole("alert")).toHaveTextContent("Lost reply"); expect(props.onRefresh).not.toHaveBeenCalled();
    expect(readImplementationReportRecovery(localStorage, scope)).toHaveLength(1); expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check or retry saved report" })).toBeEnabled();
  });
  it("leaves the old command available after account changes during transport", async () => {
    let finish!: (value: Response) => void; let body = ""; let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, init) => { body = String(init?.body); signal = init?.signal; return new Promise(resolve => { finish = resolve; }); }));
    const view = render(<LandUseImplementationReportControl {...props} />); submit();
    view.rerender(<LandUseImplementationReportControl {...props} actorId={id(9)} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(response(body)));
    expect(props.onRefresh).not.toHaveBeenCalled(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(readImplementationReportRecovery(localStorage, scope)).toHaveLength(1);
  });
  it("blocks requests when retention fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Browser storage full"); });
    const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    render(<LandUseImplementationReportControl {...props} />); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Browser storage full"); expect(transport).not.toHaveBeenCalled();
  });
  it("keeps confirmation distinct from a failed view refresh", async () => {
    props.onRefresh.mockRejectedValue(new Error("refresh unavailable"));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (_url, init) => response(String(init?.body))));
    render(<LandUseImplementationReportControl {...props} />); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("report is confirmed, but the plan view could not refresh");
    expect(screen.getByRole("status")).toHaveTextContent("implementation report for adopted edition 2 is saved");
    expect(screen.getByRole("button", { name: "Generate frozen implementation report" })).toBeDisabled();
    props.onRefresh.mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: "Refresh current plan" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});


it("retains edits made while the original report is being saved", async () => {
  let finish!: (value: Response) => void; let body = "";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, init) => { body = String(init?.body); return new Promise(resolve => { finish = resolve; }); }));
  render(<LandUseImplementationReportControl {...props} />); submit();
  fireEvent.change(screen.getByLabelText("Implementation report title"), { target: { value: "SYNTHETIC later title" } });
  await act(async () => finish(response(body)));
  expect(await screen.findByRole("link", { name: "Open saved implementation report" })).toHaveAttribute("href", `/reports/${id(10)}`);
  expect(screen.getByLabelText("Implementation report title")).toHaveValue("SYNTHETIC later title");
});
it("refuses a synthetic form submission without current writer permission", () => {
  const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
  render(<LandUseImplementationReportControl {...props} canWrite={false} />); submit();
  expect(transport).not.toHaveBeenCalled(); expect(readImplementationReportRecovery(localStorage, scope)).toEqual([]);
});
it("refuses transport if storage access throws", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
  const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
  render(<LandUseImplementationReportControl {...props} />); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("storage unavailable"); expect(transport).not.toHaveBeenCalled();
});


it("serializes repeated retry events before React commits the disabled state", async () => {
  retainImplementationReport(localStorage, pending);
  let fail!: (error: Error) => void;
  const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
  vi.stubGlobal("fetch", transport); render(<LandUseImplementationReportControl {...props} />);
  const button = screen.getByRole("button", { name: "Check or retry saved report" });
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(transport).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("Lost retry reply")));
  expect(screen.getByRole("alert")).toHaveTextContent("Lost retry reply");
  expect(readImplementationReportRecovery(localStorage, scope)[0].pending?.commandText).toBe(pending.commandText);
});
