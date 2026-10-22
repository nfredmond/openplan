import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emptyActual } from "@/components/invoicing/contracts/actual-form";
import { ContractManagement } from "@/components/invoicing/contracts/contract-management";
import { deliveryFixture } from "./fixtures/contract-delivery";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

/**
 * CONTRACT FORM DATES DEFAULT TO TODAY ON THE WORKSPACE CALENDAR.
 *
 * Every contract form filled its date with `new Date().toISOString().slice(0, 10)`,
 * the UTC day. From 5 p.m. Pacific that is tomorrow, so an actual entered at
 * 6 p.m. was dated the next day unless the planner noticed and fixed it.
 * Expected dates are worked out by hand from each zone's offset on that date.
 */

const LA = "America/Los_Angeles";

beforeEach(() => {
  // Only the clock is faked; Testing Library still needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("a blank actual is dated today on the workspace calendar", () => {
  it("is still the 14th at 6 p.m. Pacific, when UTC is already the 15th", () => {
    vi.setSystemTime(new Date("2026-10-15T01:00:00Z"));
    expect(emptyActual(null, LA).entryDate).toBe("2026-10-14");
    expect(emptyActual(null, "Pacific/Honolulu").entryDate).toBe("2026-10-14");
    // No zone means UTC, the documented fallback.
    expect(emptyActual(null).entryDate).toBe("2026-10-15");
  });

  it("is already the 15th in Tokyo while UTC is the 14th", () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
    expect(emptyActual(null, "Asia/Tokyo").entryDate).toBe("2026-10-15");
    expect(emptyActual(null).entryDate).toBe("2026-10-14");
  });

  it("holds the day through the 25-hour night daylight saving time ends", () => {
    // 07:30 UTC Nov 2 is 11:30 p.m. PST Nov 1.
    vi.setSystemTime(new Date("2026-11-02T07:30:00Z"));
    expect(emptyActual(null, LA).entryDate).toBe("2026-11-01");
  });
});

describe("the contract page hands every form the workspace calendar", () => {
  function renderContract(timeZone: string) {
    const fixture = deliveryFixture();
    fixture.state.role = "admin";
    // No schedule yet, so the schedule form starts from its defaults.
    fixture.delivery.scheduleVersions = [];
    fixture.state.delivery = fixture.delivery;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<ContractManagement initial={fixture.state} timeZone={timeZone} />);
  }

  const section = (name: string) =>
    fireEvent.change(screen.getByLabelText("Contract section"), { target: { value: name } });
  const remainingWork = (name: string) =>
    fireEvent.change(screen.getByLabelText("Remaining work section"), { target: { value: name } });

  // 20:00 UTC Oct 14 is 1 p.m. Oct 14 in Los Angeles and 5 a.m. Oct 15 in Tokyo.
  for (const [timeZone, today] of [
    [LA, "2026-10-14"],
    ["Asia/Tokyo", "2026-10-15"],
  ] as const) {
    it(`defaults each form date to ${today} for a workspace in ${timeZone}`, () => {
      vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
      renderContract(timeZone);

      section("Actuals");
      expect(screen.getByLabelText("Entry date")).toHaveValue(today);

      section("Settlement");
      expect(screen.getByLabelText("Financial event date")).toHaveValue(today);

      section("Acceptance");
      expect(screen.getByLabelText("Deliverable event date")).toHaveValue(today);

      section("Closeout");
      expect(screen.getByLabelText("Closeout as-of date")).toHaveValue(today);

      section("Remaining work");
      expect(screen.getByLabelText("Remaining-work as-of date")).toHaveValue(today);
      remainingWork("Forecasts");
      expect(screen.getByLabelText("Forecast as-of date")).toHaveValue(today);

      remainingWork("Schedule");
      expect(screen.getByLabelText("Staff update required as of")).toHaveValue(today);
      fireEvent.click(screen.getByRole("button", { name: "Add work or review period" }));
      expect(screen.getAllByLabelText("Earliest expected start").at(-1)).toHaveValue(today);
      expect(screen.getAllByLabelText("Reserve capacity through").at(-1)).toHaveValue(today);
      fireEvent.click(screen.getAllByRole("button", { name: "Add dated exception" }).at(-1)!);
      expect(screen.getAllByLabelText("Exception date").at(-1)).toHaveValue(today);
    });
  }
});
