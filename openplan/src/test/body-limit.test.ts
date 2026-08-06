import { describe, expect, it } from "vitest";
import {
  BODY_LIMITS,
  readBytesWithLimit,
  readBytesWithLimitStreaming,
  readJsonWithLimit,
  readTextWithLimit,
} from "@/lib/http/body-limit";
import { GTFS_MAX_ARCHIVE_BYTES } from "@/lib/gtfs/limits";

describe("readJsonWithLimit", () => {
  it("keeps the shared body limit constants explicit", () => {
    expect(BODY_LIMITS.adminTriageJson).toBe(4 * 1024);
    expect(BODY_LIMITS.smallJson).toBe(16 * 1024);
    expect(BODY_LIMITS.normalJson).toBe(64 * 1024);
    expect(BODY_LIMITS.documentJson).toBe(256 * 1024);
    expect(BODY_LIMITS.networkGeoJson).toBe(2 * 1024 * 1024);
    expect(BODY_LIMITS.gtfsFeedRaw).toBe(200 * 1024 * 1024);
  });

  it("sets the GTFS limit above the feeds real US agencies actually publish", () => {
    // The numbers the comment on `gtfsFeedRaw` was written from. If a future
    // change lowers that limit, this fails and names the agency it would refuse.
    const measuredFeeds = [
      { agency: "CTA Chicago", bytes: 94 * 1024 * 1024 },
      { agency: "NJ Transit", bytes: 52 * 1024 * 1024 },
    ];

    for (const feed of measuredFeeds) {
      expect(BODY_LIMITS.gtfsFeedRaw, feed.agency).toBeGreaterThan(feed.bytes);
      // And the limits that existed before it would have refused these outright.
      expect(BODY_LIMITS.kbDocumentRaw).toBeLessThan(feed.bytes);
    }
  });

  it("keeps the transport ceiling above the GTFS lane's own archive limit", () => {
    // Two modules bound the same upload and they must not cross. `body-limit`
    // stops an absurd HTTP body; `gtfs/limits` refuses an over-large archive in
    // words a planner can act on. If this one were the lower of the two, every
    // over-large feed would meet a bare 413 instead of the explanation.
    expect(BODY_LIMITS.gtfsFeedRaw).toBeGreaterThanOrEqual(GTFS_MAX_ARCHIVE_BYTES.defaultValue);
  });

  it("parses JSON bodies under the byte limit", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ note: "x".repeat(1024) }),
    });

    const result = await readJsonWithLimit<{ note: string }>(request, 2048);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected body read to succeed");
    expect(result.data?.note).toHaveLength(1024);
    expect(result.parseError).toBeNull();
  });

  it("returns a 413 response for oversized bodies", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ note: "x".repeat(1024 * 1024) }),
    });

    const result = await readJsonWithLimit(request, 1024);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected body read to fail");
    expect(result.response.status).toBe(413);
    expect(result.byteLength).toBeGreaterThan(1024);
  });

  it("reads raw text bodies under the byte limit", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: "event payload",
    });

    const result = await readTextWithLimit(request, 1024);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected text body read to succeed");
    expect(result.text).toBe("event payload");
    expect(result.byteLength).toBe("event payload".length);
  });

  it("returns a 413 response for oversized raw text bodies", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: "x".repeat(2048),
    });

    const result = await readTextWithLimit(request, 1024);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected text body read to fail");
    expect(result.response.status).toBe(413);
  });
});

const CHUNK_BYTES = 1024 * 1024;

/**
 * A request whose body is produced on demand, counting what it hands over.
 *
 * `produced` is the whole point: a reader that checks the size AFTER buffering
 * pulls every chunk, so `produced` reaches the full body. A reader that checks
 * as it goes stops a chunk past the cap. Nothing else distinguishes the two —
 * both return the same 413 — which is why a test that only asserts the status
 * cannot tell streaming from buffering and would pass either way.
 */
function countingStreamRequest(totalChunks: number) {
  const counter = { produced: 0 };
  let emitted = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= totalChunks) {
        controller.close();
        return;
      }
      emitted += 1;
      counter.produced += CHUNK_BYTES;
      controller.enqueue(new Uint8Array(CHUNK_BYTES));
    },
  });

  const request = new Request("http://localhost/test", {
    method: "POST",
    body: stream,
    // Required by undici whenever the body is a stream. Not in the DOM types.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  return { request, counter, totalBytes: totalChunks * CHUNK_BYTES };
}

describe("readBytesWithLimitStreaming", () => {
  it("returns the same bytes as the buffering reader for a body under the limit", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    const streamed = await readBytesWithLimitStreaming(
      new Request("http://localhost/test", { method: "POST", body: payload }),
      1024,
    );
    const buffered = await readBytesWithLimit(
      new Request("http://localhost/test", { method: "POST", body: payload }),
      1024,
    );

    expect(streamed.ok).toBe(true);
    expect(buffered.ok).toBe(true);
    if (!streamed.ok || !buffered.ok) throw new Error("expected both reads to succeed");
    expect(Array.from(streamed.bytes)).toEqual(Array.from(buffered.bytes));
    expect(streamed.byteLength).toBe(buffered.byteLength);
  });

  it("reassembles a body that arrives in several chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });

    const result = await readBytesWithLimitStreaming(
      new Request("http://localhost/test", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      1024,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read to succeed");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(result.byteLength).toBe(5);
  });

  it("answers an oversized body with the same 413 the buffering reader gives", async () => {
    const payload = new Uint8Array(4096);

    const streamed = await readBytesWithLimitStreaming(
      new Request("http://localhost/test", { method: "POST", body: payload }),
      1024,
    );
    const buffered = await readBytesWithLimit(
      new Request("http://localhost/test", { method: "POST", body: payload }),
      1024,
    );

    expect(streamed.ok).toBe(false);
    expect(buffered.ok).toBe(false);
    if (streamed.ok || buffered.ok) throw new Error("expected both reads to fail");
    expect(streamed.response.status).toBe(413);
    expect(buffered.response.status).toBe(413);

    const streamedBody = await streamed.response.json();
    const bufferedBody = await buffered.response.json();
    expect(streamedBody).toEqual(bufferedBody);
    expect(streamedBody).toEqual({ error: "Request body too large", maxBytes: 1024 });
    expect(streamed.byteLength).toBeGreaterThan(1024);
  });

  it("stops pulling the body as soon as the limit is passed", async () => {
    const maxBytes = 4 * CHUNK_BYTES;
    const { request, counter, totalBytes } = countingStreamRequest(20);

    const result = await readBytesWithLimitStreaming(request, maxBytes);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the read to fail");
    expect(result.response.status).toBe(413);

    // THE ASSERTION THAT MATTERS. A buffering reader pulls all 20 MiB before it
    // compares anything; this must have stopped within one chunk of the cap.
    expect(counter.produced).toBeLessThanOrEqual(maxBytes + CHUNK_BYTES);
    expect(counter.produced).toBeLessThan(totalBytes);
    expect(result.byteLength).toBeLessThanOrEqual(maxBytes + CHUNK_BYTES);
  });

  it("reads a body that fits without truncating it, at the same scale", async () => {
    const { request, counter, totalBytes } = countingStreamRequest(6);

    const result = await readBytesWithLimitStreaming(request, 8 * CHUNK_BYTES);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read to succeed");
    expect(result.byteLength).toBe(totalBytes);
    expect(counter.produced).toBe(totalBytes);
  });

  it("falls back to the buffering reader when there is no stream to read", async () => {
    const request = new Request("http://localhost/test", { method: "GET" });
    expect(request.body).toBeNull();

    const result = await readBytesWithLimitStreaming(request, 1024);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read to succeed");
    expect(result.byteLength).toBe(0);
  });
});
