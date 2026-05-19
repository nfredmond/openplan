import { describe, expect, it } from "vitest";
import { BODY_LIMITS, readJsonWithLimit, readTextWithLimit } from "@/lib/http/body-limit";

describe("readJsonWithLimit", () => {
  it("keeps the shared body limit constants explicit", () => {
    expect(BODY_LIMITS.adminTriageJson).toBe(4 * 1024);
    expect(BODY_LIMITS.smallJson).toBe(16 * 1024);
    expect(BODY_LIMITS.normalJson).toBe(64 * 1024);
    expect(BODY_LIMITS.documentJson).toBe(256 * 1024);
    expect(BODY_LIMITS.networkGeoJson).toBe(2 * 1024 * 1024);
    expect(BODY_LIMITS.stripeWebhookRaw).toBe(256 * 1024);
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
