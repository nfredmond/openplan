// @vitest-environment node
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readRetainedGtfsArchive, type RetainedGtfsArchive } from "@/lib/gtfs/retained-archive";

const bytes = new Uint8Array([80, 75, 3, 4, 1, 2]);
const identity: RetainedGtfsArchive = {
  workspaceId: "10000000-0000-0000-0000-000000000001",
  feedId: "20000000-0000-0000-0000-000000000002",
  versionId: "30000000-0000-0000-0000-000000000003",
  storagePath: "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000003.zip",
  byteSize: bytes.length,
  checksumSha256: createHash("sha256").update(bytes).digest("hex"),
};

async function within<T>(operation: Promise<T>, milliseconds = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Owned HTTP observation did not settle")), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Observe the installed SDK against a real, disposable loopback connection. */
async function endpoint(body: (response: ServerResponse) => void) {
  let arrived!: () => void;
  let disconnected!: () => void;
  let readHeaders!: () => void;
  const received = new Promise<void>((resolve) => { arrived = resolve; });
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  const headersReceived = new Promise<void>((resolve) => { readHeaders = resolve; });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.once("close", disconnected);
    body(response);
    arrived();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Owned HTTP address unavailable");
  const service = createClient(`http://127.0.0.1:${address.port}`, "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const response = await fetch(input, init);
      readHeaders();
      return response;
    } },
  });
  return {
    service, received, headersReceived, closed, requests,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

describe("retained GTFS native HTTP cancellation", () => {
  it("closes a request cancelled before response headers arrive", async () => {
    const http = await endpoint(() => {});
    const abort = new AbortController();
    try {
      const pending = readRetainedGtfsArchive(http.service, identity, {
        signal: abort.signal, env: { OPENPLAN_GTFS_PARSE_BUDGET_MS: "5000" },
      });
      await within(http.received);
      abort.abort();
      expect(await within(pending)).toEqual({ ok: false, code: "cancelled" });
      await within(http.closed);
      expect(http.requests).toEqual([`/storage/v1/object/gtfs-uploads/${identity.storagePath}`]);
    } finally {
      abort.abort();
      await http.stop();
    }
  });

  it("closes a cancelled partial body and refuses its archive", async () => {
    const http = await endpoint((response) => {
      response.writeHead(200, { "content-type": "application/zip", "content-length": bytes.length });
      response.write(bytes.slice(0, 2));
    });
    const abort = new AbortController();
    try {
      const pending = readRetainedGtfsArchive(http.service, identity, {
        signal: abort.signal, env: { OPENPLAN_GTFS_PARSE_BUDGET_MS: "5000" },
      });
      await within(http.received);
      await within(http.headersReceived);
      // Let the installed SDK deliver the native stream to its reader.
      await new Promise<void>((resolve) => setImmediate(resolve));
      abort.abort();
      expect(await within(pending)).toEqual({ ok: false, code: "cancelled" });
      await within(http.closed);
      expect(http.requests).toHaveLength(1);
    } finally {
      abort.abort();
      await http.stop();
    }
  });

  it("closes a headers-stalled request when the archive deadline expires", async () => {
    const http = await endpoint(() => {});
    try {
      const pending = readRetainedGtfsArchive(http.service, identity, {
        env: { OPENPLAN_GTFS_PARSE_BUDGET_MS: "150" },
      });
      await within(http.received);
      expect(await within(pending)).toEqual({ ok: false, code: "timed_out" });
      await within(http.closed);
      expect(http.requests).toHaveLength(1);
    } finally {
      await http.stop();
    }
  });
});
