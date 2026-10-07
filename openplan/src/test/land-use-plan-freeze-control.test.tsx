import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandUsePlanFreezeControl } from "@/components/land-use-plans/land-use-plan-freeze-control";
import { readPlanFreezeRecovery, retainPlanFreeze } from "@/lib/land-use-plans/freeze-recovery";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const command = { state: "public_review", commandId: id(4), versionId: id(5), expectedDraftRevision: 7, expectedDescriptorHash: "a".repeat(64) };
const pending = { ...scope, schemaVersion: 1 as const, versionNumber: 2, savedAt: "2026-10-07T00:00:00Z", commandText: ` \n${JSON.stringify(command)}\n` };
const props = { ...scope, versionId: id(5), versionNumber: 2, draftRevision: 7, descriptorHash: "a".repeat(64), working: true, canWrite: true, disabled: false, onRefresh: vi.fn<() => Promise<void>>() };
function response(body: string, replayed = false) {
  const value = JSON.parse(body);
  return Response.json({ replayed, commandId: value.commandId, versionId: value.versionId, draftRevision: value.expectedDraftRevision,
    contentHash: "b".repeat(64), frozenAt: "2026-10-07T00:00:00Z", reviewEventId: id(6) }, { status: replayed ? 200 : 201 });
}
beforeEach(() => { localStorage.clear(); props.onRefresh.mockReset().mockResolvedValue(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("freeze control custody", () => {
  it("retains before transport and acknowledges only a matching response", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const retained = readPlanFreezeRecovery(localStorage, scope);
      expect(retained).toHaveLength(1); expect(retained[0].pending?.commandText).toBe(init?.body);
      return response(String(init?.body));
    });
    vi.stubGlobal("fetch", transport); render(<LandUsePlanFreezeControl {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze public draft" }));
    await screen.findByText("Draft 2 is frozen. Its saved content can no longer be edited.");
    expect(props.onRefresh).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1);
    expect(readPlanFreezeRecovery(localStorage, scope)).toEqual([]);
  });
  it("does not send on mount, reload, storage events or restored copy", async () => {
    retainPlanFreeze(localStorage, pending); const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    const first = render(<LandUsePlanFreezeControl {...props} />);
    expect(screen.getByRole("button", { name: "Freeze public draft" })).toBeDisabled();
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    first.unmount(); render(<LandUsePlanFreezeControl {...props} working={false} />);
    expect(screen.getByRole("button", { name: "Check or retry saved freeze" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve copy and review current draft" }));
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(/Freeze request recovery/));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore saved request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Restore saved request" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing has been sent");
    expect(transport).not.toHaveBeenCalled(); expect(readPlanFreezeRecovery(localStorage, scope).filter(record => !record.archived)).toHaveLength(1);
  });
  it("retries original bytes while a newer draft exists", async () => {
    retainPlanFreeze(localStorage, pending);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(pending.commandText, true)); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanFreezeControl {...props} versionId={id(8)} draftRevision={30} versionNumber={3} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Check or retry saved freeze" }));
    await screen.findByText("Draft 2 is frozen. Its saved content can no longer be edited.");
    expect(transport.mock.calls[0][1]?.body).toBe(pending.commandText); expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
  it("keeps an unknown outcome for explicit retry and prevents duplicate clicks", async () => {
    let fail!: (error: Error) => void;
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; })); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanFreezeControl {...props} />); const button = screen.getByRole("button", { name: "Freeze public draft" });
    fireEvent.click(button); fireEvent.click(button); expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error("Lost reply")));
    expect(screen.getByRole("alert")).toHaveTextContent("Lost reply"); expect(props.onRefresh).not.toHaveBeenCalled();
    expect(readPlanFreezeRecovery(localStorage, scope)).toHaveLength(1); expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check or retry saved freeze" })).toBeEnabled();
  });
  it("leaves the old command available after account changes during transport", async () => {
    let finish!: (value: Response) => void; let body = ""; let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, init) => { body = String(init?.body); signal = init?.signal; return new Promise(resolve => { finish = resolve; }); }));
    const view = render(<LandUsePlanFreezeControl {...props} />); fireEvent.click(screen.getByRole("button", { name: "Freeze public draft" }));
    view.rerender(<LandUsePlanFreezeControl {...props} actorId={id(9)} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(response(body)));
    expect(props.onRefresh).not.toHaveBeenCalled(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(readPlanFreezeRecovery(localStorage, scope)).toHaveLength(1);
  });
  it("blocks requests when retention fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Browser storage full"); });
    const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanFreezeControl {...props} />); fireEvent.click(screen.getByRole("button", { name: "Freeze public draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Browser storage full"); expect(transport).not.toHaveBeenCalled();
  });
  it("keeps confirmation distinct from a failed view refresh", async () => {
    props.onRefresh.mockRejectedValue(new Error("refresh unavailable"));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (_url, init) => response(String(init?.body))));
    render(<LandUsePlanFreezeControl {...props} />); fireEvent.click(screen.getByRole("button", { name: "Freeze public draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("freeze is confirmed, but the plan view could not refresh");
    expect(screen.getByRole("status")).toHaveTextContent("Draft 2 is frozen");
    expect(screen.getByRole("button", { name: "Freeze public draft" })).toBeDisabled();
    props.onRefresh.mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: "Refresh current plan" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
