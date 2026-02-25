import { describe, expect, it } from "vitest";
import { sanitizeForAudit } from "@/lib/observability/audit";

describe("audit sanitization", () => {
  it("redacts sensitive keys recursively", () => {
    const payload = {
      token: "abc123",
      nested: {
        apiKey: "super-secret",
        authorization: "Bearer xyz",
      },
      safe: "hello",
    };

    const sanitized = sanitizeForAudit(payload) as Record<string, unknown>;
    const nested = sanitized.nested as Record<string, unknown>;

    expect(sanitized.token).toBe("[REDACTED]");
    expect(nested.apiKey).toBe("[REDACTED]");
    expect(nested.authorization).toBe("[REDACTED]");
    expect(sanitized.safe).toBe("hello");
  });

  it("serializes errors without throwing", () => {
    const err = new Error("boom");
    const sanitized = sanitizeForAudit({ error: err }) as Record<string, unknown>;

    const error = sanitized.error as Record<string, unknown>;
    expect(error.name).toBe("Error");
    expect(error.message).toContain("boom");
  });
});
