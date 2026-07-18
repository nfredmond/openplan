import { describe, expect, it } from "vitest";
import { formatDeadline } from "@/lib/grants/page-helpers";

// Records tracked from grants.gov synopses carry synthetic sentinel times
// (00:00:00Z opens, 23:59:59Z closes) because the API publishes dates only.
// Rendering those as precise local timestamps would fabricate a deadline
// time grants.gov never stated — sentinels must render date-only.
describe("formatDeadline", () => {
  it("renders the closes sentinel date-only with the NOFO pointer", () => {
    expect(formatDeadline("2026-08-31T23:59:59.000Z", "closes")).toBe(
      "Aug 31, 2026 (deadline time per NOFO)"
    );
  });

  it("renders the opens sentinel date-only without a pointer", () => {
    expect(formatDeadline("2026-07-06T00:00:00.000Z", "opens")).toBe("Jul 6, 2026");
  });

  it("keeps precise rendering for operator-entered real times", () => {
    const precise = "2026-08-31T17:00:00.000Z";
    expect(formatDeadline(precise, "closes")).toBe(new Date(precise).toLocaleString());
  });

  it("handles null and unparseable values like formatDateTime", () => {
    expect(formatDeadline(null, "closes")).toBe("Not set");
    expect(formatDeadline(undefined, "opens")).toBe("Not set");
    expect(formatDeadline("not-a-date", "closes")).toBe("not-a-date");
  });
});
