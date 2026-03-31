import { describe, expect, it } from "vitest";
import {
  describeEvidenceChainSummary,
  getReportNavigationHref,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  matchesReportFreshnessFilter,
  matchesReportPostureFilter,
  normalizeReportFreshnessFilter,
  normalizeReportPostureFilter,
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

  it("formats compact evidence-chain posture for report surfaces", () => {
    expect(
      describeEvidenceChainSummary({
        linkedRunCount: 2,
        scenarioSetLinkCount: 1,
        projectRecordGroupCount: 4,
        totalProjectRecordCount: 6,
        engagementLabel: "Active",
        engagementItemCount: 9,
        engagementReadyForHandoffCount: 4,
        stageGateLabel: "Hold present",
        stageGatePassCount: 1,
        stageGateHoldCount: 1,
        stageGateBlockedGateLabel: "G02 · Agreements, Procurement, and Civil Rights Setup",
      })
    ).toMatchObject({
      headline: "2 linked runs · 1 scenario set · 6 project records",
      detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
      blockedGateDetail: "Blocked gate: G02 · Agreements, Procurement, and Civil Rights Setup",
    });
  });

  it("routes report links to the most relevant detail section", () => {
    expect(getReportNavigationHref("report-1", "Refresh recommended")).toBe(
      "/reports/report-1#drift-since-generation"
    );
    expect(getReportNavigationHref("report-1", "No packet")).toBe(
      "/reports/report-1#report-controls"
    );
    expect(getReportNavigationHref("report-1", "Packet current")).toBe(
      "/reports/report-1#evidence-chain-summary"
    );
  });

  it("normalizes and applies packet freshness filters", () => {
    expect(normalizeReportFreshnessFilter(undefined)).toBe("all");
    expect(normalizeReportFreshnessFilter("refresh")).toBe("refresh");
    expect(normalizeReportFreshnessFilter("nope")).toBe("all");

    expect(matchesReportFreshnessFilter("all", "Packet current")).toBe(true);
    expect(matchesReportFreshnessFilter("refresh", "Refresh recommended")).toBe(true);
    expect(matchesReportFreshnessFilter("refresh", "No packet")).toBe(false);
    expect(matchesReportFreshnessFilter("missing", "No packet")).toBe(true);
    expect(matchesReportFreshnessFilter("current", "Packet current")).toBe(true);
  });

  it("normalizes and applies evidence posture filters", () => {
    expect(normalizeReportPostureFilter(undefined)).toBe("all");
    expect(normalizeReportPostureFilter("evidence-backed")).toBe("evidence-backed");
    expect(normalizeReportPostureFilter("weird")).toBe("all");

    expect(
      matchesReportPostureFilter("all", {
        hasEvidenceChain: false,
        hasBlockedGovernance: false,
      })
    ).toBe(true);
    expect(
      matchesReportPostureFilter("evidence-backed", {
        hasEvidenceChain: true,
        hasBlockedGovernance: false,
      })
    ).toBe(true);
    expect(
      matchesReportPostureFilter("evidence-backed", {
        hasEvidenceChain: false,
        hasBlockedGovernance: false,
      })
    ).toBe(false);
    expect(
      matchesReportPostureFilter("governance-hold", {
        hasEvidenceChain: true,
        hasBlockedGovernance: true,
      })
    ).toBe(true);
    expect(
      matchesReportPostureFilter("no-evidence", {
        hasEvidenceChain: false,
        hasBlockedGovernance: false,
      })
    ).toBe(true);
  });
});
