import { describe, expect, it } from "vitest";
import { readJsonWithLimit } from "@/lib/http/body-limit";

describe("readJsonWithLimit", () => {
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
});
