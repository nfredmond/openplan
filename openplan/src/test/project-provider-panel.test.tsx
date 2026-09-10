import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProviderPanel } from "@/components/assistant/project-provider-panel";

const workspaceId = "22222222-2222-4222-8222-222222222222", projectId = "33333333-3333-4333-8333-333333333333", connectionId = "11111111-1111-4111-8111-111111111111", turnId = "44444444-4444-4444-8444-444444444444", requestId = "55555555-5555-4555-8555-555555555555";
const connection = { id: connectionId, workspace_id: workspaceId, project_id: projectId, device_label: "Synthetic computer", expected_auth_mode: "chatgpt", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, last_status: "connected" };
const proposal = { status: "proposed", kind: "create_project_record", approval: "approval_required", description: "Create a draft submittal.", payload: { kind: "create_project_record", recordType: "submittal", projectId, title: "Synthetic draft", submittalType: "other", notes: "Synthetic original notes." } };
const savedTurn = () => ({ id: turnId, request_id: requestId, workspace_id: workspaceId, project_id: projectId, provider: "codex", model_id: "fixture-model", auth_mode: "chatgpt", question: "Draft a submittal", packet_hash: "a".repeat(64), state: "succeeded", failure_code: null, created_at: "2026-09-10T00:00:00Z",
  result: { answer: "The cost is not supplied.", citations: [{ id: `project:${projectId}`, label: "Synthetic project", href: `/projects/${projectId}` }], proposal } });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
let connectionRows: unknown[], turnRows: unknown[], writes: Array<{ url: string; body: Record<string, unknown> }>;
let writeHandler: (url: string, body: Record<string, unknown>, method: string) => Promise<Response>;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); connectionRows = [connection]; turnRows = []; writes = [];
  writeHandler = async (_url, body, method) => {
    if (method === "DELETE") return response({ cancelled: true, state: "cancelled", turnId: body.turnId });
    const turn = { ...savedTurn(), request_id: body.requestId, question: body.question, provider: body.provider, model_id: body.model, auth_mode: body.authMode, state: "queued", result: null };
    turnRows = [turn]; return response({ created: true, turn }, 201);
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return url.startsWith("/api/assistant/providers/connections") ? response({ connections: connectionRows }) : response({ turns: turnRows });
    const body = JSON.parse(String(init?.body)); writes.push({ url, body }); return writeHandler(url, body, method);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function openPanel(props: Partial<Parameters<typeof ProjectProviderPanel>[0]> = {}) {
  const review = vi.fn(); const view = render(<ProjectProviderPanel workspaceId={workspaceId} projectId={projectId} busy={false} onReview={review} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Project task · choose provider" }));
  await screen.findByRole("option", { name: "Synthetic computer · connected" });
  return { ...view, review };
}
async function fillNative() {
  fireEvent.change(screen.getByLabelText("Project connection"), { target: { value: connectionId } });
  fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "fixture-model" } });
  fireEvent.change(screen.getByLabelText("Project question"), { target: { value: "Draft a submittal" } });
}

describe("project provider controls", () => {
  it("opens from the project panel and reads only that project's personal connections and saved turns", async () => {
    await openPanel();
    expect(fetchMock).toHaveBeenCalledWith(`/api/assistant/providers/connections?workspaceId=${workspaceId}&projectId=${projectId}`, expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/assistant/providers/turns?workspaceId=${workspaceId}&projectId=${projectId}`, expect.any(Object));
    expect(writes).toEqual([]); expect(screen.getByText(/Only that project record and your question/)).toBeInTheDocument();
  });
  it("sends a selected native model and project question with Enter", async () => {
    await openPanel(); await fillNative();
    fireEvent.keyDown(screen.getByLabelText("Project question"), { key: "Enter" });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: "/api/assistant/providers/turns", body: { workspaceId, projectId, connectionId, provider: "codex", authMode: "chatgpt", model: "fixture-model", question: "Draft a submittal" } });
    expect(writes[0].body.requestId).toMatch(/^[a-f0-9-]{36}$/); expect(writes[0].body).not.toHaveProperty("packet");
    await screen.findByText("Status: queued");
  });
  it("keeps Shift+Enter and IME composition from sending a request", async () => {
    await openPanel(); await fillNative();
    fireEvent.keyDown(screen.getByLabelText("Project question"), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(screen.getByLabelText("Project question"), { key: "Enter", isComposing: true });
    expect(writes).toEqual([]);
  });
  it("requires API charge consent before direct API submission", async () => {
    await openPanel(); fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "anthropic" } });
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "fixture-api-model" } });
    fireEvent.change(screen.getByLabelText("Project question"), { target: { value: "Draft a submittal" } });
    expect(screen.getByRole("button", { name: "Send project request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I authorize this request/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send project request" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ provider: "anthropic", connectionId: null, authMode: "workspace_api_key", acceptApiCharges: true });
  });
  it("requires and transmits charge consent for native API-key billing too", async () => {
    connectionRows = [{ ...connection, expected_auth_mode: "apiKey" }]; await openPanel(); await fillNative();
    expect(screen.getByRole("button", { name: "Send project request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I authorize this request/ })); fireEvent.click(screen.getByRole("button", { name: "Send project request" }));
    await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].body).toMatchObject({ provider: "codex", authMode: "apiKey", acceptApiCharges: true });
  });
  it("retries an interrupted response with the identical request identity and payload", async () => {
    const normal = writeHandler; let tries = 0;
    writeHandler = async (...args) => { if (++tries === 1) throw new Error("Synthetic response interrupted"); return normal(...args); };
    await openPanel(); await fillNative(); fireEvent.click(screen.getByRole("button", { name: "Send project request" }));
    await screen.findByRole("button", { name: "Retry same request" });
    expect(screen.getByLabelText("Model ID")).toBeDisabled(); expect(screen.getByLabelText("Project question")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1]).toEqual(writes[0]); await screen.findByText("Status: queued");
  });
  it("recovers a response already saved by the server without repeating the POST", async () => {
    writeHandler = async (_url, body) => { turnRows = [{ ...savedTurn(), request_id: body.requestId }]; throw new Error("Synthetic lost response"); };
    await openPanel(); await fillNative(); fireEvent.click(screen.getByRole("button", { name: "Send project request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check saved request" }));
    await screen.findByText("The original request was recovered without another generation."); expect(writes).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Retry same request" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes(`requestId=${writes[0].body.requestId}`))).toBe(true);
  });
  it("preserves confirmed save wording when only the subsequent history refresh fails", async () => {
    const normal = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) => writes.length > 0 && !init?.method ? Promise.reject(new Error("Synthetic refresh failure")) : normal(url, init));
    await openPanel(); await fillNative(); fireEvent.click(screen.getByRole("button", { name: "Send project request" }));
    await screen.findByText(/The request was saved, but its history could not be refreshed/);
    expect(screen.queryByRole("button", { name: "Retry same request" })).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
    expect(screen.getByText(/Request saved. Its original packet and result/)).toBeInTheDocument();
  });
  it("reads a retained answer after remount and hands only its draft to the existing review flow", async () => {
    turnRows = [savedTurn()]; const first = await openPanel();
    await screen.findByText("The cost is not supplied."); first.unmount(); const second = await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Review draft submittal in conversation" }));
    expect(second.review).toHaveBeenCalledWith({ id: turnId, question: "Draft a submittal", answer: "The cost is not supplied.", proposal });
    expect(writes).toEqual([]); expect(screen.getByRole("button", { name: "Project task · choose provider" })).toHaveAttribute("aria-expanded", "false");
  });
  it.each([
    { project_id: connectionId, result: { ...savedTurn().result, answer: "PRIVATE_OTHER_PROJECT" } },
    { result: { ...savedTurn().result, answer: "PRIVATE_OTHER_PROJECT", citations: [{ id: `project:${connectionId}`, label: "Other", href: `/projects/${connectionId}` }] } },
    { result: { ...savedTurn().result, answer: "PRIVATE_OTHER_PROJECT", proposal: { ...proposal, payload: { ...proposal.payload, projectId: connectionId } } } },
  ])("refuses a saved result outside the selected project", async change => {
    turnRows = [{ ...savedTurn(), ...change }];
    render(<ProjectProviderPanel workspaceId={workspaceId} projectId={projectId} busy={false} onReview={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Project task · choose provider" })); await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE_OTHER_PROJECT")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Review draft submittal in conversation" })).not.toBeInTheDocument();
  });
  it("cancels the selected retained request without starting another", async () => {
    turnRows = [{ ...savedTurn(), state: "running", result: null }]; await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(writes).toEqual([{ url: "/api/assistant/providers/turns", body: { turnId } }]));
  });
  it.each(["cancelled", "succeeded"])("can cancel while the original response is held and reports the actual %s state", async finalState => {
    const originalFetch = fetchMock.getMockImplementation()!;
    let release: (() => void) | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)); writes.push({ url, body });
        turnRows = [{ ...savedTurn(), request_id: body.requestId, state: "running", result: null }];
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Cancellation did not end the held response")), 8000);
          release = () => { clearTimeout(timer); resolve(response({ turn: turnRows[0] })); };
          init.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
        });
      }
      if (init?.method === "DELETE") {
        writes.push({ url, body: JSON.parse(String(init.body)) });
        turnRows = [{ ...savedTurn(), request_id: writes[0].body.requestId, state: finalState, result: finalState === "succeeded" ? savedTurn().result : null }];
        return Promise.resolve(response({ cancelled: finalState === "cancelled", state: finalState, turnId }));
      }
      return originalFetch(url, init);
    });
    try {
      await openPanel(); await fillNative(); fireEvent.click(screen.getByRole("button", { name: "Send project request" }));
      const cancel = await screen.findByRole("button", { name: "Cancel request" }, { timeout: 5000 });
      expect(cancel).toBeEnabled(); fireEvent.click(cancel);
      await screen.findByText(finalState === "cancelled" ? "Request cancelled. No automatic retry will start." : "The request had already finished. Its saved result was kept.");
      expect(writes).toHaveLength(2); expect(screen.queryByRole("button", { name: "Retry same request" })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Project question")).toHaveValue("");
      if (finalState === "succeeded") await screen.findByText("The cost is not supplied.");
    } finally { release?.(); }
  });
  it("issues a project connection but refuses a setup file for another app or project", async () => {
    writeHandler = async () => response({ connection: { id: connectionId }, setup: { version: 1, appUrl: window.location.origin, workspaceId, projectId: connectionId,
      connectionId, expectedAuthMode: "chatgpt", token: `op_pc_${connectionId}.${"x".repeat(43)}` } });
    await openPanel(); fireEvent.click(screen.getByText("Connect or revoke a computer"));
    fireEvent.click(screen.getByRole("button", { name: "Create project connection" }));
    await screen.findByText("The connection file did not match this project and app.");
    expect(screen.queryByRole("button", { name: "Download connection file" })).not.toBeInTheDocument();
    expect(writes[0].body).toEqual({ workspaceId, projectId, label: "My computer", authMode: "chatgpt" });
  });
  it("offers a correctly scoped connection file without rendering the token", async () => {
    const token = `op_pc_${connectionId}.${"x".repeat(43)}`;
    writeHandler = async () => response({ connection: { id: connectionId }, setup: { version: 1, appUrl: window.location.origin, workspaceId, projectId,
      connectionId, expectedAuthMode: "chatgpt", token } });
    await openPanel(); fireEvent.click(screen.getByText("Connect or revoke a computer")); fireEvent.click(screen.getByRole("button", { name: "Create project connection" }));
    await screen.findByRole("button", { name: "Download connection file" }); expect(screen.queryByText(token)).not.toBeInTheDocument();
  });
  it("keeps provider work disabled while the existing approval flow is busy", async () => {
    await openPanel({ busy: true }); await fillNative(); expect(screen.getByRole("button", { name: "Send project request" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Project question"), { key: "Enter" }); expect(writes).toEqual([]);
  });
});
