import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProviderConnectionToken } from "@/lib/assistant/provider-server";
import { MAP_PACKAGE_SKILL } from "@/lib/map-packages/skill";
import * as collection from "@/app/api/map-packages/route";
import * as connector from "@/app/api/map-packages/connector/route";
import * as fileRoute from "@/app/api/map-packages/[packageId]/files/[fileName]/route";
import * as uploadRoute from "@/app/api/map-packages/[packageId]/upload/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), userFrom: vi.fn(), serviceFrom: vi.fn(), rpc: vi.fn(), signUpload: vi.fn(), sign: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.userFrom }),
  createServiceRoleClient: () => ({ from: mocks.serviceFrom, rpc: mocks.rpc,
    storage: { from: () => ({ createSignedUploadUrl: mocks.signUpload, createSignedUrl: mocks.sign }) } }),
}));

const workspace = "22222222-2222-4222-8222-222222222222", project = "33333333-3333-4333-8333-333333333333";
const pkg = "44444444-4444-4444-8444-444444444444", attempt = "55555555-5555-4555-8555-555555555555", owner = "66666666-6666-4666-8666-666666666666";
const connection = "77777777-7777-4777-8777-777777777777", requestId = "88888888-8888-4888-8888-888888888888";
const origin = "http://localhost:3219";
let token: ReturnType<typeof newProviderConnectionToken>;

/** A chainable stand-in for a PostgREST query that records every call. */
function query(data: unknown, error: unknown = null) {
  const calls: Array<[string, unknown[]]> = [];
  const result = { data, error };
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit", "not", "is", "in"]) {
    q[name] = (...args: unknown[]) => { calls.push([name, args]); return q; };
  }
  q.maybeSingle = async () => result;
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  q.calls = calls;
  return q as Record<string, unknown> & { calls: Array<[string, unknown[]]> };
}

function brief(client = "SYNTHETIC Agency") {
  return { version: 1, kind: "openplan.map_package_brief", workspaceId: workspace,
    project: { id: project, name: "SYNTHETIC project", summary: null, status: null, planType: null, deliveryPhase: null },
    client, deliverable: "grant_application", fundingOpportunity: null, place: null,
    studyArea: { type: "FeatureCollection", features: [] }, placeBoundary: "none_recorded", request: "Figures", practice: true,
    skill: { name: "transportation-gis", treeHash: MAP_PACKAGE_SKILL.treeHash }, capturedAt: "2026-10-10T00:00:00Z" };
}
function claimed(overrides: Record<string, unknown> = {}) {
  const canonical = JSON.stringify(brief());
  return { id: pkg, attempt_id: attempt, workspace_id: workspace, project_id: project, title: "SYNTHETIC figures", provider: "claude",
    auth_mode: "claude_subscription", model_id: "claude-fable-5-1", effort: "high", brief_canonical: canonical,
    brief_hash: createHash("sha256").update(canonical).digest("hex"), skill_tree_hash: MAP_PACKAGE_SKILL.treeHash,
    lease_expires_at: "2099-01-01T00:00:00Z", ...overrides };
}
function receipt(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, provider: "claude", authMode: "claude_subscription", model: "claude-fable-5-1", effort: "high",
    modelsUsed: ["claude-fable-5-1"], cliVersion: "2.1.296 (Claude Code)", skillTreeHash: MAP_PACKAGE_SKILL.treeHash, kitChanged: false,
    sessionId: "synthetic", durationMs: 1000, numTurns: 3, usage: null, packageName: "synthetic_maps_20261010", qa: null, gates: null,
    figures: [{ id: "fig01", figure: "Figure 1", title: "Study Area", alt: null, preview: "fig01.png" }], ...overrides };
}
const files = () => [
  { role: "package_zip", name: "synthetic_maps_20261010.zip", bytes: 19, sha256: "a".repeat(64) },
  { role: "figure_preview", name: "fig01.png", bytes: 5, sha256: "b".repeat(64) },
];
const fileRow = (name: string, role: string, verified = true) => ({ id: name, package_id: pkg, workspace_id: workspace, project_id: project, role, name,
  object_path: `${workspace}/${project}/${pkg}/${name}`, bytes: 19, sha256: "a".repeat(64), verified_at: verified ? "2026-10-10T00:00:00Z" : null, created_at: "2026-10-10T00:00:00Z" });

function connectorRequest(body: unknown, bearer: string | null = token.token) {
  return new NextRequest(`${origin}/api/map-packages/connector`, { method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
}
function browserRequest(path: string, body?: unknown, method = "POST", headers: Record<string, string> = { origin }) {
  return new NextRequest(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  token = newProviderConnectionToken();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.signUpload.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://storage.example.test/upload/${path}?token=t` }, error: null }));
  mocks.sign.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://storage.example.test/object/${path}?token=t` }, error: null }));
});

describe("map package connector endpoint", () => {
  it("refuses a request without the project connection bearer", async () => {
    const response = await connector.POST(connectorRequest({ operation: "claim", authMode: "claude_subscription" }, null));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("hands over the frozen brief and the run prompt for a claimed package", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "connected", package: claimed() }, error: null });
    const response = await connector.POST(connectorRequest({ operation: "claim", authMode: "claude_subscription" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.rpc).toHaveBeenCalledWith("claim_project_map_package", { p_connection_id: token.connectionId,
      p_token_hash: createHash("sha256").update(token.token).digest("hex"), p_auth_mode: "claude_subscription" });
    expect(body.package).toMatchObject({ id: pkg, attemptId: attempt, model: "claude-fable-5-1", effort: "high", briefCanonical: claimed().brief_canonical,
      skill: { name: "transportation-gis", treeHash: MAP_PACKAGE_SKILL.treeHash } });
    expect(body.package.prompt).toContain("The pages speak as SYNTHETIC Agency.");
    expect(body.package.prompt).toContain("This is practice work.");
  });

  it("refuses a claimed brief whose hash does not match its text", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "connected", package: claimed({ brief_hash: "0".repeat(64) }) }, error: null });
    expect((await connector.POST(connectorRequest({ operation: "claim", authMode: "claude_subscription" }))).status).toBe(409);
  });

  it.each([
    ["two ZIPs", [...files(), { role: "package_zip", name: "second_maps_20261010.zip", bytes: 1, sha256: "c".repeat(64) }], receipt()],
    ["no ZIP", [files()[1]], receipt()],
    ["a preview the files do not include", [files()[0]], receipt()],
    ["a preview that is not a PNG", [files()[0], { role: "figure_preview", name: "fig01.svg", bytes: 1, sha256: "c".repeat(64) }], receipt({ figures: [] })],
  ])("refuses an upload with %s before any database call", async (_label, declared, sentReceipt) => {
    const response = await connector.POST(connectorRequest({ operation: "upload", packageId: pkg, attemptId: attempt, receipt: sentReceipt, files: declared }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signUpload).not.toHaveBeenCalled();
  });

  it("records the upload and issues one signed URL per file still to arrive, at its scoped path", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: pkg, workspace_id: workspace, project_id: project, state: "uploading" }, error: null });
    const rows = query([fileRow("synthetic_maps_20261010.zip", "package_zip", false), fileRow("fig01.png", "figure_preview", false)]);
    mocks.serviceFrom.mockReturnValue(rows);
    const response = await connector.POST(connectorRequest({ operation: "upload", packageId: pkg, attemptId: attempt, receipt: receipt(), files: files() }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("begin_project_map_package_upload", expect.objectContaining({ p_package_id: pkg, p_attempt_id: attempt, p_receipt: receipt(), p_files: files() }));
    expect(rows.calls).toContainEqual(["eq", ["package_id", pkg]]);
    expect(rows.calls).toContainEqual(["is", ["verified_at", null]]);
    expect(mocks.signUpload.mock.calls.map(call => call[0])).toEqual([`${workspace}/${project}/${pkg}/synthetic_maps_20261010.zip`, `${workspace}/${project}/${pkg}/fig01.png`]);
    expect((await response.json()).uploads).toHaveLength(2);
  });

  it("completes with what the server measured, not what the connector declared", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "heartbeat_project_map_package"
      ? { data: { state: "uploading", leaseExpiresAt: "2099-01-01T00:00:00Z" }, error: null }
      : { data: { state: "ready" }, error: null });
    mocks.serviceFrom.mockReturnValue(query([fileRow("synthetic_maps_20261010.zip", "package_zip", false)]));
    mocks.fetch.mockResolvedValue(new Response("stored-bytes-differ"));
    const response = await connector.POST(connectorRequest({ operation: "complete", packageId: pkg, attemptId: attempt }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_project_map_package", expect.objectContaining({ p_verified: [
      { name: "synthetic_maps_20261010.zip", bytes: 19, sha256: createHash("sha256").update("stored-bytes-differ").digest("hex") }] }));
  });

  it("says a file is missing, and completes nothing, when storage has no object", async () => {
    mocks.rpc.mockResolvedValue({ data: { state: "uploading", leaseExpiresAt: null }, error: null });
    mocks.serviceFrom.mockReturnValue(query([fileRow("synthetic_maps_20261010.zip", "package_zip", false)]));
    mocks.sign.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    const response = await connector.POST(connectorRequest({ operation: "complete", packageId: pkg, attemptId: attempt }));
    expect(response.status).toBe(409);
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["heartbeat_project_map_package"]);
  });

  it("reads no stored object for an attempt that is not uploading", async () => {
    mocks.rpc.mockResolvedValue({ data: { state: "cancelled", leaseExpiresAt: null }, error: null });
    const response = await connector.POST(connectorRequest({ operation: "complete", packageId: pkg, attemptId: attempt }));
    expect(response.status).toBe(409);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});

describe("starting a map package", () => {
  const agentBody = { requestId, workspaceId: workspace, projectId: project, title: "SYNTHETIC figures", deliverable: "grant_application",
    fundingOpportunityId: null, source: "agent", connectionId: connection, client: "SYNTHETIC Agency", request: "Figures", practice: true };

  function userTables(provider: string, expectedAuthMode: string, role = "member") {
    const projectQuery = query({ id: project, workspace_id: workspace, name: "SYNTHETIC project", summary: null, status: null, plan_type: null,
      delivery_phase: null, latitude: 38.8, longitude: -121.1, place_label: "Synthetic, ST" });
    const connectionQuery = query({ id: connection, provider, expected_auth_mode: expectedAuthMode });
    const memberQuery = query({ workspace_id: workspace, role });
    const corridorQuery = query([]);
    mocks.userFrom.mockImplementation((table: string) => table === "projects" ? projectQuery : table === "assistant_provider_connections" ? connectionQuery
      : table === "workspace_members" ? memberQuery : corridorQuery);
    return { projectQuery, connectionQuery };
  }

  it("refuses a viewer before reading the connection or building a brief", async () => {
    const { connectionQuery } = userTables("claude", "claude_subscription", "viewer");
    const response = await collection.POST(browserRequest("/api/map-packages", agentBody));
    expect(response.status).toBe(403);
    expect(connectionQuery.calls).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a Codex connection: GPT-6 Astra is not open for map packages yet", async () => {
    userTables("codex", "chatgpt");
    const response = await collection.POST(browserRequest("/api/map-packages", agentBody));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("map_package_runner_not_ready");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("queues Claude Fable 5.1 at high effort with a brief read from the project's own place and site", async () => {
    const { projectQuery, connectionQuery } = userTables("claude", "claude_subscription");
    mocks.rpc.mockResolvedValue({ data: { created: true, package: { id: pkg } }, error: null });
    const response = await collection.POST(browserRequest("/api/map-packages", agentBody));
    expect(response.status).toBe(201);
    // The access check reads the project first; the brief's own read names the place and site columns.
    const select = String(projectQuery.calls.filter(call => call[0] === "select").at(-1)?.[1][0]);
    for (const column of ["latitude", "longitude", "place_geometry_geojson", "place_label"]) expect(select).toContain(column);
    expect(connectionQuery.calls).toContainEqual(["eq", ["user_id", owner]]);
    const args = mocks.rpc.mock.calls[0][1];
    expect(mocks.rpc.mock.calls[0][0]).toBe("create_project_map_package");
    expect(args).toMatchObject({ p_source: "agent", p_provider: "claude", p_auth_mode: "claude_subscription", p_model_id: "claude-fable-5-1", p_effort: "high",
      p_skill_tree_hash: MAP_PACKAGE_SKILL.treeHash, p_user_id: owner });
    const sent = JSON.parse(args.p_brief_canonical);
    expect(sent.client).toBe("SYNTHETIC Agency");
    expect(sent.studyArea.features).toEqual([{ type: "Feature", properties: { role: "site", name: null }, geometry: { type: "Point", coordinates: [-121.1, 38.8] } }]);
  });

  it("refuses a request from another origin", async () => {
    const response = await collection.POST(browserRequest("/api/map-packages", agentBody, "POST", { origin: "https://elsewhere.example" }));
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records a hand-built package and returns a signed URL for its ZIP", async () => {
    userTables("claude", "claude_subscription");
    mocks.rpc.mockResolvedValue({ data: { created: true, package: { id: pkg, workspace_id: workspace, project_id: project, state: "uploading" } }, error: null });
    const response = await collection.POST(browserRequest("/api/map-packages", { requestId, workspaceId: workspace, projectId: project, title: "Hand-built",
      deliverable: "general", fundingOpportunityId: null, source: "upload", fileName: "figures.zip", bytes: 1000 }));
    expect(response.status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_source: "upload", p_upload_file_name: "figures.zip", p_model_id: null, p_brief_canonical: null });
    expect(mocks.signUpload).toHaveBeenCalledWith(`${workspace}/${project}/${pkg}/figures.zip`, { upsert: false });
  });
});

describe("map package files", () => {
  const context = (fileName: string) => ({ params: Promise.resolve({ packageId: pkg, fileName }) });

  it("serves only verified files, and only from the package's own path", async () => {
    mocks.userFrom.mockReturnValue(query(null));
    expect((await fileRoute.GET(browserRequest(`/api/map-packages/${pkg}/files/x.png`, undefined, "GET"), context("x.png"))).status).toBe(404);
    const verifiedFilter = query({ ...fileRow("fig01.png", "figure_preview"), object_path: `${workspace}/${project}/other/fig01.png` });
    mocks.userFrom.mockReturnValue(verifiedFilter);
    expect((await fileRoute.GET(browserRequest(`/api/map-packages/${pkg}/files/fig01.png`, undefined, "GET"), context("fig01.png"))).status).toBe(404);
    expect(verifiedFilter.calls).toContainEqual(["not", ["verified_at", "is", null]]);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("redirects the ZIP to a short-lived download link and streams previews in a sandbox", async () => {
    mocks.userFrom.mockReturnValue(query(fileRow("synthetic_maps_20261010.zip", "package_zip")));
    const zip = await fileRoute.GET(browserRequest(`/api/map-packages/${pkg}/files/synthetic_maps_20261010.zip`, undefined, "GET"), context("synthetic_maps_20261010.zip"));
    expect(zip.status).toBe(307);
    expect(mocks.sign).toHaveBeenCalledWith(`${workspace}/${project}/${pkg}/synthetic_maps_20261010.zip`, 300, { download: "synthetic_maps_20261010.zip" });
    mocks.userFrom.mockReturnValue(query(fileRow("fig01.png", "figure_preview")));
    mocks.fetch.mockResolvedValue(new Response("png-bytes"));
    const preview = await fileRoute.GET(browserRequest(`/api/map-packages/${pkg}/files/fig01.png`, undefined, "GET"), context("fig01.png"));
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("content-security-policy")).toContain("sandbox");
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("finishing a hand-built package", () => {
  const context = { params: Promise.resolve({ packageId: pkg }) };
  const uploadRow = (requestedBy: string) => ({ id: pkg, workspace_id: workspace, project_id: project, source: "upload", requested_by: requestedBy, upload_file_name: "figures.zip" });

  function uploadTables(row: Record<string, unknown>, role = "member") {
    const memberQuery = query({ workspace_id: workspace, role });
    const projectQuery = query({ id: project, workspace_id: workspace, name: "SYNTHETIC project" });
    const packageQuery = query(row);
    mocks.userFrom.mockImplementation((table: string) => table === "workspace_members" ? memberQuery : table === "projects" ? projectQuery : packageQuery);
  }

  it("lets only the person who asked finish it", async () => {
    uploadTables(uploadRow("99999999-9999-4999-8999-999999999999"));
    expect((await uploadRoute.POST(browserRequest(`/api/map-packages/${pkg}/upload`, { action: "complete" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a requester who is now only a viewer", async () => {
    uploadTables(uploadRow(owner), "viewer");
    expect((await uploadRoute.POST(browserRequest(`/api/map-packages/${pkg}/upload`, { action: "complete" }), context)).status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records the size and sha256 the server measured", async () => {
    uploadTables(uploadRow(owner));
    mocks.fetch.mockResolvedValue(new Response("zip-bytes"));
    mocks.rpc.mockResolvedValue({ data: { id: pkg, state: "ready" }, error: null });
    expect((await uploadRoute.POST(browserRequest(`/api/map-packages/${pkg}/upload`, { action: "complete" }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_uploaded_map_package", { p_package_id: pkg, p_user_id: owner, p_bytes: 9,
      p_sha256: createHash("sha256").update("zip-bytes").digest("hex") });
  });
});

describe("stopping a package", () => {
  const context = { params: Promise.resolve({ packageId: pkg }) };
  function tables(role: string) {
    const memberQuery = query({ workspace_id: workspace, role });
    const projectQuery = query({ id: project, workspace_id: workspace, name: "SYNTHETIC project" });
    mocks.userFrom.mockImplementation((table: string) => table === "workspace_members" ? memberQuery : table === "projects" ? projectQuery : query({ id: pkg, project_id: project }));
  }

  it("refuses a viewer without calling the database function", async () => {
    tables("viewer");
    const detail = await import("@/app/api/map-packages/[packageId]/route");
    expect((await detail.DELETE(browserRequest(`/api/map-packages/${pkg}`, undefined, "DELETE"), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("asks the database to stop it for a member", async () => {
    tables("member");
    mocks.rpc.mockResolvedValue({ data: { state: "cancelled" }, error: null });
    const detail = await import("@/app/api/map-packages/[packageId]/route");
    const response = await detail.DELETE(browserRequest(`/api/map-packages/${pkg}`, undefined, "DELETE"), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_project_map_package", { p_package_id: pkg, p_user_id: owner });
  });
});
