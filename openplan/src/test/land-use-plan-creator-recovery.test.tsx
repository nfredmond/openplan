import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandUsePlanCreator } from "@/components/land-use-plans/land-use-plan-creator";
import { readCreationRecords, saveCreationDraft } from "@/lib/land-use-plans/create-recovery";
import { SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { creationDraftFixture, creationId, creationReceiptFixture, creationScope } from "./fixtures/land-use-plans/creation";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => <div data-testid="study-picker" /> }));
const hashes = Object.fromEntries(SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.map(item => [item.id, hashFrozenRecord(item)]));
const props = { ...creationScope, canWrite: true, descriptorHashes: hashes };
const transport = vi.fn<typeof fetch>();
function reply(body: RequestInit["body"], replayed = false) {
  const command = JSON.parse(String(body));
  return new Response(JSON.stringify({ ...creationReceiptFixture(), commandId: command.commandId, replayed }), { status: replayed ? 200 : 201 });
}
async function restore() {
  fireEvent.click(await screen.findByRole("button", { name: "Restore draft to a new copy" }));
  expect(screen.getByLabelText("Plan title")).toHaveValue("SYNTHETIC plan");
  fireEvent.click(screen.getByLabelText(/I reviewed the plan area/));
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.stubGlobal("fetch", transport); transport.mockImplementation(async (_url, init) => reply(init?.body)); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("mounted creation recovery", () => {
  it("opens without sending, preserves the original draft and requires explicit review", async () => {
    const saved = saveCreationDraft(localStorage, creationDraftFixture(), null); render(<LandUsePlanCreator {...props} />);
    expect(await screen.findByLabelText("Plan title")).toHaveValue(""); expect(transport).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create plan and first working version" })).toBeDisabled();
    await restore(); expect(localStorage.getItem(saved.key)).toBe(saved.raw);
    expect(screen.getByRole("button", { name: "Create plan and first working version" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Plan title"), { target: { value: "Changed title" } });
    expect(screen.getByLabelText(/I reviewed the plan area/)).not.toBeChecked(); expect(transport).not.toHaveBeenCalled();
  });
  it("retains before transport and prevents a second creation after confirmation", async () => {
    saveCreationDraft(localStorage, creationDraftFixture(), null); render(<LandUsePlanCreator {...props} />); await restore();
    transport.mockImplementation(async (_url, init) => {
      expect(readCreationRecords(localStorage, creationScope).filter(record => record.value?.kind === "pending")).toHaveLength(1);
      return reply(init?.body);
    });
    fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/land-use-plans/${creationId(5)}`));
    expect(readCreationRecords(localStorage, creationScope).filter(record => record.value?.kind === "confirmed")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create plan and first working version" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" })); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost reply after remount only through an explicit exact retry", async () => {
    saveCreationDraft(localStorage, creationDraftFixture(), null); const first = render(<LandUsePlanCreator {...props} />); await restore();
    transport.mockRejectedValueOnce(new Error("Lost reply")); fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" }));
    await screen.findByText("Lost reply"); const sent = transport.mock.calls[0][1]?.body; first.unmount();
    render(<LandUsePlanCreator {...props} />); const retry = await screen.findByRole("button", { name: "Retry this exact creation request" });
    expect(transport).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Create plan and first working version" })).toBeDisabled();
    transport.mockImplementation(async (_url, init) => reply(init?.body, true)); fireEvent.click(retry);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1)); expect(transport.mock.calls[1][1]?.body).toBe(sent);
  });
  it("preserves an earlier scope's pending copy when its response arrives after an account change", async () => {
    saveCreationDraft(localStorage, creationDraftFixture(), null); const view = render(<LandUsePlanCreator {...props} />); await restore();
    let complete!: (value: Response) => void; transport.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    view.rerender(<LandUsePlanCreator {...props} actorId={creationId(9)} />);
    await act(async () => complete(reply(transport.mock.calls[0][1]?.body)));
    expect(router.push).not.toHaveBeenCalled(); expect(readCreationRecords(localStorage, creationScope).some(record => record.value?.kind === "pending")).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry this exact creation request" })).toBeNull();
  });
  it("sends nothing when request storage fails", async () => {
    saveCreationDraft(localStorage, creationDraftFixture(), null); render(<LandUsePlanCreator {...props} />); await restore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" }));
    await screen.findByText("Storage unavailable"); expect(transport).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  });
  it("keeps unreadable copies visible and blocks another creation", async () => {
    localStorage.setItem(`openplan:plan-creation:${creationScope.actorId}:${creationScope.workspaceId}:command:${creationId(3)}`, "broken");
    render(<LandUsePlanCreator {...props} />);
    expect(await screen.findByText(/Unreadable saved copy/)).toBeVisible(); expect(screen.getByRole("button", { name: "Create plan and first working version" })).toBeDisabled(); expect(transport).not.toHaveBeenCalled();
  });
  it("requires explicit current-rule review for a restored draft and keeps its old copy", async () => {
    const draft = creationDraftFixture(); draft.fields.descriptorHash = "b".repeat(64); const saved = saveCreationDraft(localStorage, draft, null);
    render(<LandUsePlanCreator {...props} />); await restore();
    fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" }));
    await screen.findByText(/The checklist changed/); expect(transport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use reviewed current rules for this draft" }));
    expect(screen.getByLabelText(/I reviewed the plan area/)).not.toBeChecked(); expect(localStorage.getItem(saved.key)).toBe(saved.raw);
  });
  it("stops an uncertain creation before allowing its draft to become a new reviewed request", async () => {
    saveCreationDraft(localStorage, creationDraftFixture(), null); render(<LandUsePlanCreator {...props} />); await restore();
    transport.mockRejectedValueOnce(new Error("Lost reply")); fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" })); await screen.findByText("Lost reply");
    transport.mockImplementation(async (url, init) => {
      expect(String(url)).toContain("/stop"); const raw = String(init?.body), command = JSON.parse(raw);
      return new Response(JSON.stringify({ outcome: "cancelled", replayed: false, ...creationScope, commandId: command.commandId, commandText: raw, cancelledAt: "2026-10-07T14:00:00Z" }), { status: 200 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop this creation request" }));
    await screen.findByText(/Request stopped. It cannot create a plan/); expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review stopped draft in a new copy" }));
    expect(screen.getByLabelText("Plan title")).toHaveValue("SYNTHETIC plan"); expect(screen.getByLabelText(/I reviewed the plan area/)).not.toBeChecked();
    expect(transport).toHaveBeenCalledTimes(2); expect(readCreationRecords(localStorage, creationScope).some(record => record.value?.kind === "cancelled")).toBe(true);
  });
  it("retains a lost stop across reload and opens a plan if creation won the race", async () => {
    saveCreationDraft(localStorage, creationDraftFixture(), null); const view = render(<LandUsePlanCreator {...props} />); await restore();
    transport.mockRejectedValueOnce(new Error("Lost reply")); fireEvent.click(screen.getByRole("button", { name: "Create plan and first working version" })); await screen.findByText("Lost reply");
    transport.mockRejectedValueOnce(new Error("Stop reply lost")); fireEvent.click(screen.getByRole("button", { name: "Stop this creation request" })); await screen.findByText("Stop reply lost");
    const raw = String(transport.mock.calls[1][1]?.body); view.unmount(); render(<LandUsePlanCreator {...props} />);
    const retry = await screen.findByRole("button", { name: "Retry stopping this request" });
    expect(screen.queryByRole("button", { name: "Retry this exact creation request" })).toBeNull(); expect(transport).toHaveBeenCalledTimes(2);
    transport.mockResolvedValue(new Response(JSON.stringify({ outcome: "created", result: { ...creationReceiptFixture(), commandId: JSON.parse(raw).commandId, replayed: true } }), { status: 200 }));
    fireEvent.click(retry); await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/land-use-plans/${creationId(5)}`));
    expect(transport.mock.calls[2][1]?.body).toBe(raw); expect(screen.queryByText(/Request stopped. It cannot create a plan/)).toBeNull();
  });
});
