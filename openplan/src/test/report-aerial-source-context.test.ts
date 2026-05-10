import { describe, expect, it } from "vitest";

import { buildReportAerialEvidenceSourceContext } from "@/lib/reports/aerial-source-context";

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
});
