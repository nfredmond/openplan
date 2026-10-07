import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandUsePlanRuleReconciliationControl } from "@/components/land-use-plans/land-use-plan-rule-reconciliation-control";
import { readRuleReconciliationRecovery, retainRuleReconciliation } from "@/lib/land-use-plans/rule-reconciliation-recovery";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const command = { operation: "reconcile", commandId: id(4), versionId: id(5), expectedDraftRevision: 7, expectedDescriptorHash: "a".repeat(64) };
const pending = { ...scope, schemaVersion: 1 as const, versionNumber: 2, savedAt: "2026-10-07T00:00:00Z", commandText: ` \n${JSON.stringify(command)}\n` };
const props = { ...scope, versionId: id(5), versionNumber: 2, draftRevision: 7, descriptorHash: "a".repeat(64), working: true, canWrite: true, disabled: false,
  missingSections: [{ key: "required", label: "Required text" }], missingDefaults: [{ key: "local", label: "Local text" }], onRefresh: vi.fn<() => Promise<void>>() };
function response(body: string, replayed = false) {
  const value = JSON.parse(body);
  return Response.json({ ...scope, replayed, commandId: value.commandId, versionId: value.versionId,
    previousDraftRevision: value.expectedDraftRevision, draftRevision: value.expectedDraftRevision + 1,
    descriptorHash: value.expectedDescriptorHash, addedSections: [{ id: id(6), requirementKey: "required" }],
    applicableRequirementKeys: ["required", "local"], reconciledAt: "2026-10-07T00:00:00Z" }, { status: replayed ? 200 : 201 });
}
const action = () => screen.getByRole("button", { name: "Add reviewed checklist items" });
const review = () => fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed these section additions/ }));
beforeEach(() => { localStorage.clear(); props.onRefresh.mockReset().mockResolvedValue(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("explicit checklist review and recovery", () => {
  it("requires displayed review, retains before transport and acknowledges the scoped receipt", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const saved = readRuleReconciliationRecovery(localStorage, scope);
      expect(saved).toHaveLength(1); expect(saved[0].pending?.commandText).toBe(init?.body);
      return response(String(init?.body));
    });
    vi.stubGlobal("fetch", transport); render(<LandUsePlanRuleReconciliationControl {...props} />);
    expect(screen.getByText("Required text")).toBeInTheDocument(); expect(screen.getByText("Local text")).toBeInTheDocument();
    expect(action()).toBeDisabled(); fireEvent.click(action()); expect(transport).not.toHaveBeenCalled();
    review(); fireEvent.click(action());
    expect(await screen.findByRole("status")).toHaveTextContent("Checklist change confirmed for draft 2. 1 blank section added");
    expect(transport).toHaveBeenCalledTimes(1); expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(readRuleReconciliationRecovery(localStorage, scope)).toEqual([]); expect(action()).toBeDisabled();
  });
  it.each([{ draftRevision: 8 }, { descriptorHash: "b".repeat(64) }, { versionId: id(9) },
    { missingSections: [{ key: "other", label: "Other section" }] }])("requires a new review when the displayed change changes %j", patch => {
    const view = render(<LandUsePlanRuleReconciliationControl {...props} />); review(); expect(action()).toBeEnabled();
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} {...patch} />); expect(action()).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("does not send on mount, storage events, remount or restored local copy", async () => {
    retainRuleReconciliation(localStorage, pending); const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    const view = render(<LandUsePlanRuleReconciliationControl {...props} />);
    act(() => window.dispatchEvent(new StorageEvent("storage"))); view.unmount(); render(<LandUsePlanRuleReconciliationControl {...props} />);
    expect(action()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve request and review current checklist" }));
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(/Checklist request recovery/));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore checklist request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Restore checklist request" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing has been sent"); expect(transport).not.toHaveBeenCalled();
    expect(readRuleReconciliationRecovery(localStorage, scope).filter(record => !record.archived)).toHaveLength(1);
  });
  it("retries original bytes after a newer working draft or rule set exists", async () => {
    retainRuleReconciliation(localStorage, pending);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(pending.commandText, true)); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanRuleReconciliationControl {...props} versionId={id(8)} draftRevision={30} descriptorHash={"b".repeat(64)} versionNumber={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Check or retry saved checklist change" }));
    expect(await screen.findByRole("status")).toHaveTextContent("confirmed for draft 2");
    expect(transport.mock.calls[0][1]?.body).toBe(pending.commandText); expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
  it.each([{ disabled: true }, { canWrite: false }])("blocks new and retry writes when edits or access block them %j", patch => {
    retainRuleReconciliation(localStorage, pending); const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanRuleReconciliationControl {...props} {...patch} />);
    const retry = screen.getByRole("button", { name: "Check or retry saved checklist change" });
    expect(retry).toBeDisabled(); expect(action()).toBeDisabled(); fireEvent.click(retry); expect(transport).not.toHaveBeenCalled();
  });
  it("defers a confirmed refresh when new unsaved edits arrive during transport", async () => {
    let finish!: (value: Response) => void; let body = "";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, init) => { body = String(init?.body); return new Promise(resolve => { finish = resolve; }); }));
    const view = render(<LandUsePlanRuleReconciliationControl {...props} />); review(); fireEvent.click(action());
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} disabled />);
    await act(async () => finish(response(body)));
    expect(screen.getByRole("status")).toHaveTextContent("confirmed"); expect(screen.getByRole("alert")).toHaveTextContent("Keep your unsaved edits");
    expect(props.onRefresh).not.toHaveBeenCalled(); expect(readRuleReconciliationRecovery(localStorage, scope)).toEqual([]);
    const refresh = screen.getByRole("button", { name: "Refresh current checklist" }); expect(refresh).toBeDisabled();
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} />); fireEvent.click(refresh);
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
  });
  it("keeps an unknown outcome and prevents duplicate clicks", async () => {
    let fail!: (error: Error) => void;
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; })); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanRuleReconciliationControl {...props} />); review(); fireEvent.click(action()); fireEvent.click(action());
    expect(transport).toHaveBeenCalledTimes(1); await act(async () => fail(new Error("Lost reply")));
    expect(screen.getByRole("alert")).toHaveTextContent("Lost reply"); expect(props.onRefresh).not.toHaveBeenCalled();
    expect(readRuleReconciliationRecovery(localStorage, scope)).toHaveLength(1); expect(action()).toBeDisabled();
  });
  it("keeps the old request after an account change during transport", async () => {
    let finish!: (value: Response) => void; let body = ""; let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, init) => { body = String(init?.body); signal = init?.signal; return new Promise(resolve => { finish = resolve; }); }));
    const view = render(<LandUsePlanRuleReconciliationControl {...props} />); review(); fireEvent.click(action());
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} actorId={id(9)} />); expect(signal?.aborted).toBe(true);
    await act(async () => finish(response(body)));
    expect(props.onRefresh).not.toHaveBeenCalled(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(readRuleReconciliationRecovery(localStorage, scope)).toHaveLength(1);
  });
  it("blocks transport when browser retention fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Browser storage full"); });
    const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanRuleReconciliationControl {...props} />); review(); fireEvent.click(action());
    expect(await screen.findByRole("alert")).toHaveTextContent("Browser storage full"); expect(transport).not.toHaveBeenCalled();
  });
  it("keeps confirmation distinct from refresh failure and retries refresh explicitly", async () => {
    props.onRefresh.mockRejectedValue(new Error("refresh unavailable"));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (_url, init) => response(String(init?.body))));
    render(<LandUsePlanRuleReconciliationControl {...props} />); review(); fireEvent.click(action());
    expect(await screen.findByRole("alert")).toHaveTextContent("current plan could not refresh");
    expect(screen.getByRole("status")).toHaveTextContent("confirmed"); expect(action()).toBeDisabled();
    props.onRefresh.mockResolvedValue(); fireEvent.click(screen.getByRole("button", { name: "Refresh current checklist" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
  it("offers no new mutation for a frozen edition or an unchanged checklist", () => {
    const view = render(<LandUsePlanRuleReconciliationControl {...props} working={false} canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Add reviewed checklist items" })).not.toBeInTheDocument();
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} missingSections={[]} missingDefaults={[]} />);
    expect(screen.queryByRole("button", { name: "Add reviewed checklist items" })).not.toBeInTheDocument();
    expect(screen.getByText(/Staff still needs to complete/)).toBeInTheDocument();
  });
  it("blocks sending until saved requests can be read", () => {
    const read = vi.spyOn(Storage.prototype, "key").mockImplementation(() => { throw new Error("Storage unavailable"); });
    localStorage.setItem("unrelated", "value");
    const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanRuleReconciliationControl {...props} />); review();
    expect(action()).toBeDisabled(); expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
    read.mockRestore(); fireEvent.click(screen.getByRole("button", { name: "Read saved checklist requests again" }));
    expect(action()).toBeEnabled(); expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(transport).not.toHaveBeenCalled();
  });
  it("does not preserve or refresh a pending request over unsaved edits", () => {
    retainRuleReconciliation(localStorage, pending);
    render(<LandUsePlanRuleReconciliationControl {...props} disabled />);
    const preserve = screen.getByRole("button", { name: "Preserve request and review current checklist" });
    expect(preserve).toBeDisabled(); fireEvent.click(preserve);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(readRuleReconciliationRecovery(localStorage, scope)).toEqual([expect.objectContaining({ archived: false, pending })]);
  });
  it("clears the previous account's requests even when the new account cannot read storage", () => {
    retainRuleReconciliation(localStorage, pending);
    const view = render(<LandUsePlanRuleReconciliationControl {...props} />);
    expect(screen.getByText("Saved request for draft 2")).toBeInTheDocument();
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => { throw new Error("Storage unavailable"); });
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} actorId={id(9)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
    expect(screen.queryByText("Saved request for draft 2")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download checklist request" })).not.toBeInTheDocument();
    expect(action()).toBeDisabled();
  });
  it("imports a saved request locally and refuses a file from another account", async () => {
    const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
    render(<LandUsePlanRuleReconciliationControl {...props} />);
    const input = screen.getByLabelText("Restore a saved checklist request");
    const file = (value: unknown) => ({ size: 800, text: async () => JSON.stringify(value) });
    fireEvent.change(input, { target: { files: [file({ ...pending, actorId: id(9) })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("current account and plan");
    expect(readRuleReconciliationRecovery(localStorage, scope)).toEqual([]);
    fireEvent.change(input, { target: { files: [file(pending)] } });
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing has been sent");
    expect(readRuleReconciliationRecovery(localStorage, scope)[0].pending).toEqual(pending);
    expect(transport).not.toHaveBeenCalled();
  });
  it("ignores file contents that arrive after the account changes", async () => {
    let finish!: (value: string) => void;
    const view = render(<LandUsePlanRuleReconciliationControl {...props} />);
    fireEvent.change(screen.getByLabelText("Restore a saved checklist request"), { target: { files: [{ size: 800, text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    view.rerender(<LandUsePlanRuleReconciliationControl {...props} actorId={id(9)} />);
    await act(async () => finish(JSON.stringify(pending)));
    expect(readRuleReconciliationRecovery(localStorage, scope)).toEqual([]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
