import { afterEach, describe, expect, it, vi } from "vitest";
import { formatResult, runPreflight } from "../../scripts/ops/check-admin-operations-smoke-prereqs.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("admin operations smoke preflight script", () => {
  it("requires an explicit reviewer email even when network checks are skipped", async () => {
    vi.stubEnv("OPENPLAN_ADMIN_OPERATIONS_SMOKE_REVIEWER_EMAIL", "");

    await expect(runPreflight(["--skip-network"])).rejects.toThrow(
      "--reviewer-email is required for a reproducible authenticated smoke",
    );
  });

  it("keeps --skip-network read-only and documents the skipped network checks", async () => {
    vi.stubEnv("OPENPLAN_ADMIN_OPERATIONS_SMOKE_REVIEWER_EMAIL", "");
    vi.stubEnv("OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS", "reviewer@example.com,other@example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network should not be called"));

    const result = await runPreflight([
      "--origin",
      "https://openplan-natford.vercel.app",
      "--reviewer-email",
      "Reviewer@Example.com",
      "--skip-network",
    ]);
    const rendered = formatResult(result);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.checks).toEqual(
      expect.arrayContaining([
        "reviewer email accepted (r***@example.com)",
        "OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS is present locally and contains the reviewer email.",
      ]),
    );
    expect(result.warnings).toContain("network checks skipped by --skip-network");
    expect(rendered).toContain("OpenPlan admin operations smoke preflight passed with warnings.");
    expect(rendered).toContain("WARN network checks skipped by --skip-network");
    expect(rendered).toContain("Do not click triage buttons, create workspaces, send email, or record prospect PII");
    expect(rendered).not.toContain("Reviewer@Example.com");
    expect(rendered).not.toContain("reviewer@example.com,other@example.com");
  });
});
