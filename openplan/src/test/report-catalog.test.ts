import { describe, expect, it } from "vitest";
import { getReportPacketFreshness } from "@/lib/reports/catalog";

describe("getReportPacketFreshness", () => {
  it("returns no-packet when no artifact exists", () => {
    expect(
      getReportPacketFreshness({
        latestArtifactKind: null,
        generatedAt: null,
        updatedAt: "2026-03-28T20:00:00.000Z",
      })
    ).toMatchObject({ label: "No packet", tone: "warning" });
  });

  it("returns refresh recommended when the report record changed after generation", () => {
    expect(
      getReportPacketFreshness({
        latestArtifactKind: "html",
        generatedAt: "2026-03-28T19:00:00.000Z",
        updatedAt: "2026-03-28T20:00:00.000Z",
      })
    ).toMatchObject({ label: "Refresh recommended", tone: "warning" });
  });

  it("returns packet current when the latest packet is still current", () => {
    expect(
      getReportPacketFreshness({
        latestArtifactKind: "html",
        generatedAt: "2026-03-28T20:00:00.000Z",
        updatedAt: "2026-03-28T20:00:00.000Z",
      })
    ).toMatchObject({ label: "Packet current", tone: "success" });
  });
});
