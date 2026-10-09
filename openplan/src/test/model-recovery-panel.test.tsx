import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModelRecoveryPanel } from "@/components/models/model-recovery-panel";
import { readRecoveryDecisions } from "@/lib/models/pending-recovery-decision";
import type { RecoveryDecision } from "@/lib/models/recovery-decision";
const [userId, workspaceId, modelId, runId, stageId] = Array.from({ length: 5 }, (_, i) => `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
const scope = { userId, workspaceId, modelId, runId };
const state = { workspace_id: workspaceId, model_id: modelId, run_id: runId, status: "running", updated_at: "2026-10-08T19:00:00Z", attempt_managed: true, stages: [{ id: stageId, status: "running", updated_at: "2026-10-08T19:00:00Z", attempt_managed: true, active_attempt_id: null }] };
const inspection = { expected_state: state, process_termination_verified: false, continuation_authorized: false, model_resumed: false };
const receipt = (body: RecoveryDecision) => ({ request_id: body.requestId, workspace_id: workspaceId, run_id: runId, actor_id: userId, outcome: "execution_abandoned", run_status: "cancelled", process_termination_verified: false, continuation_authorized: false, model_resumed: false, reported_evidence_verified: false, request_payload: { workspace_id: workspaceId, run_id: runId, actor_id: userId, expected_state: body.expectedState, reason: body.reason, reported_evidence: body.evidence } });
const open = () => { screen.getByTestId("model-recovery-panel").setAttribute("open", ""); };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires review and consequence acknowledgement, then recovers the saved request after remount", async () => {
 const bodies: RecoveryDecision[] = []; const onConfirmed = vi.fn();
 vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
  if (options?.method !== "POST") return Response.json(inspection);
  const body: RecoveryDecision = JSON.parse(options.body); bodies.push(body);
  if (bodies.length === 1) throw new Error("Lost reply");
  return Response.json(receipt(body));
 }));
 render(<ModelRecoveryPanel {...scope} permission="allowed" onConfirmed={onConfirmed} />); open();
 fireEvent.click(screen.getByText("Review current execution state"));
 const input = await screen.findByLabelText("Reason for abandoning this execution");
 fireEvent.change(input, { target: { value: "Synthetic reviewed interruption" } });
 expect(screen.getByText("Save abandonment decision")).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByText("Save abandonment decision"));
 await waitFor(() => expect(bodies).toHaveLength(1));
 await screen.findByText(/The decision is unconfirmed/);
 cleanup(); render(<ModelRecoveryPanel {...scope} permission="allowed" onConfirmed={onConfirmed} />); open();
 fireEvent.click(await screen.findByText("Retry saved decision"));
 await screen.findByText("Decision receipt retained"); expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]); expect(onConfirmed).toHaveBeenCalledTimes(1);
 const copies = readRecoveryDecisions(localStorage, scope); expect(copies.records[0].receipt).toEqual(receipt(bodies[0]));
 const create = vi.fn((_blob: Blob) => "blob:synthetic-recovery"); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
 vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
 fireEvent.click(screen.getByText("Download decision and receipt"));
 const blob = create.mock.calls[0][0] as Blob;
 const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
 expect(JSON.parse(text)).toEqual(copies.records[0]);
});
it("sends nothing when the browser cannot retain the new decision", async () => {
 const transport = vi.fn(async () => Response.json(inspection)); vi.stubGlobal("fetch", transport);
 render(<ModelRecoveryPanel {...scope} permission="allowed" />); open(); fireEvent.click(screen.getByText("Review current execution state"));
 fireEvent.change(await screen.findByLabelText("Reason for abandoning this execution"), { target: { value: "Synthetic reason" } }); fireEvent.click(screen.getByRole("checkbox"));
 vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic storage unavailable"); });
 fireEvent.click(screen.getByText("Save abandonment decision")); await screen.findByText("Synthetic storage unavailable");
 expect(transport).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0);
});
it("withholds controls from a member", () => {
 const transport = vi.fn(); vi.stubGlobal("fetch", transport); render(<ModelRecoveryPanel {...scope} permission="denied" />); open();
 expect(screen.getByText("Review current execution state")).toBeDisabled(); expect(transport).not.toHaveBeenCalled();
});
it("discards the visible review when account props change", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => Response.json(inspection)));
 const view = render(<ModelRecoveryPanel {...scope} permission="allowed" />); open(); fireEvent.click(screen.getByText("Review current execution state"));
 await screen.findByLabelText("Reason for abandoning this execution");
 view.rerender(<ModelRecoveryPanel {...scope} userId={stageId} permission="allowed" />);
 expect(screen.queryByLabelText("Reason for abandoning this execution")).not.toBeInTheDocument();
});
