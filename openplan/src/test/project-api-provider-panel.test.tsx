import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProviderPanel } from "@/components/assistant/project-provider-panel";
const workspaceId = "11111111-1111-4111-8111-111111111111", projectId = "22222222-2222-4222-8222-222222222222",
  connectionId = "33333333-3333-4333-8333-333333333333", revisionId = "44444444-4444-4444-8444-444444444444",
  owner = "55555555-5555-4555-8555-555555555555", other = "66666666-6666-4666-8666-666666666666", turnId = "77777777-7777-4777-8777-777777777777";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const config = { label: "SYNTHETIC saved API", protocol: "openai_chat_completions", endpoint: "https://synthetic.example.test/v1/", modelIds: ["synthetic-one", "synthetic-two"], structuredOutput: true, authMode: "api_key", timeoutSeconds: 30 };
const connection = () => ({ id: connectionId, workspace_id: workspaceId, current_revision_id: revisionId, created_by: owner, created_at: "2026-09-12T00:00:00Z", revoked_at: null as string | null,
  current_revision: { id: revisionId, connection_id: connectionId, workspace_id: workspaceId, previous_revision_id: null, configured_by: owner,
    created_at: "2026-09-12T00:00:00Z", configuration: { ...config }, configuration_hash: hash(JSON.stringify(config)) } });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
let apiRows: ReturnType<typeof connection>[], turnRows: unknown[], posts: Record<string, unknown>[], next: number | null;
let write: (body: Record<string, unknown>) => Promise<Response>;
function turn(body: Record<string, unknown>) {
  return { id: turnId, request_id: body.requestId, workspace_id: workspaceId, project_id: projectId, provider: "api_connection", model_id: body.model,
    auth_mode: body.authMode, question: body.question, packet_hash: "a".repeat(64), state: "queued", failure_code: null, created_at: "2026-09-12T00:00:00Z", result: null,
    api_connection_id: body.connectionId, api_revision_id: body.revisionId, api_configuration_hash: body.configurationHash, api_charge_ack: true,
    api_configuration_canonical: JSON.stringify({ ...config, authMode: body.authMode === "connection_no_key" ? "none" : "api_key" }) };
}
beforeEach(() => {
  vi.clearAllMocks(); apiRows = [connection()]; turnRows = []; posts = []; next = null;
  write = async body => { const saved = turn(body); turnRows = [saved]; return response({ created: true, turn: saved }, 201); };
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { const body = JSON.parse(String(init.body)); posts.push(body); return write(body); }
    if (url.startsWith("/api/workspaces/provider-api-connections")) return response({ connections: apiRows, total: apiRows.length, offset: Number(new URL(url, "http://localhost").searchParams.get("offset")), nextOffset: next });
    if (url.startsWith("/api/assistant/providers/connections")) return response({ connections: [] });
    return response({ turns: turnRows });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() {
  const review = vi.fn(); render(<ProjectProviderPanel workspaceId={workspaceId} projectId={projectId} busy={false} onReview={review} />);
  fireEvent.click(screen.getByRole("button", { name: "Project task · choose provider" }));
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "api_connection" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh API choices" })).toBeEnabled());
  return review;
}
async function fill() {
  fireEvent.change(screen.getByLabelText("Saved API connection"), { target: { value: connectionId } });
  fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "synthetic-one" } });
  fireEvent.change(screen.getByLabelText("Project question"), { target: { value: "SYNTHETIC draft request" } });
}
function consent() { fireEvent.click(screen.getByRole("checkbox", { name: /I authorize sharing/ })); }
function send() { fireEvent.click(screen.getByRole("button", { name: "Send project request" })); }

describe("saved API selection in the project provider panel", () => {
  it.each(["api_key", "none"])("sends the exact saved revision and configured model with %s after consent", async mode => {
    apiRows[0].current_revision.configuration.authMode = mode;
    apiRows[0].current_revision.configuration_hash = hash(JSON.stringify(apiRows[0].current_revision.configuration));
    const review = await open(); await fill();
    expect(screen.getByText(/Destination: https:\/\/synthetic.example.test\/v1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send project request" })).toBeDisabled();
    expect(within(screen.getByLabelText("Model ID")).getAllByRole("option")).toHaveLength(3);
    consent(); fireEvent.keyDown(screen.getByLabelText("Project question"), { key: "Enter" });
    await screen.findByText("Status: queued");
    expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ workspaceId, projectId, provider: "api_connection", connectionId, revisionId,
      configurationHash: apiRows[0].current_revision.configuration_hash, model: "synthetic-one", authMode: mode === "none" ? "connection_no_key" : "connection_api_key", acceptApiCharges: true });
    expect(posts[0]).not.toHaveProperty("apiKey"); expect(posts[0]).not.toHaveProperty("packet"); expect(review).not.toHaveBeenCalled();
  });
  it("requires fresh consent after changing the selected model", async () => {
    await open(); await fill(); consent(); expect(screen.getByRole("button", { name: "Send project request" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "synthetic-two" } });
    expect(screen.getByRole("checkbox", { name: /I authorize sharing/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Send project request" })).toBeDisabled(); expect(posts).toEqual([]);
  });
  it("loads subsequent metadata pages without losing earlier API choices", async () => {
    next = 50; await open();
    apiRows = [{ ...connection(), id: other, current_revision: { ...connection().current_revision, connection_id: other, configuration: { ...config, label: "SYNTHETIC second API" } } }]; next = null;
    fireEvent.click(screen.getByRole("button", { name: "Load more API choices" }));
    await screen.findByRole("option", { name: "SYNTHETIC second API" });
    expect(screen.getByRole("option", { name: "SYNTHETIC saved API" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("offset=50"))).toBe(true);
  });
  it.each(["workspace", "revision_workspace", "connection", "revision_id", "offset"])("refuses metadata outside the requested %s", async mismatch => {
    if (mismatch === "workspace") apiRows[0].workspace_id = other;
    if (mismatch === "revision_workspace") apiRows[0].current_revision.workspace_id = other;
    if (mismatch === "connection") apiRows[0].current_revision.connection_id = other;
    if (mismatch === "revision_id") apiRows[0].current_revision.id = other;
    if (mismatch === "offset") next = 0;
    await open(); expect(screen.getByRole("alert")).toHaveTextContent("API choices could not be refreshed");
    expect(screen.queryByRole("option", { name: "SYNTHETIC saved API" })).not.toBeInTheDocument(); expect(posts).toEqual([]);
  });
  it("keeps native controls usable when saved API metadata cannot be read", async () => {
    const normal = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) => String(url).startsWith("/api/workspaces/provider-api-connections") ? Promise.resolve(response({}, 503)) : normal(url, init));
    await open(); expect(screen.getByRole("alert")).toHaveTextContent("API choices could not be refreshed");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "codex" } });
    expect(screen.getByLabelText("Project connection")).toBeInTheDocument(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it.each(["edit", "revoke", "hash"])("does not silently replace a selected revision after %s", async action => {
    await open(); await fill(); consent();
    if (action === "edit") { apiRows = [connection()]; apiRows[0].current_revision_id = other; apiRows[0].current_revision.id = other; }
    else if (action === "hash") { apiRows = [connection()]; apiRows[0].current_revision.configuration_hash = "b".repeat(64); }
    else apiRows[0].revoked_at = "2026-09-12T00:01:00Z";
    fireEvent.click(screen.getByRole("button", { name: "Refresh API choices" }));
    await screen.findByText(/This API selection changed/); expect(screen.getByRole("button", { name: "Send project request" })).toBeDisabled();
    expect(screen.getByLabelText("Saved API connection")).toHaveValue(""); expect(posts).toEqual([]);
    if (action === "edit") { await fill(); expect(screen.getByRole("checkbox", { name: /I authorize sharing/ })).not.toBeChecked(); consent(); send();
      await screen.findByText("Status: queued"); expect(posts[0].revisionId).toBe(other); }
  });
  it("keeps the exact pending payload after response loss and a later configuration edit", async () => {
    const normal = write; let count = 0;
    write = async body => { if (++count === 1) throw new Error("SYNTHETIC lost response"); return normal(body); };
    await open(); await fill(); consent(); send(); await screen.findByRole("button", { name: "Retry same request" });
    apiRows = [connection()]; apiRows[0].current_revision_id = other; apiRows[0].current_revision.id = other;
    fireEvent.click(screen.getByRole("button", { name: "Refresh API choices" })); await screen.findByText(/This API selection changed/);
    expect(screen.getByLabelText("Provider")).toBeDisabled(); expect(screen.getByLabelText("Saved API connection")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    await screen.findByText("Status: queued"); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
    expect(posts[1].revisionId).toBe(revisionId);
  });
  it.each(["connection", "revision", "hash"])("does not accept a POST response for a different API %s", async changed => {
    write = async body => { const saved = turn(body); if (changed === "connection") saved.api_connection_id = other;
      if (changed === "revision") saved.api_revision_id = other; if (changed === "hash") saved.api_configuration_hash = "b".repeat(64);
      return response({ turn: saved }, 201); };
    await open(); await fill(); consent(); send();
    await screen.findByRole("button", { name: "Retry same request" }); expect(screen.getByRole("alert")).toHaveTextContent(/selected revision/);
  });
  it.each(["connection", "revision", "hash", "original"])("recovers only the matching retained API request after lost response: %s", async changed => {
    write = async body => { const saved = turn(body); if (changed === "connection") saved.api_connection_id = other;
      if (changed === "revision") saved.api_revision_id = other; if (changed === "hash") saved.api_configuration_hash = "b".repeat(64);
      turnRows = [saved]; throw new Error("SYNTHETIC lost response"); };
    await open(); await fill(); consent(); send(); fireEvent.click(await screen.findByRole("button", { name: "Check saved request" }));
    if (changed === "original") { await screen.findByText(/original request was recovered/); expect(screen.queryByRole("button", { name: "Retry same request" })).not.toBeInTheDocument(); }
    else { await screen.findByText(/No saved request is visible yet/); expect(screen.getByRole("button", { name: "Retry same request" })).toBeInTheDocument(); }
    expect(posts).toHaveLength(1);
  });
  it.each(["json", "model", "auth"])("refuses an unreadable retained API configuration: %s", async changed => {
    write = async body => { const saved = turn(body);
      if (changed === "json") saved.api_configuration_canonical = "{";
      if (changed === "model") saved.model_id = "unconfigured-model";
      if (changed === "auth") saved.api_configuration_canonical = JSON.stringify({ ...config, authMode: "none" });
      return response({ turn: saved }, 201); };
    await open(); await fill(); consent(); send(); await screen.findByRole("button", { name: "Retry same request" });
    expect(screen.getByRole("alert")).toHaveTextContent("retained API configuration could not be read");
    expect(screen.queryByText(/Request saved/)).not.toBeInTheDocument();
  });
  it("retains the old destination and draft without executing it after configuration changes", async () => {
    const old = { ...turn({ requestId: other, question: "SYNTHETIC old request", model: "synthetic-one", authMode: "connection_api_key", connectionId, revisionId, configurationHash: hash(JSON.stringify(config)) }), state: "succeeded",
      result: { answer: "SYNTHETIC answer", citations: [{ id: `project:${projectId}`, label: "SYNTHETIC project", href: `/projects/${projectId}` }], proposal: {
        status: "proposed", kind: "create_project_record", approval: "approval_required", description: "SYNTHETIC proposal", payload: { kind: "create_project_record", recordType: "submittal", projectId, title: "SYNTHETIC draft", submittalType: "other" } } } };
    turnRows = [old]; apiRows[0].current_revision.configuration.endpoint = "https://changed.example.test/v1/";
    const review = await open(); const article = await screen.findByRole("article", { name: "Provider request: SYNTHETIC old request" });
    expect(within(article).getByText(/Original destination: https:\/\/synthetic.example.test\/v1/)).toBeInTheDocument();
    expect(within(article).getByText(/API revision/)).toHaveTextContent(revisionId); expect(review).not.toHaveBeenCalled(); expect(posts).toEqual([]);
    fireEvent.click(within(article).getByRole("button", { name: "Review draft submittal in conversation" }));
    expect(review).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: turnId, proposal: old.result.proposal })); expect(posts).toEqual([]);
  });
});
