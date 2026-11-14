import { describe, expect, it, vi } from "vitest";

import { sendFileThroughStorage } from "@/lib/files/staged-upload-client";

/**
 * The browser half of a staged upload. The property that matters on the hosted
 * site is that the file's bytes go ONLY to the signed Storage URL, never to an
 * app route, and that every refusal reaches the caller as a JSON `{ error }`
 * it already knows how to show.
 */

const START = "/api/example/upload/start";
const COMPLETE = "/api/example/upload/complete";
const SIGNED = "https://storage.example.test/object/upload/sign/bucket/ws/staged/u/1?token=t";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function file() {
  return new File(["0123456789"], "adopted-plan.pdf", { type: "application/pdf" });
}

describe("sendFileThroughStorage", () => {
  it("describes the file to start, PUTs it to the signed URL, and names the object to complete", async () => {
    const chosen = file();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === START) return json({ uploadUrl: SIGNED, objectPath: "ws/staged/u/1", contentType: "application/octet-stream" });
      if (url === SIGNED) return new Response(null, { status: 200 });
      return json({ document: { id: "doc-1" } }, 201);
    });

    const response = await sendFileThroughStorage({
      startUrl: START,
      completeUrl: COMPLETE,
      fields: { workspaceId: "ws" },
      file: chosen,
      contentType: "application/pdf",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ document: { id: "doc-1" } });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([START, SIGNED, COMPLETE]);

    const described = { workspaceId: "ws", filename: "adopted-plan.pdf", byteSize: 10, contentType: "application/pdf" };
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual(described);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      body: chosen,
      headers: { "content-type": "application/octet-stream", "x-upsert": "false" },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).toEqual({ ...described, objectPath: "ws/staged/u/1" });
    // The file itself never rides to an app route.
    for (const [url, init] of fetchImpl.mock.calls) {
      if (String(url).startsWith("/api/")) expect(init?.body).not.toBe(chosen);
    }
  });

  it("answers a start refusal as itself and sends nothing to Storage", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "This file would put the workspace over its 5 GiB storage limit." }, 413));
    const response = await sendFileThroughStorage({
      startUrl: START,
      completeUrl: COMPLETE,
      fields: {},
      file: file(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatch(/storage limit/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses when start answers without an upload address", async () => {
    const fetchImpl = vi.fn(async () => json({ document: { id: "not-an-upload" } }, 200));
    const response = await sendFileThroughStorage({
      startUrl: START,
      completeUrl: COMPLETE,
      fields: {},
      file: file(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.ok).toBe(false);
    expect((await response.json()).error).toMatch(/Nothing was stored/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a Storage refusal of the PUT and never calls complete", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === START
        ? json({ uploadUrl: SIGNED, objectPath: "ws/staged/u/1" })
        : new Response("Payload too large", { status: 413 })
    );
    const response = await sendFileThroughStorage({
      startUrl: START,
      completeUrl: COMPLETE,
      fields: {},
      file: file(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.ok).toBe(false);
    expect((await response.json()).error).toContain("Storage answered 413");
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([START, SIGNED]);
  });
});
