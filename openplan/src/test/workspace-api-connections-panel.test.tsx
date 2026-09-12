import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApiConnectionsPanel } from "@/components/workspaces/workspace-api-connections-panel";
import { confirmDestructiveAction } from "./helpers/confirm-dialog";

const workspaceId = "11111111-1111-4111-8111-111111111111", connectionId = "22222222-2222-4222-8222-222222222222",
  revisionId = "33333333-3333-4333-8333-333333333333", otherId = "44444444-4444-4444-8444-444444444444";
const config = { label: "Local fixture", protocol: "openai_chat_completions", endpoint: "http://127.0.0.1:3217/v1/", modelIds: ["fixture-model"], authMode: "none", structuredOutput: true, timeoutSeconds: 120 };
const revision = { id: revisionId, connection_id: connectionId, workspace_id: workspaceId, previous_revision_id: null, configuration: config, configuration_hash: "a".repeat(64), configured_by: workspaceId, created_at: "2026-09-12T12:00:00Z" };
const row = { id: connectionId, workspace_id: workspaceId, current_revision_id: revisionId, created_by: workspaceId, created_at: revision.created_at, revoked_at: null, current_revision: revision };
let listed: unknown;
let failRead: boolean;
let writes: RequestInit[];
let mutate: (init: RequestInit) => Promise<Response>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const page = (connections: unknown[]) => ({ connections, total: connections.length, offset: 0, nextOffset: null });
function saved(init: RequestInit) {
  const body = JSON.parse(String(init.body));
  return json({ created: true, connection: { ...row, id: body.connectionId, current_revision_id: body.revisionId }, revision: { ...revision, id: body.revisionId, connection_id: body.connectionId, configuration: body.configuration } });
}
async function start() {
  render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
  await screen.findByText("0 of 0 connections shown");
}
function fill() {
  fireEvent.change(screen.getByLabelText("Connection name"), { target: { value: "Synthetic API" } });
  fireEvent.change(screen.getByLabelText(/API base URL/), { target: { value: "https://fixture.invalid/v1/" } });
  fireEvent.change(screen.getByLabelText("Model IDs, one per line"), { target: { value: "model-a\nmodel-b" } });
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "SYNTHETIC-KEY" } });
}
beforeEach(() => {
  listed = page([]); failRead = false; writes = []; mutate = async init => saved(init);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method) { writes.push(init); return mutate(init); }
    if (failRead) throw new Error("offline");
    return json(listed);
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("API connection settings", () => {
  it("only reads on mount and saves an explicit destination without storing the key locally", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await start(); fill(); expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/Revision saved/);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].body))).toMatchObject({ workspaceId, expectedRevisionId: null, configuration: { label: "Synthetic API", endpoint: "https://fixture.invalid/v1/", modelIds: ["model-a", "model-b"], authMode: "api_key" }, apiKey: "SYNTHETIC-KEY" });
    expect(storage).not.toHaveBeenCalled();
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });
  it("freezes an uncertain save and retries the exact body once without another revision", async () => {
    mutate = async () => { throw new Error("response lost after commit"); };
    await start(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/change could not be confirmed/);
    expect(screen.getByLabelText("Connection name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeDisabled();
    const original = writes[0].body;
    mutate = async init => saved(init);
    fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    await screen.findByText(/Revision saved/);
    expect(writes).toHaveLength(2); expect(writes[1].body).toBe(original);
    expect(screen.queryByRole("button", { name: "Retry same change" })).not.toBeInTheDocument();
  });
  it("does not dispatch twice while a save is still pending", async () => {
    let finish!: (response: Response) => void;
    mutate = () => new Promise(resolve => { finish = resolve; });
    await start(); fill(); const button = screen.getByRole("button", { name: "Save configuration" });
    fireEvent.click(button); fireEvent.click(button);
    expect(writes).toHaveLength(1);
    finish(saved(writes[0])); await screen.findByText(/Revision saved/);
  });
  it("refuses a successful response with another workspace or revision identity", async () => {
    mutate = async init => { const value = await saved(init).json(); value.revision.workspace_id = otherId; return json(value); };
    await start(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/change could not be confirmed/);
    expect(screen.queryByText(/Revision saved/)).not.toBeInTheDocument();
  });
  it("creates a new revision for edits and explicitly clears the old credential input", async () => {
    listed = page([{ ...row, current_revision: { ...revision, configuration: { ...config, authMode: "api_key" } } }]);
    render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Local fixture" }));
    expect(screen.getByLabelText(/^API key for this revision/)).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Model IDs, one per line" })).toHaveValue("fixture-model");
    expect(screen.getByRole("combobox", { name: "Authentication" })).toHaveValue("api_key");
    fireEvent.change(screen.getByLabelText(/^API key for this revision/), { target: { value: "NEW-SYNTHETIC-KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/Revision saved/);
    const body = JSON.parse(String(writes[0].body));
    expect(body.connectionId).toBe(connectionId); expect(body.expectedRevisionId).toBe(revisionId); expect(body.revisionId).not.toBe(revisionId);
  });
  it("clears a pasted key when choosing keyless operation", async () => {
    await start(); fill(); fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/Revision saved/);
    expect(JSON.parse(String(writes[0].body)).apiKey).toBeNull(); expect(String(writes[0].body)).not.toContain("SYNTHETIC-KEY");
  });
  it("keeps the last successful list visible after a failed refresh", async () => {
    listed = page([row]); render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    await screen.findByRole("heading", { name: "Local fixture" }); failRead = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
    await screen.findByText(/Could not refresh API connections/);
    expect(screen.getByRole("heading", { name: "Local fixture" })).toBeInTheDocument();
  });
  it("rejects a list response joining a different current revision", async () => {
    listed = page([{ ...row, current_revision: { ...revision, id: otherId } }]);
    render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    await screen.findByText(/Could not refresh API connections/);
    expect(screen.queryByRole("heading", { name: "Local fixture" })).not.toBeInTheDocument();
  });
  it("shows permitted metadata and history to members without management controls", async () => {
    listed = page([row]); render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage={false} />);
    const history = await screen.findByRole("button", { name: "History for Local fixture" });
    expect(screen.queryByRole("button", { name: /Edit|Revoke|Save configuration/ })).not.toBeInTheDocument();
    listed = { revisions: [revision], offset: 0, total: 1, nextOffset: null }; fireEvent.click(history);
    const region = await screen.findByRole("region", { name: "Revision history" });
    expect(within(region).getByText(config.endpoint)).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining(`connectionId=${connectionId}&offset=0`), expect.any(Object));
    expect(writes).toHaveLength(0);
  });
  it("refuses history from another connection", async () => {
    listed = page([row]); render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    const history = await screen.findByRole("button", { name: "History for Local fixture" });
    listed = { revisions: [{ ...revision, connection_id: otherId }], offset: 0, total: 1, nextOffset: null }; fireEvent.click(history);
    await screen.findByText(/Could not refresh revision history/);
    expect(screen.queryByRole("region", { name: "Revision history" })).not.toBeInTheDocument();
  });
  it("confirms revocation and retains the expected revision in retries", async () => {
    listed = page([row]); mutate = async () => { throw new Error("offline"); };
    render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Local fixture" }));
    expect(writes).toHaveLength(0); await confirmDestructiveAction();
    await screen.findByText(/change could not be confirmed/);
    expect(JSON.parse(String(writes[0].body))).toEqual({ workspaceId, connectionId, expectedRevisionId: revisionId });
    mutate = async () => json({ connection: { ...row, revoked_at: "2026-09-12T13:00:00Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    await screen.findByText(/Connection revoked/); expect(writes[1].body).toBe(writes[0].body); expect(writes[1].method).toBe("DELETE");
  });
  it("clears an uncertain draft only after confirmation and reloads saved metadata", async () => {
    mutate = async () => { throw new Error("offline"); }; await start(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" })); await screen.findByText(/change could not be confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Discard local draft" })); await confirmDestructiveAction();
    await waitFor(() => expect(screen.getByLabelText("Connection name")).toHaveValue(""));
    expect(screen.getByLabelText("API key")).toHaveValue(""); expect(writes).toHaveLength(1);
  });
  it("loads subsequent connection and history pages without replacing earlier records", async () => {
    listed = { ...page([row]), total: 51, nextOffset: 50 };
    render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    const more = await screen.findByRole("button", { name: "Load more connections" });
    listed = { connections: [{ ...row, id: otherId, current_revision_id: otherId, current_revision: { ...revision, id: otherId, connection_id: otherId, configuration: { ...config, label: "Second connection" } } }], offset: 50, total: 51, nextOffset: null };
    fireEvent.click(more); await screen.findByRole("heading", { name: "Second connection" });
    expect(screen.getByRole("heading", { name: "Local fixture" })).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("offset=50"), expect.any(Object));
    listed = { revisions: [revision], offset: 0, total: 51, nextOffset: 50 };
    fireEvent.click(screen.getByRole("button", { name: "History for Local fixture" }));
    const older = await screen.findByRole("button", { name: "Load older revisions" });
    listed = { revisions: [{ ...revision, id: otherId, configuration: { ...config, label: "Earlier version" } }], offset: 50, total: 51, nextOffset: null };
    fireEvent.click(older); await screen.findByText(/Earlier version/);
    expect(within(screen.getByRole("region", { name: "Revision history" })).getByText(/Local fixture ·/)).toBeInTheDocument();
  });
  it("does not report revocation if the response leaves the connection active", async () => {
    listed = page([row]); mutate = async () => json({ connection: row });
    render(<WorkspaceApiConnectionsPanel workspaceId={workspaceId} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Local fixture" })); await confirmDestructiveAction();
    await screen.findByText(/change could not be confirmed/); expect(screen.queryByText(/Connection revoked/)).not.toBeInTheDocument();
  });
  it("requires distinct model IDs before starting a save", async () => {
    await start(); fill(); fireEvent.change(screen.getByLabelText("Model IDs, one per line"), { target: { value: "model-a\nmodel-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/Enter 1 to 32 distinct model IDs/); expect(writes).toHaveLength(0);
  });

});
