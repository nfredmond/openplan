// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gtfsIntakeStorage, requireGtfsStorageRoom } from "@/lib/gtfs/managed-worker-intake";

const workspace = "ed000000-0000-4000-8000-000000000002";
const archive = { path: `${workspace}/feed/version.zip`, bytes: 21 };
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function fixture(stall = false) {
  const queries: Array<{ path: string; body: unknown }> = [];
  let started!: () => void, closed!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const chunk of request) parts.push(Buffer.from(chunk));
    const body: unknown = JSON.parse(Buffer.concat(parts).toString());
    queries.push({ path: request.url!, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/storage/v1/object/list/gtfs-uploads") { response.end("[]"); return; }
    if (request.url === "/rest/v1/rpc/workspace_storage_bytes") {
      response.on("close", () => { if (!response.writableEnded) closed(); });
      started();
      if (!stall) response.end("0");
      return;
    }
    response.statusCode = 404; response.end("{}");
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Owned HTTP fixture has no address");
  const controller = new AbortController();
  const client = gtfsIntakeStorage(`http://127.0.0.1:${address.port}`, "synthetic-key", controller.signal);
  return { queries, entered, disconnected, controller, client,
    run: () => requireGtfsStorageRoom(client, workspace, archive, controller.signal, { OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES: "1000" }) };
}

describe("managed GTFS storage room transport", () => {
  it("reads the original immutable key and workspace through actual SDK HTTP", async () => {
    const f = await fixture(); await f.run();
    expect(f.queries.map(query => query.path)).toEqual(["/storage/v1/object/list/gtfs-uploads", "/rest/v1/rpc/workspace_storage_bytes"]);
    expect(f.queries[0].body).toMatchObject({ prefix: `${workspace}/feed`, search: "version.zip", limit: 100 });
    expect(f.queries[1].body, "Actual workspace storage RPC projection differs").toEqual({ p_workspace_id: workspace });
  });
  it("closes an actual stalled capacity request when ownership ends", async () => {
    const f = await fixture(true); const operation = f.run();
    const rejection = expect(operation).rejects.toThrow("Original capacity ownership ended");
    await f.entered; f.controller.abort(new Error("Original capacity ownership ended"));
    await rejection;
    await Promise.race([f.disconnected, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Cancelled capacity connection did not close")), 1500))]);
    expect(f.queries).toHaveLength(2);
  });
  it("refuses pre-cancelled work before invoking the Storage client", async () => {
    const f = await fixture(); const bucket = vi.spyOn(f.client.storage, "from");
    f.controller.abort(new Error("Original capacity ownership ended"));
    await expect(f.run()).rejects.toThrow("Original capacity ownership ended");
    expect(bucket).not.toHaveBeenCalled(); expect(f.queries).toEqual([]);
  });
});
