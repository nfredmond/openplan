import { describe, expect, it } from "vitest";
import { compareCallbackTimes } from "@/lib/aerial/callback-order";

describe("callback instants", () => {
  it("preserves fractional seconds beyond JavaScript and database precision", () => {
    expect(compareCallbackTimes("2026-10-14T06:00:00.1234568Z", "2026-10-14T06:00:00.1234567Z"), "Callback ordering keeps all fractional digits").toBe(1);
    expect(compareCallbackTimes("2026-10-14T06:00:00.09Z", "2026-10-14T06:00:00.1Z"), "Fractions compare as decimal values").toBe(-1);
  });
  it("compares equal instants across offsets and trailing zeros", () => {
    expect(compareCallbackTimes("2026-10-14T01:00:00.1200-05:00", "2026-10-14T06:00:00.12Z"), "Offsets identify the same instant").toBe(0);
    expect(compareCallbackTimes("2026-10-14T06:00:00Z", "2026-10-14T06:00:00.000Z"), "Absent fraction and zero fraction are equal").toBe(0);
  });
  it("orders different whole seconds before their fractional values", () => {
    expect(compareCallbackTimes("2026-10-14T06:00:01Z", "2026-10-14T06:00:00.999999Z"), "Whole seconds order callbacks first").toBe(1);
  });
  it("refuses invalid or unzoned instants", () => {
    for (const value of ["bad time", "2026-10-14T06:00:00", "2026-99-99T06:00:00Z"]) {
      expect(compareCallbackTimes(value, "2026-10-14T06:00:00Z"), "Unknown callback time has no fabricated order").toBeNull();
    }
  });
});
