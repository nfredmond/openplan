import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import {
  describeReportSourceReviewPosture,
  ReportDetailControls,
} from "@/components/reports/report-detail-controls";

describe("ReportDetailControls", () => {
  it("offers held orthophotos without automatically selecting one and saves only a planner choice", async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: { body?: unknown }) => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ReportDetailControls
        report={{ id: "33333333-3333-4333-8333-333333333333", title: "Aerial packet", summary: null, status: "draft", hasGeneratedArtifact: false }}
        aerialOrthoCatalog={{
          state: "verified",
          notes: [],
          layers: [{
            custodyId: "55555555-5555-4555-8555-555555555555",
            missionId: "66666666-6666-4666-8666-666666666666",
            projectId: "22222222-2222-4222-8222-222222222222",
            missionTitle: "River crossing flight",
            projectName: "River crossing",
            collectedAt: "2026-08-20T17:00:00.000Z",
            heldAt: "2026-08-21T17:00:00.000Z",
            checksumSha256: "a".repeat(64),
            byteSize: 100,
            bounds: [-121.2, 39.1, -121.1, 39.2],
            nativeCrs: "EPSG:32610",
            pixelSizeM: 0.08,
          }],
        }}
      />
    );
    expect(screen.getByRole("radio", { name: /Do not include aerial imagery/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /River crossing flight/i })).not.toBeChecked();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /River crossing flight/i }));
    expect(screen.getByRole("button", { name: /Generate PDF packet/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Save metadata/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      aerialOrthoSelections: [{ custodyId: "55555555-5555-4555-8555-555555555555" }],
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate PDF packet/i })).toBeEnabled());
    vi.unstubAllGlobals();
  });

  it("preselects the exact Safety acquisition carried from the workbench and saves it", async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: { body?: unknown }) => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ReportDetailControls
        report={{ id: "report-1", title: "Safety packet", summary: null, status: "draft", hasGeneratedArtifact: false }}
        safetyIngestOptions={[{
          id: "55555555-5555-4555-8555-555555555555",
          sourceLabel: "State crash source",
          createdAt: "2026-08-26T08:00:00.000Z",
          crashCount: 390,
          geocodedCount: 390,
        }]}
        initialSafetyIngestId="55555555-5555-4555-8555-555555555555"
      />
    );
    expect(screen.getByLabelText("Crash evidence")).toHaveValue(
      "55555555-5555-4555-8555-555555555555",
    );
    fireEvent.click(screen.getByRole("button", { name: /Save metadata/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      safetyIngestSelections: [{ ingestId: "55555555-5555-4555-8555-555555555555" }],
    });
    vi.unstubAllGlobals();
  });

  it("shows verified agreement evidence but leaves every named corridor unselected by default", () => {
    render(
      <ReportDetailControls
        report={{ id: "report-1", title: "Agreement packet", summary: null, status: "draft", hasGeneratedArtifact: false }}
        modelRunOptions={[{ id: "22222222-2222-4222-8222-222222222222", title: "Dual demand run", engineKey: "dual_demand", status: "succeeded" }]}
        citedModelRunIds={["22222222-2222-4222-8222-222222222222"]}
        agreementEvidence={[{
          modelRunId: "22222222-2222-4222-8222-222222222222",
          state: {
            status: "verified",
            agreement: {
              schemaVersion: "openplan.corridor_agreement.v2",
              modelRunId: "22222222-2222-4222-8222-222222222222",
              artifactId: "66666666-6666-4666-8666-666666666666",
              artifactSha256: "a".repeat(64),
              assignmentProfileSha256: "b".repeat(64),
              networkSettingsSha256: "c".repeat(64),
              networkStateSha256: "d".repeat(64),
              methods: { first: "Trip-based", second: "Activity-based" },
              permittedAttributionScale: "corridor",
              thresholds: { minimumVolume: 50, gehClose: 5, gehMarginal: 10 },
              aggregate: {
                linksCompared: 12,
                linksCarryingMeaningfulTraffic: 10,
                agreeShareAllLinks: 0.75,
                agreeShareMeaningfulLinks: 0.8,
                divergeShareMeaningfulLinks: 0.1,
                agreeShareByVolume: 0.82,
                medianGehMeaningfulLinks: 3.25,
              },
              namedCorridors: [{ corridor: "Central Avenue", links: 3, firstVolume: 1200, secondVolume: 1050, geh: 4.472, classification: "agree" }],
              mandatoryCaveats: ["Neither method is ground truth.", "This does not measure accuracy.", "The methods are never averaged.", "GEH thresholds are borrowed from validation practice."],
              isAverage: false,
            },
          },
        }]}
      />
    );

    expect(screen.getByText("Dual-model agreement evidence")).toBeInTheDocument();
    expect(screen.getByText("Central Avenue")).toBeInTheDocument();
    expect(screen.getByText(/Trip-based 1,200 · Activity-based 1,050 · GEH 4.47/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Central Avenue/i })).not.toBeChecked();
    expect(screen.getByText(/methodological sensitivity, not accuracy/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Central Avenue/i }));
    expect(screen.getByRole("button", { name: /Generate PDF packet/i })).toBeDisabled();
  });

  it("distinguishes ready, changed, and missing source-review posture", () => {
    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: {
          headline: "2 linked runs · 1 scenario set · 6 project records",
          detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
        },
        driftSummary: { changedCount: 0, totalCount: 4, labels: [] },
      })
    ).toMatchObject({
      state: "ready",
      label: "Current / ready",
      headline: "Evidence chain current",
      changedSourceText: null,
    });

    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: {
          headline: "2 linked runs · 1 scenario set · 6 project records",
          detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
        },
        driftSummary: {
          changedCount: 2,
          totalCount: 4,
          labels: ["Project records", "Stage gates"],
        },
      })
    ).toMatchObject({
      state: "needs-review",
      label: "Changed source context",
      headline: "2 source areas need review",
      changedSourceText: "Project records and Stage gates",
    });

    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: {
          headline: "0 linked runs · 0 scenario sets · 0 project records",
          detail: "Not linked engagement · 0/0 handoff-ready · In progress governance",
          hasEvidence: false,
        },
        driftSummary: { changedCount: 0, totalCount: 0, labels: [] },
      })
    ).toMatchObject({
      state: "missing",
      label: "Empty evidence chain",
      headline: "No evidence is linked yet",
    });

    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: null,
        driftSummary: { changedCount: 0, totalCount: 0, labels: [] },
      })
    ).toMatchObject({
      state: "missing",
      label: "Missing evidence",
      headline: "No evidence chain captured",
    });
  });

  it("shows compact evidence posture alongside regeneration guidance", () => {
    render(
      <ReportDetailControls
        report={{
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Generated packet",
          status: "generated",
          hasGeneratedArtifact: true,
        }}
        evidenceSummary={{
          headline: "2 linked runs · 1 scenario set · 6 project records",
          detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
          blockedGateDetail: "Blocked gate: G02 · Agreements, Procurement, and Civil Rights Setup",
        }}
        driftSummary={{
          changedCount: 3,
          totalCount: 4,
          labels: ["Engagement handoff", "Project records", "Stage gates"],
        }}
      />
    );

    expect(screen.getByText(/What this report rests on/i)).toBeInTheDocument();
    expect(screen.getByText(/Does this packet need rebuilding\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Changed source context/i)).toBeInTheDocument();
    expect(screen.getByText(/3 source areas need review/i)).toBeInTheDocument();
    expect(screen.getByText(/2 linked runs · 1 scenario set · 6 project records/i)).toBeInTheDocument();
    expect(screen.getByText(/4\/9 handoff-ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Blocked gate: G02/i)).toBeInTheDocument();
    expect(screen.getByText(/3 live source changes detected since the current packet was generated\./i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Engagement handoff, Project records, and Stage gates/i).length
    ).toBeGreaterThan(0);
    // The control now offers a format, defaulting to the sendable deliverable.
    expect(screen.getByRole("button", { name: /Regenerate PDF packet/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Packet format")).toHaveValue("pdf");
  });

  it("does not show the drift banner when nothing has changed", () => {
    render(
      <ReportDetailControls
        report={{
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Generated packet",
          status: "generated",
          hasGeneratedArtifact: true,
        }}
        driftSummary={{
          changedCount: 0,
          totalCount: 4,
          labels: [],
        }}
      />
    );

    expect(screen.queryByText(/live source changes detected/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Missing evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/No evidence chain captured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate PDF packet/i })).toBeInTheDocument();
  });

  it("shows current ready posture when linked evidence exists without source drift", () => {
    render(
      <ReportDetailControls
        report={{
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Generated packet",
          status: "generated",
          hasGeneratedArtifact: true,
        }}
        evidenceSummary={{
          headline: "1 linked run · 1 scenario set · 3 project records",
          detail: "Active engagement · 2/2 handoff-ready · Complete governance",
        }}
        driftSummary={{
          changedCount: 0,
          totalCount: 4,
          labels: [],
        }}
      />
    );

    expect(screen.getByText(/Current \/ ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence chain current/i)).toBeInTheDocument();
    expect(screen.getByText(/no live source drift is currently visible/i)).toBeInTheDocument();
    expect(screen.queryByText(/Changed sources:/i)).not.toBeInTheDocument();
  });
});
