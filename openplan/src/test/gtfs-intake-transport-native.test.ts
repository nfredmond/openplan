// @vitest-environment node
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { gtfsIntakeStorage } from "@/lib/gtfs/managed-worker-intake";

describe("GTFS native upload transport", () => {
  it("closes a real pending HTTP upload response when ownership ends", async () => {
    const controller = new AbortController();
    let received!: () => void, closed!: () => void, responseClosed = false;
    const requestReceived = new Promise<void>(resolve => { received = resolve; });
    const responseEnded = new Promise<void>(resolve => { closed = resolve; });
    const server = createServer((request, response) => {
      request.resume();
      request.once("end", received);
      response.once("close", () => { responseClosed = true; closed(); });
      // Hold the response open after receiving the upload body.
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Owned server has no port");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const client = gtfsIntakeStorage(`http://127.0.0.1:${address.port}`, "synthetic-key", controller.signal);
    const pending = client.storage.from("gtfs-uploads").upload("synthetic.zip", Buffer.from("synthetic bytes"), { upsert: false });
    try {
      await requestReceived;
      expect(responseClosed).toBe(false);
      controller.abort(new Error("Ownership ended"));
      const closedOnCancellation = await Promise.race([
        responseEnded.then(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 500); }),
      ]);
      expect(closedOnCancellation).toBe(true);
      expect((await pending).error).not.toBeNull();
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort(); server.closeAllConnections();
      await pending;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
