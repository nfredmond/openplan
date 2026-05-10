import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReportProvenanceAudit } from "@/app/(app)/reports/[reportId]/_components/report-provenance-audit";
import {
  AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
  buildReportAerialEvidenceSourceContext,
  type ReportAerialEvidenceSourceContext,
} from "@/lib/reports/aerial-source-context";

type ReportProvenanceAuditProps = Parameters<typeof ReportProvenanceAudit>[0];

function baseProps(
  aerialEvidenceSourceContext: ReportAerialEvidenceSourceContext | null,
  sourceContext: Record<string, unknown> | null = { linkedRunCount: 0 }
): ReportProvenanceAuditProps {
  return {
    runAudit: [],
    runs: [],
    runTitleById: new Map(),
    sourceContext,
    engagementCampaign: null,
    engagementPublicHref: null,
    engagementSummaryText: null,
    reportOrigin: null,
    reportReason: null,
    engagementSnapshotCapturedAt: null,
    engagementSnapshotTotalItems: null,
    engagementSnapshotReadyForHandoff: null,
    aerialEvidenceSourceContext,
    evidenceChainSummary: {
      linkedRunCount: 0,
      scenarioSetLinkCount: 0,
      scenarioAssumptionSetCount: 0,
      scenarioDataPackageCount: 0,
      scenarioIndicatorSnapshotCount: 0,
      scenarioSharedSpinePendingCount: 0,
      projectRecordGroupCount: 0,
      totalProjectRecordCount: 0,
      engagementLabel: "Not linked",
      engagementItemCount: 0,
      engagementReadyForHandoffCount: 0,
      stageGateLabel: "In progress",
      stageGatePassCount: 0,
      stageGateHoldCount: 0,
      stageGateBlockedGateLabel: null,
      modelingEvidenceCount: 0,
      modelingEvidenceClaimLabel: "Not linked",
    },
    storedScenarioSpineSummary: null,
    projectId: null,
    projectUpdatedAt: null,
    driftItems: [],
    driftActionByKey: {},
    stageGateSnapshot: null,
    projectRecordsSnapshot: [],
    scenarioSetLinks: [],
    comparisonDigest: null,
  };
}

function readyContext(): ReportAerialEvidenceSourceContext {
  const context = buildReportAerialEvidenceSourceContext({
    missions: [
      {
        id: "mission-ready-ui",
        title: "Ready UI mission",
        status: "complete",
        mission_type: "corridor_survey",
        project_id: "project-1",
        aoi_geojson: { type: "Polygon", coordinates: [] },
        updated_at: "2026-05-09T22:00:00.000Z",
      },
    ],
    packages: [
      {
        id: "package-ready-ui",
        mission_id: "mission-ready-ui",
        title: "Ready UI package",
        status: "ready",
        verification_readiness: "ready",
        notes: "Operator reviewed package for report context.",
        updated_at: "2026-05-09T22:10:00.000Z",
      },
    ],
  });

  if (!context) throw new Error("Expected ready aerial context");
  return context;
}

function needsSourceContext(): ReportAerialEvidenceSourceContext {
  const context = buildReportAerialEvidenceSourceContext({
    missions: [
      {
        id: "mission-needs-ui",
        title: "Needs source context UI mission",
        status: "complete",
        mission_type: "site_inspection",
        project_id: "project-1",
        aoi_geojson: { type: "Polygon", coordinates: [] },
        updated_at: null,
      },
    ],
    packages: [
      {
        id: "package-needs-ui",
        mission_id: "mission-needs-ui",
        title: "Needs source context UI package",
        status: "ready",
        verification_readiness: "ready",
        notes: " ",
        updated_at: null,
      },
    ],
  });

  if (!context) throw new Error("Expected needs-source-context aerial context");
  return context;
}

function blockedContext(): ReportAerialEvidenceSourceContext {
  const context = buildReportAerialEvidenceSourceContext({
    missions: [],
    packages: [
      {
        id: "package-blocked-ui",
        mission_id: "missing-ui-mission",
        title: "Blocked UI package",
        status: "ready",
        verification_readiness: "ready",
        notes: "Operator note exists but mission provenance is missing.",
        updated_at: "2026-05-09T22:20:00.000Z",
      },
    ],
  });

  if (!context) throw new Error("Expected blocked aerial context");
  return context;
}

describe("ReportProvenanceAudit aerial evidence display", () => {
  it("surfaces an absent aerial provenance state when the packet has source context but no aerial context", () => {
    render(<ReportProvenanceAudit {...baseProps(null)} />);

    expect(screen.getByText("Aerial evidence")).toBeInTheDocument();
    expect(screen.getByText("No aerial evidence source context captured")).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();
    expect(screen.getByText(/no report-adjacent aerial provenance/i)).toBeInTheDocument();
    expect(screen.getByText(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open aerial mission/i })).not.toBeInTheDocument();
  });

  it("renders ready aerial evidence with caveat and mission link", () => {
    render(<ReportProvenanceAudit {...baseProps(readyContext())} />);

    expect(screen.getByText("Aerial evidence source context attached")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText(/1 mission · 1 package · 1 source-context package/i)).toBeInTheDocument();
    expect(screen.getByText(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open aerial mission/i })).toHaveAttribute(
      "href",
      "/aerial/missions/mission-ready-ui"
    );
  });

  it("renders source-context-needed aerial evidence with caveat and blocker", () => {
    render(<ReportProvenanceAudit {...baseProps(needsSourceContext())} />);

    expect(screen.getByText("Aerial evidence source context needed")).toBeInTheDocument();
    expect(screen.getByText("Needs Source Context")).toBeInTheDocument();
    expect(screen.getByText(/0 source-context packages/i)).toBeInTheDocument();
    expect(screen.getByText(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Add package notes or source-context text so reviewers can cite/i)
        .length
    ).toBeGreaterThan(0);
  });

  it("renders blocked aerial evidence with caveat and no mission link when mission provenance is absent", () => {
    render(<ReportProvenanceAudit {...baseProps(blockedContext())} />);

    expect(screen.getByText("Aerial evidence blocked for report attachment")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText(/0 missions · 1 package · 0 source-context packages/i)).toBeInTheDocument();
    expect(screen.getByText(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT)).toBeInTheDocument();
    expect(
      screen.getAllByText(/1 aerial evidence package references a mission that was not loaded/i)
        .length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Open aerial mission/i })).not.toBeInTheDocument();
  });

  it("surfaces scenario comparison source-context readiness in the audit trail", () => {
    render(
      <ReportProvenanceAudit
        {...baseProps(null)}
        comparisonDigest={{
          headline: "2 source-context-backed comparisons",
          detail:
            "1 export-ready comparison and 2 caveat-backed snapshots are available for operator review.",
        }}
      />
    );

    expect(screen.getByText("Scenario comparison source context")).toBeInTheDocument();
    expect(screen.getByText("2 source-context-backed comparisons")).toBeInTheDocument();
    expect(screen.getByText(/confirm assumptions, source context, export readiness, and caveats/i)).toBeInTheDocument();
  });
});
