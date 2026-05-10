import { describe, expect, it } from "vitest";

import {
  AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
  buildReportAerialEvidenceSourceContext,
  describeReportAerialEvidenceDisplayState,
  parseReportAerialEvidenceSourceContext,
} from "@/lib/reports/aerial-source-context";

describe("buildReportAerialEvidenceSourceContext", () => {
  it("returns null when no aerial rows are linked to the report", () => {
    expect(
      buildReportAerialEvidenceSourceContext({
        missions: [],
        packages: [],
      })
    ).toBeNull();
  });

  it("summarizes operator-reviewed aerial packages without autonomous or survey-grade claims", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-1",
          title: "SR 49 shoulder inventory",
          status: "complete",
          mission_type: "corridor_survey",
          project_id: "project-1",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: "2026-05-09T18:00:00.000Z",
        },
      ],
      packages: [
        {
          id: "package-1",
          mission_id: "mission-1",
          title: "SR 49 orthomosaic QA bundle",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator reviewed imagery against field notes on 2026-05-09.",
          updated_at: "2026-05-09T18:10:00.000Z",
        },
      ],
    });

    expect(context).toMatchObject({
      metadataSchemaVersion: "2026-05-aerial-report-source-context",
      missionCount: 1,
      packageCount: 1,
      orphanPackageCount: 0,
      readiness: "ready",
      label: "Aerial evidence source context attached",
      attachmentReadyPackageCount: 1,
      sourceContextPackageCount: 1,
      operatorAssisted: true,
      autonomousPhotogrammetryClaim: false,
      regulatoryComplianceClaim: false,
      surveyGradeCertificationClaim: false,
      blockers: [],
    });
    expect(context?.readyUses).toEqual(["project", "grant", "report", "public_response"]);
    expect(context?.sourceContext).toContain("SR 49 orthomosaic QA bundle");
    expect(context?.sourceContext).toContain("Operator-assisted aerial evidence only");
    expect(context?.sourceContext).toContain("No autonomous photogrammetry");
    expect(context?.missionSummaries[0]).toMatchObject({
      missionId: "mission-1",
      readiness: "ready",
      packageCount: 1,
    });
  });

  it("keeps verification-ready packages in source-context review when package notes are missing", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-2",
          title: "Curb ramp capture",
          status: "complete",
          mission_type: "site_inspection",
          project_id: "project-2",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: null,
        },
      ],
      packages: [
        {
          id: "package-2",
          mission_id: "mission-2",
          title: "Curb ramp photo set",
          status: "shared",
          verification_readiness: "ready",
          notes: " ",
          updated_at: null,
        },
      ],
    });

    expect(context).toMatchObject({
      readiness: "needs_source_context",
      attachmentReadyPackageCount: 1,
      sourceContextPackageCount: 0,
      readyUses: [],
      blockedUses: ["project", "grant", "report", "public_response"],
    });
    expect(context?.blockers).toContain(
      "Add package notes or source-context text so reviewers can cite what the aerial evidence actually supports."
    );
    expect(context?.sourceContext).toContain("source context is incomplete");
  });

  it("blocks orphan packages that cannot be traced to a loaded mission record", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [],
      packages: [
        {
          id: "package-3",
          mission_id: "missing-mission",
          title: "Unlinked export bundle",
          status: "ready",
          verification_readiness: "ready",
          notes: "QA note exists but the mission row was not loaded.",
          updated_at: "2026-05-09T20:00:00.000Z",
        },
      ],
    });

    expect(context).toMatchObject({
      readiness: "blocked",
      missionCount: 0,
      packageCount: 1,
      orphanPackageCount: 1,
      attachmentReadyPackageCount: 0,
      sourceContextPackageCount: 0,
      readyUses: [],
      blockedUses: ["project", "grant", "report", "public_response"],
    });
    expect(context?.blockers).toContain(
      "1 aerial evidence package references a mission that was not loaded into the report source context."
    );
    expect(context?.sourceContext).toContain("not traceable to a loaded mission record");
  });

  it("parses persisted helper output for report-adjacent provenance rendering", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-4",
          title: "Bridge approach photos",
          status: "complete",
          mission_type: "site_inspection",
          project_id: "project-4",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: "2026-05-09T21:00:00.000Z",
        },
      ],
      packages: [
        {
          id: "package-4",
          mission_id: "mission-4",
          title: "Bridge approach annotated photos",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator checked the photos against the field log; not survey-grade.",
          updated_at: "2026-05-09T21:15:00.000Z",
        },
      ],
    });

    const parsed = parseReportAerialEvidenceSourceContext(context);

    expect(parsed).toMatchObject({
      readiness: "ready",
      label: "Aerial evidence source context attached",
      operatorAssisted: true,
      autonomousPhotogrammetryClaim: false,
      regulatoryComplianceClaim: false,
      surveyGradeCertificationClaim: false,
      missionSummaries: [
        {
          missionId: "mission-4",
          title: "Bridge approach photos",
          readiness: "ready",
        },
      ],
    });
  });

  it("returns an absent display state with the operator-assisted caveat when no report-adjacent aerial context exists", () => {
    const display = describeReportAerialEvidenceDisplayState(null);

    expect(display).toMatchObject({
      posture: "absent",
      label: "No aerial evidence source context captured",
      missionCount: 0,
      packageCount: 0,
      sourceContextPackageCount: 0,
      caveat: AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
      missionHref: null,
    });
    expect(display.detail).toContain("no report-adjacent aerial provenance");
    expect(display.blockers).toContain(
      "No report-adjacent aerial source context was captured in the latest artifact."
    );
    expect(display.caveat).toContain("No autonomous photogrammetry");
    expect(display.caveat).toContain("regulatory compliance");
    expect(display.caveat).toContain("survey-grade certification");
  });

  it("describes ready aerial evidence for report display with caveat and mission link", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-display-ready",
          title: "Ready aerial display mission",
          status: "complete",
          mission_type: "corridor_survey",
          project_id: "project-display",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: "2026-05-09T22:00:00.000Z",
        },
      ],
      packages: [
        {
          id: "package-display-ready",
          mission_id: "mission-display-ready",
          title: "Ready display package",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator reviewed package for report context.",
          updated_at: "2026-05-09T22:10:00.000Z",
        },
      ],
    });

    const display = describeReportAerialEvidenceDisplayState(context);

    expect(display).toMatchObject({
      posture: "ready",
      label: "Aerial evidence source context attached",
      missionCount: 1,
      packageCount: 1,
      sourceContextPackageCount: 1,
      blockers: [],
      caveat: AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
      missionHref: "/aerial/missions/mission-display-ready",
    });
  });

  it("describes source-context-needed aerial evidence for report display with caveat and blocker", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-display-needs-context",
          title: "Needs context aerial mission",
          status: "complete",
          mission_type: "site_inspection",
          project_id: "project-display",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: null,
        },
      ],
      packages: [
        {
          id: "package-display-needs-context",
          mission_id: "mission-display-needs-context",
          title: "Needs context package",
          status: "ready",
          verification_readiness: "ready",
          notes: " ",
          updated_at: null,
        },
      ],
    });

    const display = describeReportAerialEvidenceDisplayState(context);

    expect(display).toMatchObject({
      posture: "needs_source_context",
      label: "Aerial evidence source context needed",
      missionCount: 1,
      packageCount: 1,
      sourceContextPackageCount: 0,
      caveat: AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
      missionHref: "/aerial/missions/mission-display-needs-context",
    });
    expect(display.blockers).toContain(
      "Add package notes or source-context text so reviewers can cite what the aerial evidence actually supports."
    );
  });

  it("describes blocked aerial evidence for report display with caveat and no mission link when only orphan packages exist", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [],
      packages: [
        {
          id: "package-display-blocked",
          mission_id: "missing-display-mission",
          title: "Blocked package",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator note exists but mission provenance is missing.",
          updated_at: "2026-05-09T22:20:00.000Z",
        },
      ],
    });

    const display = describeReportAerialEvidenceDisplayState(context);

    expect(display).toMatchObject({
      posture: "blocked",
      label: "Aerial evidence blocked for report attachment",
      missionCount: 0,
      packageCount: 1,
      sourceContextPackageCount: 0,
      caveat: AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
      missionHref: null,
    });
    expect(display.blockers).toContain(
      "1 aerial evidence package references a mission that was not loaded into the report source context."
    );
  });

  it("fails closed when persisted metadata implies unsafe autonomous or certification claims", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-5",
          title: "Unsafe claim fixture",
          status: "complete",
          mission_type: "corridor_survey",
          project_id: "project-5",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: null,
        },
      ],
      packages: [],
    });

    expect(
      parseReportAerialEvidenceSourceContext({
        ...context,
        autonomousPhotogrammetryClaim: true,
      })
    ).toBeNull();
    expect(
      parseReportAerialEvidenceSourceContext({
        ...context,
        surveyGradeCertificationClaim: true,
      })
    ).toBeNull();
  });
});
