import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();

const runsSingleMock = vi.fn();
const runsEqMock = vi.fn(() => ({ single: runsSingleMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const decisionInsertMock = vi.fn();

const clientFromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return { select: runsSelectMock };
  }

  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "stage_gate_decisions") {
    return { insert: decisionInsertMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const telemetryEqMock = vi.fn().mockResolvedValue({ error: null });
const telemetryUpdateMock = vi.fn(() => ({ eq: telemetryEqMock }));
const telemetryFromMock = vi.fn(() => ({ update: telemetryUpdateMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postReport } from "@/app/api/report/route";
import {
  NOT_RECORDED_METHOD,
  gtfsServiceLevelMethod,
} from "@/lib/data-sources/transit/method";
import { GTFS_NOT_A_TIMETABLE_CAVEAT } from "@/lib/gtfs/caveats";

const GTFS_METHOD = gtfsServiceLevelMethod(true);
import { pdfDrawnText, pdfSource } from "./pdf-text-extraction-helpers";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/report", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "owner@example.com",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: clientFromMock,
    });

    createServiceRoleClientMock.mockReturnValue({
      from: telemetryFromMock,
    });

    runsSingleMock.mockResolvedValue({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        // Stored interpretations keep their [fact:N] provenance tokens; the
        // report renderers must strip them before output.
        ai_interpretation: "Interpretation text with 12345 residents. [fact:m_totalPopulation]",
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          totalPopulation: 12345,
          totalTransitStops: 56,
          totalFatalCrashes: 3,
          justice40Eligible: true,
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
      error: null,
    });

    decisionInsertMock.mockResolvedValue({ error: null });
  });

  it("returns 400 for invalid format", async () => {
    const response = await postReport(jsonRequest({ runId, format: "docx" }));

    expect(response.status).toBe(400);
  });

  it("rejects oversized report requests before auth lookup", async () => {
    const response = await postReport(
      jsonRequest({
        runId,
        format: "html",
        mapViewState: {
          oversized: "x".repeat(257 * 1024),
        },
      })
    );

    expect(response.status).toBe(413);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "request_body_too_large",
      expect.objectContaining({
        maxBytes: 256 * 1024,
      })
    );
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 when user is not a workspace member", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("returns 409 HOLD when required report artifacts are missing", async () => {
    runsSingleMock.mockResolvedValueOnce({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Missing artifacts run",
        query_text: "Evaluate this corridor",
        summary_text: "",
        ai_interpretation: "Interpretation text. [fact:m_population]",
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Required report artifacts missing",
      decision: "HOLD",
      missingArtifacts: expect.arrayContaining([
        "summary_text",
        "metrics.sourceSnapshots.crashes.fetchedAt",
      ]),
    });
    expect(telemetryUpdateMock).not.toHaveBeenCalled();
  });

  /**
   * The export refusal is REPORTED, not RECORDED as a gate decision.
   *
   * This route used to insert a `stage_gate_decisions` row on every export with
   * `gate_id: "report_artifact_gate"` — a value in no template's gate order, so
   * every reader dropped it. It attributed a pure function of the run row to
   * whoever clicked Export, stored a fact that goes stale the moment the run
   * gains a snapshot, crowded real decisions out of the newest-200 window every
   * board reads, and 500'd the export if the write failed.
   *
   * The two assertions below are the guard on all of that: the gate still
   * decides, and the decision log stays a log of human judgements.
   */
  it("refuses the export without writing anything to the stage-gate decision log", async () => {
    runsSingleMock.mockResolvedValueOnce({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Missing artifacts run",
        query_text: "Evaluate this corridor",
        summary_text: "",
        ai_interpretation: "Interpretation text.",
        metrics: { overallScore: 70, confidence: "high" },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(409);
    expect(clientFromMock).not.toHaveBeenCalledWith("stage_gate_decisions");
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("returns html for format=html and includes active map view when provided", async () => {
    const response = await postReport(
      jsonRequest({
        runId,
        format: "html",
        mapViewState: {
          crashSeverityFilter: "fatal",
          crashUserFilter: "pedestrian",
          showCrashes: true,
          showTracts: true,
          tractMetric: "poverty",
          activeDatasetOverlayId: "44444444-4444-4444-8444-444444444444",
          activeOverlayContext: {
            datasetId: "44444444-4444-4444-8444-444444444444",
            datasetName: "Nevada County Equity Indicators",
            overlayMode: "thematic_overlay",
            geometryAttachment: "analysis_tracts",
            thematicMetricKey: "pctBelowPoverty",
            thematicMetricLabel: "Poverty share",
            connectorLabel: "Census ACS 5-Year",
          },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Active Map View");
    expect(html).toContain("Nevada County Equity Indicators");
    expect(html).toContain("Poverty share");
    expect(html).toContain("Overlay mode");
    expect(html).toContain("Overlay geometry");
    // The stored interpretation carries [fact:N] tokens; the rendered report
    // must show the prose stripped of them.
    expect(html).toContain("Interpretation text with 12345 residents.");
    expect(html).not.toContain("[fact:");
    // A successful export writes no gate decision either. The map view the
    // export ran with is still recorded — on the audit line, where a derived,
    // recomputable fact belongs.
    expect(clientFromMock).not.toHaveBeenCalledWith("stage_gate_decisions");
    expect(decisionInsertMock).not.toHaveBeenCalled();
    expect(mockAudit.info).toHaveBeenCalledWith(
      "report_gate_decision",
      expect.objectContaining({
        decision: "PASS",
        mapViewState: expect.objectContaining({
          crashSeverityFilter: "fatal",
          crashUserFilter: "pedestrian",
        }),
      })
    );
  });

  /**
   * The corridor report must state how far its own numbers may be carried.
   *
   * `decisionUseStatus` has been stamped on every analysis run since the
   * traceability block existed and was read by NOTHING — not this report, not the
   * results board. A grant-ready PDF with no use boundary is the artifact most
   * likely to be over-read into a determination it cannot support.
   */
  it("states the run's decision-use boundary in the exported report", async () => {
    runsSingleMock.mockResolvedValue({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: null,
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          decisionUseStatus: "concept-level",
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    expect(html).toContain("Decision use: concept-level");
    expect(html).toContain("CEQA determination");
  });

  /**
   * THE CORRIDOR REPORT PRINTS HOW ITS TRANSIT FIGURES WERE MEASURED.
   *
   * This PDF is generated long after the run and often for a different reader.
   * Two reports of the same corridor months apart can now carry stop counts on
   * two different scales — a tally of mapped OpenStreetMap objects, or the stops
   * an agency's own published schedule calls at — and this line is the only thing
   * in the artifact that explains why they disagree. A grant reviewer reads the
   * number, not the software.
   */
  it("prints the transit measurement method beside the transit figures", async () => {
    runsSingleMock.mockResolvedValueOnce({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Feed-backed corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: "Interpretation text.",
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          totalTransitStops: 412,
          stopsPerSquareMile: 11.3,
          frequentServiceShare: 0.184,
          frequentServiceHeadwayMinutes: 15,
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: {
              source: "gtfs-feed",
              observed: true,
              method: GTFS_METHOD,
              caveats: [GTFS_NOT_A_TIMETABLE_CAVEAT],
              fetchedAt: "2025-01-01T00:00:00.000Z",
            },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    expect(html).toContain("<td>Measurement method</td>");
    expect(html).toContain(GTFS_METHOD.label);
    expect(html).toContain("How transit was measured:");
    // The share that fills half the accessibility score's transit term is
    // printed too — a figure that drives a score and appears on no page is the
    // shipped-invisible defect class.
    expect(html).toContain("18.4%");
    // And the qualifications ride with it: every number here is an hourly
    // average taken off one representative date from a schedule that may have
    // stopped running.
    expect(html).toContain("not a timetable");
  });

  /**
   * A legacy run keeps describing itself the way it did when it was stored.
   */
  it("says the transit method was not recorded on a run that carried none", async () => {
    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    expect(html).toContain("<td>Measurement method</td>");
    expect(html).toContain(NOT_RECORDED_METHOD.label);
    expect(html).not.toContain(GTFS_METHOD.label);
  });

  /** A run that recorded no boundary says so, rather than inheriting one. */
  it("says the decision-use boundary was not recorded on a legacy run", async () => {
    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    expect(html).toContain("Decision use: not recorded");
    expect(html).not.toContain("Decision use: concept-level");
  });

  /**
   * A missing safety score may not render as a bad one.
   *
   * Each score card read `scoreColor(Number(m.safetyScore) || 0)` around
   * `fmt(m.safetyScore)`. `safetyScore` is null whenever no crash source answered
   * — the ordinary case outside a registered adapter's coverage — so the card
   * printed the missing-value text in the RED reserved for a score below 40. In a
   * grant-ready PDF, a corridor nobody could measure looked like the most
   * dangerous one on the page.
   */
  it("renders an unmeasured safety score as not measured, not as a red zero", async () => {
    runsSingleMock.mockResolvedValue({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: null,
        metrics: {
          overallScore: 63,
          accessibilityScore: 68,
          safetyScore: null,
          equityScore: 74,
          confidence: "medium",
          totalPopulation: null,
          pctTransit: null,
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    expect(html).toContain("No crash source covered this study area");
    // The danger red belongs to a measured low score, never to an absent one.
    expect(html).not.toMatch(/color:#dc2626[^>]*>\s*(Not measured|N\/A)/);
    // Unmeasured demographics read as unmeasured, not "not applicable" and not
    // as a zero. (`?? "N/A"` survives on a few non-census rows this change did
    // not touch — those are called out in the handoff, not silently asserted.)
    expect(html).toContain("<td>Total Population</td><td>Not measured</td>");
    expect(html).toContain("<td>Public Transit</td><td>Not measured</td>");
    expect(html).not.toContain("<td>Total Population</td><td>0</td>");
  });

  /**
   * A score that EXISTS but was computed over an unread census is not a
   * measurement, and the PDF is where that matters most.
   *
   * Nulling the census FIGURES did not null the SCORES. `computeAccessibility`
   * and `computeEquity` read the summarizer's placeholder zeros, so a corridor
   * whose ACS read returned nothing still exports "Accessibility 5 / Equity 0".
   * A grant reviewer holding this page has no way to tell that Equity 0 from a
   * measured one. Proven against what the route really persists in
   * `corridor-lane-honesty.test.tsx`, which asserts the same
   * `censusMeasuredUniverses.tracts: false` this fixture carries.
   */
  it("says an Accessibility and Equity score was computed over an unread census", async () => {
    runsSingleMock.mockResolvedValue({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: null,
        metrics: {
          overallScore: 3,
          accessibilityScore: 5,
          safetyScore: null,
          equityScore: 0,
          confidence: "low",
          tractCount: 0,
          censusMeasuredUniverses: { tracts: false, population: false },
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    const caveat = /computed as though every demographic input were zero/g;
    // On the Accessibility card AND the Equity card — not once at the top where
    // it is read as being about something else.
    expect(html.match(caveat) ?? []).toHaveLength(2);
    // And the numbers are still there: disclose, never withhold a planner's run.
    expect(html).toContain(">5</div>");
    expect(html).toContain(">0</div>");
  });

  /** The caveat must be absent when the census answered — an always-on warning teaches nothing. */
  it("does not caveat the scores when the census answered", async () => {
    runsSingleMock.mockResolvedValue({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: null,
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          tractCount: 12,
          censusMeasuredUniverses: { tracts: true, population: true },
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));
    const html = await response.text();

    expect(html).not.toContain("computed as though every demographic input were zero");
  });

  /**
   * The PDF is the SAME document as the HTML export, rendered.
   *
   * It used to be a separate, thinner text document — ~9 labelled values
   * against the HTML's 13 sections — cut to 48 lines on a single `/Count 1`
   * page. These assertions are on the built-in typesetter, pinned by pointing
   * CHROME_EXECUTABLE_PATH at nothing: Chrome's output is version- and
   * font-dependent, and on a host that happens to have Chrome installed this
   * test would otherwise launch a real browser.
   */
  describe("format=pdf", () => {
    const ORIGINAL_CHROME_PATH = process.env.CHROME_EXECUTABLE_PATH;

    beforeEach(() => {
      process.env.CHROME_EXECUTABLE_PATH = "/nonexistent/chrome-for-tests";
    });

    afterEach(() => {
      if (ORIGINAL_CHROME_PATH === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
      else process.env.CHROME_EXECUTABLE_PATH = ORIGINAL_CHROME_PATH;
    });

    async function pdfText() {
      const response = await postReport(
        jsonRequest({
          runId,
          format: "pdf",
          mapViewState: { crashSeverityFilter: "severe_injury", crashUserFilter: "vru" },
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/pdf");
      expect(response.headers.get("x-openplan-pdf-engine")).toBe("builtin");

      const bytes = new Uint8Array(await response.arrayBuffer());
      const source = pdfSource(bytes);
      expect(source.slice(0, 4)).toBe("%PDF");
      return { source, drawn: pdfDrawnText(bytes) };
    }

    it("carries the run's figures and strips the grounding tokens", async () => {
      const { drawn } = await pdfText();
      expect(drawn).toContain("12345 residents");
      // The stored [fact:N] tokens must not survive into a grant-facing artifact.
      expect(drawn).not.toContain("[fact:");
    });

    it("declares as many pages as it emitted, never a hardcoded one", async () => {
      const { source } = await pdfText();
      const declared = Number(/\/Count (\d+)/.exec(source)?.[1]);
      const pageObjects = [...source.matchAll(/\/Type \/Page[^s]/g)].length;
      expect(declared).toBe(pageObjects);
      expect(declared).toBeGreaterThanOrEqual(1);
    });

    it("carries every section heading the HTML export shows", async () => {
      const htmlResponse = await postReport(
        jsonRequest({
          runId,
          format: "html",
          mapViewState: { crashSeverityFilter: "severe_injury", crashUserFilter: "vru" },
        })
      );
      const html = await htmlResponse.text();
      const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) =>
        m[1].replace(/&amp;/g, "&").trim()
      );
      expect(headings.length).toBeGreaterThan(5);

      // Derived from the live HTML rather than a hardcoded list, so the parity
      // cannot decay as sections are added.
      const { drawn } = await pdfText();
      for (const heading of headings) {
        expect(drawn).toContain(heading);
      }
    });

    it("discloses the typesetting tier inside the document", async () => {
      const { drawn } = await pdfText();
      expect(drawn).toContain("built-in PDF writer");
      expect(drawn).toContain("no section has been shortened or dropped");
    });
  });
});
