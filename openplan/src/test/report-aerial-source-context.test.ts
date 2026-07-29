import { describe, expect, it, vi } from "vitest";

import {
  AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
  buildReportAerialEvidenceReadFailureContext,
  buildReportAerialEvidenceSourceContext,
  describeReportAerialEvidenceDisplayState,
  parseReportAerialEvidenceSourceContext,
} from "@/lib/reports/aerial-source-context";
import { loadAerialSourceContextRowsForProject } from "@/lib/aerial/queries";
import { expectProvenanceLanguageOnly } from "./provenance-language-guards";

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
    expectProvenanceLanguageOnly(`${display.label} ${display.detail} ${display.caveat} ${display.blockers.join(" ")}`);
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
    expect(display.caveat).toContain("No autonomous photogrammetry");
    expectProvenanceLanguageOnly(`${display.label} ${display.detail} ${display.caveat}`);
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

describe("aerial evidence retrievability disclosure", () => {
  it("states that OpenPlan holds the package record, not a retrievable artifact", () => {
    // The processing callback records the worker's own signed URLs verbatim,
    // each with its expiry, and OpenPlan never re-hosts the bytes. A packet
    // that lists an artifact must not imply it can still be fetched.
    expect(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT).toContain("time-limited signed URLs");
    expect(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT).toContain("may already have expired");
    expect(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT).toContain("still retrievable");
    expectProvenanceLanguageOnly(AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT);
  });

  it("carries the retrievability disclosure into a ready packet's rendered display state", () => {
    const context = buildReportAerialEvidenceSourceContext({
      missions: [
        {
          id: "mission-retrievability",
          title: "Retrievability mission",
          status: "complete",
          mission_type: "corridor_survey",
          project_id: "project-retrievability",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: "2026-05-09T23:00:00.000Z",
        },
      ],
      packages: [
        {
          id: "package-retrievability",
          mission_id: "mission-retrievability",
          title: "Reviewed package",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator reviewed the package for report context.",
          updated_at: "2026-05-09T23:10:00.000Z",
        },
      ],
    });

    const display = describeReportAerialEvidenceDisplayState(context);

    expect(display.posture).toBe("ready");
    expect(display.caveat).toContain("may already have expired");
    expect(context?.sourceContext).toContain("may already have expired");
  });
});

describe("buildReportAerialEvidenceReadFailureContext", () => {
  it("reports an unreadable aerial source as blocked with the real reason", () => {
    const context = buildReportAerialEvidenceReadFailureContext(
      "The aerial tables are not present in this database, so aerial missions for this project could not be read."
    );

    expect(context).toMatchObject({
      readiness: "blocked",
      label: "Aerial evidence could not be read",
      missionCount: 0,
      packageCount: 0,
      readyUses: [],
      blockedUses: ["project", "grant", "report", "public_response"],
      operatorAssisted: true,
      autonomousPhotogrammetryClaim: false,
      surveyGradeCertificationClaim: false,
    });
    expect(context.detail).toContain("could not be read");
    expect(context.blockers).toEqual([context.detail]);
    expect(context.sourceContext).toContain(
      "No aerial claim in this packet is supported by a read of the aerial records."
    );
    expectProvenanceLanguageOnly(`${context.label} ${context.detail} ${context.sourceContext}`);
  });

  it("does not describe a failed read the way it describes a project with no aerial work", () => {
    const failure = describeReportAerialEvidenceDisplayState(
      buildReportAerialEvidenceReadFailureContext("Aerial missions could not be read: timeout")
    );
    const absent = describeReportAerialEvidenceDisplayState(null);

    expect(failure.posture).toBe("blocked");
    expect(absent.posture).toBe("absent");
    expect(failure.label).not.toBe(absent.label);
  });

  it("survives the persisted round trip so the provenance panel can render it", () => {
    const context = buildReportAerialEvidenceReadFailureContext("Aerial missions could not be read: timeout");

    expect(parseReportAerialEvidenceSourceContext(JSON.parse(JSON.stringify(context)))).toMatchObject({
      readiness: "blocked",
      label: "Aerial evidence could not be read",
    });
  });
});

describe("loadAerialSourceContextRowsForProject", () => {
  const PROJECT_ID = "project-1";

  type QueryResult = { data: unknown; error: { message: string } | null };

  /**
   * Minimal PostgREST-shaped stub: `.select().eq()/.in().order()` resolves to
   * the canned result for that table + filter column.
   */
  function stubClient(results: {
    missions?: QueryResult;
    packagesByProject?: QueryResult;
    packagesByMission?: QueryResult;
  }) {
    const calls: Array<{ table: string; column: string; value: unknown }> = [];
    const ok = (data: unknown): QueryResult => ({ data, error: null });

    const from = vi.fn((table: string) => ({
      select: () => {
        const chain = (column: string, value: unknown) => {
          calls.push({ table, column, value });
          const result =
            table === "aerial_missions"
              ? results.missions ?? ok([])
              : column === "project_id"
                ? results.packagesByProject ?? ok([])
                : results.packagesByMission ?? ok([]);
          return { order: () => Promise.resolve(result) };
        };
        return {
          eq: (column: string, value: unknown) => chain(column, value),
          in: (column: string, value: unknown) => chain(column, value),
        };
      },
    }));

    return { client: { from } as unknown as Parameters<typeof loadAerialSourceContextRowsForProject>[0], calls };
  }

  it("reads zero rows as zero rows, not as a failure", async () => {
    const { client } = stubClient({});

    await expect(loadAerialSourceContextRowsForProject(client, PROJECT_ID)).resolves.toEqual({
      missions: [],
      packages: [],
      unreadableReason: null,
    });
  });

  it("names a pending aerial schema instead of answering with an empty result", async () => {
    const { client } = stubClient({
      missions: { data: null, error: { message: 'relation "public.aerial_missions" does not exist' } },
    });

    const rows = await loadAerialSourceContextRowsForProject(client, PROJECT_ID);

    expect(rows.missions).toEqual([]);
    expect(rows.unreadableReason).toContain("aerial tables are not present");
  });

  it("names a package read failure instead of dropping the packages silently", async () => {
    const { client } = stubClient({
      missions: {
        data: [{ id: "mission-1", title: "M", status: "complete", mission_type: "corridor_survey", project_id: PROJECT_ID, aoi_geojson: {}, updated_at: null }],
        error: null,
      },
      packagesByProject: { data: null, error: { message: "statement timeout" } },
    });

    const rows = await loadAerialSourceContextRowsForProject(client, PROJECT_ID);

    expect(rows.missions).toEqual([]);
    expect(rows.packages).toEqual([]);
    expect(rows.unreadableReason).toContain("statement timeout");
  });

  it("keeps a package whose mission is not in the project so it can be reported as untraceable", async () => {
    const { client, calls } = stubClient({
      missions: {
        data: [
          {
            id: "mission-1",
            title: "In-project mission",
            status: "complete",
            mission_type: "corridor_survey",
            project_id: PROJECT_ID,
            aoi_geojson: { type: "Polygon", coordinates: [] },
            updated_at: null,
          },
        ],
        error: null,
      },
      packagesByProject: {
        data: [
          {
            id: "package-orphan",
            mission_id: "mission-elsewhere",
            title: "Orphan package",
            status: "ready",
            verification_readiness: "ready",
            notes: "Reviewed.",
            updated_at: null,
          },
        ],
        error: null,
      },
      packagesByMission: {
        data: [
          {
            id: "package-in-mission",
            mission_id: "mission-1",
            title: "Traceable package",
            status: "ready",
            verification_readiness: "ready",
            notes: "Reviewed.",
            updated_at: null,
          },
        ],
        error: null,
      },
    });

    const rows = await loadAerialSourceContextRowsForProject(client, PROJECT_ID);

    expect(rows.packages.map((row) => row.id).sort()).toEqual([
      "package-in-mission",
      "package-orphan",
    ]);
    expect(calls).toContainEqual({ table: "aerial_evidence_packages", column: "project_id", value: PROJECT_ID });
    expect(calls).toContainEqual({
      table: "aerial_evidence_packages",
      column: "mission_id",
      value: ["mission-1"],
    });

    const context = buildReportAerialEvidenceSourceContext(rows);
    expect(context?.orphanPackageCount).toBe(1);
  });

  it("does not return the same package twice when both lookups find it", async () => {
    const pkg = {
      id: "package-1",
      mission_id: "mission-1",
      title: "Shared package",
      status: "ready",
      verification_readiness: "ready",
      notes: "Reviewed.",
      updated_at: null,
    };
    const { client } = stubClient({
      missions: {
        data: [
          {
            id: "mission-1",
            title: "Mission",
            status: "complete",
            mission_type: "corridor_survey",
            project_id: PROJECT_ID,
            aoi_geojson: { type: "Polygon", coordinates: [] },
            updated_at: null,
          },
        ],
        error: null,
      },
      packagesByProject: { data: [pkg], error: null },
      packagesByMission: { data: [pkg], error: null },
    });

    const rows = await loadAerialSourceContextRowsForProject(client, PROJECT_ID);

    expect(rows.packages).toHaveLength(1);
    expect(buildReportAerialEvidenceSourceContext(rows)).toMatchObject({
      packageCount: 1,
      orphanPackageCount: 0,
      readiness: "ready",
    });
  });
});
