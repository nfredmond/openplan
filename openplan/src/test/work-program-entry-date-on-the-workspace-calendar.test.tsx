import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newActual } from "@/components/programs/work-program/actual-entry";
import { ReportingPanel } from "@/components/programs/work-program/reporting-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * A NEW WORK PROGRAM ENTRY IS DATED TODAY ON THE WORKSPACE CALENDAR.
 *
 * The entry date was `new Date().toISOString().slice(0, 10)`, the UTC day, so
 * time entered at 6 p.m. Pacific was dated tomorrow by default. Expected
 * dates are worked out by hand from each zone's offset on that date.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("newActual", () => {
  it("is still the 14th at 6 p.m. Pacific and 3 p.m. in Honolulu, when UTC is the 15th", () => {
    vi.setSystemTime(new Date("2026-10-15T01:00:00Z"));
    expect(newActual("r1", true, "America/Los_Angeles").entryDate).toBe("2026-10-14");
    expect(newActual("r1", true, "Pacific/Honolulu").entryDate).toBe("2026-10-14");
    expect(newActual("r1", true).entryDate).toBe("2026-10-15");
  });

  it("is already the 15th in Tokyo while UTC is the 14th", () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
    expect(newActual("r1", true, "Asia/Tokyo").entryDate).toBe("2026-10-15");
  });

  it("holds the day through the 25-hour night daylight saving time ends", () => {
    vi.setSystemTime(new Date("2026-11-02T07:30:00Z"));
    expect(newActual("r1", true, "America/Los_Angeles").entryDate).toBe("2026-11-01");
  });
});

describe("the reporting panel hands the entry form the workspace calendar", () => {
  const data = {
    canManage: false,
    staff: [],
    revisions: [{ id: "r1", revision: 1, content_json: { elements: [] }, content_sha256: "a".repeat(64), source_ids: [] }],
    periods: [],
    reports: [],
    events: [],
  };

  // 20:00 UTC Oct 14 is 1 p.m. Oct 14 in Los Angeles and 5 a.m. Oct 15 in Tokyo.
  for (const [timeZone, today] of [
    ["America/Los_Angeles", "2026-10-14"],
    ["Asia/Tokyo", "2026-10-15"],
  ] as const) {
    it(`dates a new entry ${today} for a workspace in ${timeZone}`, async () => {
      vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
      render(
        <ReportingPanel
          programId="00000000-0000-4000-8000-000000000004"
          workspaceId="00000000-0000-4000-8000-000000000001"
          userId="00000000-0000-4000-8000-000000000002"
          timeZone={timeZone}
        />
      );
      expect(await screen.findByLabelText("Entry date")).toHaveValue(today);
    });
  }
});
