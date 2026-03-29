import { describe, expect, it } from "vitest";
import {
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
} from "@/lib/reports/catalog";

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

  it("returns action labels for each freshness state", () => {
    expect(getReportPacketActionLabel("Refresh recommended")).toMatch(/regenerate the packet/i);
    expect(getReportPacketActionLabel("No packet")).toMatch(/generate the first packet/i);
    expect(getReportPacketActionLabel("Packet current")).toMatch(/review the packet/i);
  });

  it("prioritizes stale and missing packets ahead of current ones", () => {
    expect(getReportPacketPriority("Refresh recommended")).toBeLessThan(getReportPacketPriority("No packet"));
    expect(getReportPacketPriority("No packet")).toBeLessThan(getReportPacketPriority("Packet current"));
  });
});
