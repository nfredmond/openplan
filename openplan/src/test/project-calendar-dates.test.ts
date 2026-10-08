import { describe, expect, it } from "vitest";
import { fmtDateTime } from "@/app/(app)/projects/[projectId]/_components/_helpers";

describe("project calendar dates", () => {
  it.each([
    ["2026-12-15", "Dec 15, 2026"],
    ["2026-01-01", "Jan 1, 2026"],
    ["2024-02-29", "Feb 29, 2024"],
    ["2026-03-08", "Mar 8, 2026"],
  ])("keeps the calendar day without inventing a time: %s", (value, expected) => {
    expect(fmtDateTime(value)).toBe(expected);
  });

  it.each(["2026-02-29", "2026-02-31", "unreadable", "2026-13-01"])("preserves invalid input for review: %s", value => {
    expect(fmtDateTime(value)).toBe(value);
  });

  it("retains unknown rather than inventing a date", () => {
    expect(fmtDateTime(null)).toBe("Unknown");
    expect(fmtDateTime(undefined)).toBe("Unknown");
    expect(fmtDateTime("")).toBe("Unknown");
  });

  it("keeps timestamps as local instants", () => {
    const expected: Record<string, string> = {
      UTC: "12/15/2026, 12:00:00 AM",
      "America/Los_Angeles": "12/14/2026, 4:00:00 PM",
      "Pacific/Kiritimati": "12/15/2026, 2:00:00 PM",
    };
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(fmtDateTime("2026-12-15T00:00:00Z")).toBe(
      expected[zone] ?? new Date("2026-12-15T00:00:00Z").toLocaleString("en-US"),
    );
  });
});
