import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeErrorReport, scrubPath } from "@/lib/observability/error-report";
import { forwardToSentry, parseSentryDsn } from "@/lib/observability/sentry-envelope";

const token = "550e8400-e29b-41d4-a716-446655440000";
afterEach(() => vi.unstubAllEnvs());

describe("error report recovery", () => {
  it("refuses malformed DSN encoding without throwing", () => {
    for (const key of ["%ZZ", "%", "%C3%28"]) {
      expect(parseSentryDsn(`https://${key}@errors.example/123`)).toBeNull();
    }
  });

  it("keeps a valid encoded DSN key and self-hosted path", () => {
    expect(parseSentryDsn("https://public%2Dkey@errors.example/installation/123"), "Valid encoded DSN must retain its original decoded key").toEqual({
      endpoint: "https://errors.example/installation/api/123/envelope/",
      publicKey: "public-key",
    });
  });

  it("does not reject reporting when the configured DSN has malformed encoding", async () => {
    vi.stubEnv("OPENPLAN_SENTRY_DSN", "https://%ZZ@errors.example/123");
    const report = normalizeErrorReport({ boundary: "maps-error", message: "Map did not load" });
    expect(report).not.toBeNull();
    await expect(forwardToSentry(report!, "server")).resolves.toBe(false);
  });

  it("scrubs UUID-shaped tokens under each known public token parent", () => {
    for (const parent of ["engage", "embed", "plan", "measure", "invitations", "land-use-plans"]) {
      expect(scrubPath(`/${parent}/${token}?lang=es`), "Known public token parents must scrub UUID-shaped tokens").toBe(`/${parent}/[token]`);
    }
  });

  it("removes UUID-shaped public path tokens from the actual normalized report", () => {
    const report = normalizeErrorReport({ boundary: "portal-error", path: `/engage/${token}/about` });
    expect(report?.path, "Normalized reports must remove UUID-shaped public tokens").toBe("/engage/[token]/about");
    expect(JSON.stringify(report)).not.toContain(token);
  });

  it("keeps ordinary record identity outside public token parents", () => {
    expect(scrubPath(`/projects/${token}/overview`), "Ordinary record identity must survive report scrubbing").toBe(`/projects/${token}/overview`);
  });
});
