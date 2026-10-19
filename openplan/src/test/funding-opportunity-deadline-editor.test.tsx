import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/grants/funding-opportunity-application-workspace", () => ({ FundingOpportunityApplicationWorkspace: () => null }));
vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({ FundingOpportunityDecisionControls: () => null }));
vi.mock("@/components/grants/funding-opportunity-narrative-draft-panel", () => ({ FundingOpportunityNarrativeDraftPanel: () => null }));

import { FundingOpportunityDeadlineEditor } from "@/components/grants/funding-opportunity-deadline-editor";
import { GrantsOpportunityRegistryCard } from "@/components/grants/grants-opportunity-registry-card";
import * as deadlineEdit from "@/lib/grants/deadline-edit";

const props = {
  opportunityId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222",
  closesAt: "2026-10-19T18:23:45.123456Z", decisionDueAt: "2026-10-20T13:15:32.654321Z",
};
const closing = "Application closing deadline";
const decision = "Pursue-or-skip decision deadline";
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const saved = (values = props) => ({ id: values.opportunityId, workspace_id: values.workspaceId, closes_at: values.closesAt, decision_due_at: values.decisionDueAt });
let membership = { workspaceId: props.workspaceId, role: "member" };
let patchReply: ReturnType<typeof response> | null;
async function defaultTransport(_url: string, init?: RequestInit) {
  if (init?.method !== "PATCH") return response(membership);
  if (patchReply) return patchReply;
  const patch = JSON.parse(String(init.body)) as { closesAt?: string | null; decisionDueAt?: string | null };
  return response({ opportunity: { ...saved(),
    ...(patch.closesAt !== undefined ? { closes_at: patch.closesAt } : {}),
    ...(patch.decisionDueAt !== undefined ? { decision_due_at: patch.decisionDueAt } : {}),
  } });
}
const transport = vi.fn(defaultTransport);
const patches = () => transport.mock.calls.filter(([, init]) => init?.method === "PATCH");

async function open(writable = true) {
  fireEvent.click(screen.getByText("Edit recorded dates"));
  if (writable) await waitFor(() => expect(screen.getByLabelText(closing)).toBeEnabled());
}

beforeEach(() => {
  membership = { workspaceId: props.workspaceId, role: "member" }; patchReply = null;
  refresh.mockReset(); transport.mockReset(); transport.mockImplementation(defaultTransport); vi.stubGlobal("fetch", transport);
  vi.spyOn(deadlineEdit, "browserDeadlineTimeZone").mockReturnValue("Asia/Kolkata");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("normal-user recorded deadline editor", () => {
  it("opens lazily with explicit browser zone/current instants and sends only the changed field", async () => {
    render(<FundingOpportunityDeadlineEditor {...props} />);
    expect(transport).not.toHaveBeenCalled();
    await open();
    expect(screen.getByText(/Browser time zone:/).textContent).toContain("Asia/Kolkata");
    expect(screen.getByText(props.closesAt)).toBeTruthy();
    expect(screen.getByText(props.decisionDueAt)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(closing), { target: { value: "2026-10-21T11:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText("Recorded dates saved.");
    expect(patches()).toHaveLength(1);
    expect(patches()[0][0]).toBe(`/api/funding-opportunities/${props.opportunityId}`);
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ closesAt: "2026-10-21T06:15:00.000Z" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears only the selected date and preserves the untouched microsecond timestamp", async () => {
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText("Recorded dates saved.");
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ decisionDueAt: null });
  });

  it("does not write unchanged minute displays, including an edit returned to its original value", async () => {
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    const input = screen.getByLabelText(closing) as HTMLInputElement;
    const initial = input.value;
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "2026-10-21T11:45" } });
    fireEvent.change(input, { target: { value: initial } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(patches()).toEqual([]); expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels without writing and reopens the recorded values", async () => {
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    const original = (screen.getByLabelText(closing) as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText(closing), { target: { value: "2026-10-21T11:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(closing)).toBeNull(); await open();
    expect((screen.getByLabelText(closing) as HTMLInputElement).value).toBe(original);
    expect(patches()).toEqual([]); expect(refresh).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])("retains entries and exposes a failed save (%s) without success or refresh", async (status) => {
    patchReply = response({ error: "Synthetic save refusal" }, status);
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(closing), { target: { value: "2026-10-21T11:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Synthetic save refusal");
    expect((screen.getByLabelText(closing) as HTMLInputElement).value).toBe("2026-10-21T11:45");
    expect(screen.queryByText("Recorded dates saved.")).toBeNull(); expect(refresh).not.toHaveBeenCalled();
  });

  it("uses the existing role source and refuses a viewer or mismatched workspace", async () => {
    membership.role = "viewer";
    const view = render(<FundingOpportunityDeadlineEditor {...props} />); await open(false);
    await screen.findByText("Your current access does not allow date changes.");
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
    expect(transport).toHaveBeenCalledWith("/api/workspaces/current", { cache: "no-store" });
    view.unmount(); membership = { ...membership, workspaceId: "foreign-workspace", role: "owner" };
    render(<FundingOpportunityDeadlineEditor {...props} />); await open(false);
    expect((await screen.findByRole("alert")).textContent).toContain("different workspace");
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled(); expect(patches()).toEqual([]);
  });

  it("treats a failed permission read as unavailable, with no writable empty-date fallback", async () => {
    transport.mockImplementationOnce(async () => response({ error: "Synthetic permission read failure" }, 500));
    render(<FundingOpportunityDeadlineEditor {...props} />); await open(false);
    expect((await screen.findByRole("alert")).textContent).toContain("Synthetic permission read failure");
    expect(screen.getByText(props.closesAt)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled(); expect(patches()).toEqual([]);
  });

  it("retains an unconfirmed draft after a transport failure", async () => {
    transport.mockImplementationOnce(async () => response(membership)).mockImplementationOnce(async () => { throw new Error("Synthetic reply lost"); });
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Synthetic reply lost");
    expect((screen.getByLabelText(decision) as HTMLInputElement).value).toBe("");
    expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByText("Recorded dates saved.")).toBeNull();
  });

  it("does not turn a partial invalid browser input into a clear operation", async () => {
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    const input = screen.getByLabelText(closing);
    Object.defineProperty(input, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Complete the local date and time");
    expect(patches()).toEqual([]); expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses to reinterpret a draft after the browser time zone changes", async () => {
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(closing), { target: { value: "2026-10-21T11:45" } });
    vi.mocked(deadlineEdit.browserDeadlineTimeZone).mockReturnValue("UTC");
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("browser time zone changed");
    expect(patches()).toEqual([]); expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps a missing browser zone explicit and never substitutes UTC", async () => {
    vi.mocked(deadlineEdit.browserDeadlineTimeZone).mockReturnValue(null);
    render(<FundingOpportunityDeadlineEditor {...props} />); await open(false);
    expect((await screen.findByRole("alert")).textContent).toContain("browser time zone could not be read");
    expect(screen.getByText(props.closesAt)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled(); expect(transport).not.toHaveBeenCalled();
  });

  it("does not accept a successful response for another opportunity", async () => {
    patchReply = response({ opportunity: { ...saved(), id: "foreign-opportunity" } });
    render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not be confirmed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("starts from refreshed current dates even when the opportunity id stays the same", async () => {
    const view = render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(closing), { target: { value: "2026-10-21T11:45" } });
    const next = { ...props, closesAt: "2026-10-23T00:00:11.111111Z" };
    view.rerender(<FundingOpportunityDeadlineEditor {...next} />);
    expect(screen.queryByLabelText(closing)).toBeNull(); expect(patches()).toEqual([]);
    await open();
    expect((screen.getByLabelText(closing) as HTMLInputElement).value).toBe("2026-10-23T05:30");
    patchReply = response({ opportunity: { ...saved(next), decision_due_at: null } });
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText("Recorded dates saved.");
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ decisionDueAt: null });
  });

  it("drops a stale editing session when current props change, including an in-flight old reply", async () => {
    let finish: ((reply: ReturnType<typeof response>) => void) | undefined;
    transport.mockImplementationOnce(async () => response(membership)).mockImplementationOnce(() => new Promise<ReturnType<typeof response>>((resolve) => { finish = resolve; }));
    const view = render(<FundingOpportunityDeadlineEditor {...props} />); await open();
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    const next = { ...props, opportunityId: "33333333-3333-4333-8333-333333333333", closesAt: "2026-10-22T12:00:11.111111Z" };
    view.rerender(<FundingOpportunityDeadlineEditor {...next} />);
    await act(async () => { finish?.(response({ opportunity: saved() })); });
    expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByLabelText(closing)).toBeNull();
    await open(); expect(screen.getByText(next.closesAt)).toBeTruthy();
    patchReply = response({ opportunity: saved(next) });
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText("Recorded dates saved.");
    expect(patches().map(([url]) => url)).toEqual([`/api/funding-opportunities/${props.opportunityId}`, `/api/funding-opportunities/${next.opportunityId}`]);
    expect(JSON.parse(String(patches()[1][1]?.body))).toEqual({ decisionDueAt: null });
  });

  it("binds the real registry card to its own opportunity, workspace and exact dates", async () => {
    render(<GrantsOpportunityRegistryCard opportunity={{
      id: props.opportunityId, workspace_id: props.workspaceId, title: "Synthetic opportunity", program_id: null, project_id: null,
      opportunity_status: "open", decision_state: "monitor", agency_name: null, owner_label: null, cadence_label: null,
      expected_award_amount: null, opens_at: null, closes_at: props.closesAt, decision_due_at: props.decisionDueAt,
      fit_notes: null, readiness_notes: null, decision_rationale: null, decided_at: null, summary: null,
      created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z", programs: null, projects: null, program: null, project: null,
    }} activeFocusedOpportunityId={null} projectGrantModelingEvidence={null} />);
    await open(); expect(screen.getByText(props.closesAt)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(decision), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" })); await screen.findByText("Recorded dates saved.");
    expect(patches()[0][0]).toBe(`/api/funding-opportunities/${props.opportunityId}`);
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ decisionDueAt: null });
  });
});
