import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const touchScenarioLinkedReportPacketsMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const MODEL_RUN_ID = "33333333-3333-4333-8333-333333333333";
const SCENARIO_SET_ID = "44444444-4444-4444-8444-444444444444";
const SCENARIO_ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_RUN_ID = "66666666-6666-4666-8666-666666666666";

// models: select chain via loadModelAccess + update for last_run_recorded_at
const modelMaybeSingleMock = vi.fn();
const modelEqMock = vi.fn(() => ({ maybeSingle: modelMaybeSingleMock }));
const modelSelectMock = vi.fn(() => ({ eq: modelEqMock }));
const modelsUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const modelsUpdateMock = vi.fn(() => ({ eq: modelsUpdateEqMock }));

// workspace_members: select chain via loadModelAccess
const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

// model_runs: select (PATCH lookup) + insert (POST create) + update (POST succeed / PATCH relink)
const modelRunMaybeSingleMock = vi.fn();
const modelRunEqModelIdMock = vi.fn(() => ({ maybeSingle: modelRunMaybeSingleMock }));
const modelRunEqIdMock = vi.fn(() => ({ eq: modelRunEqModelIdMock }));
const modelRunSelectMock = vi.fn(() => ({ eq: modelRunEqIdMock }));
const modelRunInsertMock = vi.fn().mockResolvedValue({ error: null });
const modelRunUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const modelRunUpdateMock = vi.fn(() => ({ eq: modelRunUpdateEqMock }));

// scenario_entries: select (entry lookup in both routes) + update (attach in both routes)
const scenarioEntryMaybeSingleMock = vi.fn();
const scenarioEntryEqMock = vi.fn(() => ({ maybeSingle: scenarioEntryMaybeSingleMock }));
const scenarioEntrySelectMock = vi.fn(() => ({ eq: scenarioEntryEqMock }));
const scenarioEntryUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const scenarioEntryUpdateMock = vi.fn(() => ({ eq: scenarioEntryUpdateEqMock }));

// model_links: select chain (3 eqs + maybeSingle) + insert
const modelLinksMaybeSingleMock = vi.fn();
const modelLinksEq3Mock = vi.fn(() => ({ maybeSingle: modelLinksMaybeSingleMock }));
const modelLinksEq2Mock = vi.fn(() => ({ eq: modelLinksEq3Mock }));
const modelLinksEq1Mock = vi.fn(() => ({ eq: modelLinksEq2Mock }));
const modelLinksSelectMock = vi.fn(() => ({ eq: modelLinksEq1Mock }));
const modelLinksInsertMock = vi.fn().mockResolvedValue({ error: null });

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "models") return { select: modelSelectMock, update: modelsUpdateMock };
  if (table === "workspace_members") return { select: membershipSelectMock };
  if (table === "model_runs") {
    return { select: modelRunSelectMock, insert: modelRunInsertMock, update: modelRunUpdateMock };
  }
  if (table === "scenario_entries") {
    return { select: scenarioEntrySelectMock, update: scenarioEntryUpdateMock };
  }
  if (table === "model_links") return { select: modelLinksSelectMock, insert: modelLinksInsertMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/reports/scenario-writeback", () => ({
  touchScenarioLinkedReportPackets: (...args: unknown[]) => touchScenarioLinkedReportPacketsMock(...args),
}));

import { PATCH as patchModelRun } from "@/app/api/models/[modelId]/runs/[modelRunId]/route";
import { POST as postModelRun } from "@/app/api/models/[modelId]/runs/route";

describe("model run write-back", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });

    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        scenario_set_id: SCENARIO_SET_ID,
        title: "County mobility model",
        model_family: "travel_demand",
        config_version: "v1",
        config_json: {
          runTemplate: {
            queryText: "Evaluate county demand shifts",
            corridorGeojson: {
              type: "Polygon",
              coordinates: [
                [
                  [-121.5, 39.1],
                  [-121.4, 39.1],
                  [-121.4, 39.2],
                  [-121.5, 39.1],
                ],
              ],
            },
          },
        },
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
    });

    scenarioEntryMaybeSingleMock.mockResolvedValue({
      data: {
        id: SCENARIO_ENTRY_ID,
        scenario_set_id: SCENARIO_SET_ID,
        label: "Protected bike package",
        entry_type: "alternative",
        status: "draft",
        assumptions_json: null,
      },
      error: null,
    });

    modelRunMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        model_id: MODEL_ID,
        scenario_entry_id: null,
        scenario_set_id: SCENARIO_SET_ID,
        source_analysis_run_id: SOURCE_RUN_ID,
        status: "succeeded",
        run_title: "County mobility model run",
      },
      error: null,
    });

    modelLinksMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    touchScenarioLinkedReportPacketsMock.mockResolvedValue({
      touchedReportIds: ["report-1"],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  describe("PATCH /api/models/[modelId]/runs/[modelRunId] — promote run", () => {
    it("calls touchScenarioLinkedReportPackets with scenario set and workspace", async () => {
      const response = await patchModelRun(
        new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenarioEntryId: SCENARIO_ENTRY_ID }),
        }),
        { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) }
      );

      expect(response.status).toBe(200);
      expect(touchScenarioLinkedReportPacketsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioSetId: SCENARIO_SET_ID,
          workspaceId: WORKSPACE_ID,
        })
      );
      expect(mockAudit.info).toHaveBeenCalledWith(
        "scenario_report_writeback_succeeded",
        expect.objectContaining({ touchedReportCount: 1 })
      );
    });

    it("logs a warning but still returns 200 when write-back fails", async () => {
      touchScenarioLinkedReportPacketsMock.mockResolvedValueOnce({
        touchedReportIds: [],
        error: { message: "DB timeout", code: "57014" },
      });

      const response = await patchModelRun(
        new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenarioEntryId: SCENARIO_ENTRY_ID }),
        }),
        { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) }
      );

      expect(response.status).toBe(200);
      expect(mockAudit.warn).toHaveBeenCalledWith(
        "scenario_report_writeback_failed",
        expect.objectContaining({ message: "DB timeout", code: "57014" })
      );
    });
  });

  describe("POST /api/models/[modelId]/runs — launch with scenario attachment", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              runId: SOURCE_RUN_ID,
              metrics: { total_trips: 1200 },
              summary: "Run completed successfully.",
            }),
        })
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("calls touchScenarioLinkedReportPackets after attaching the run to a scenario entry", async () => {
      const response = await postModelRun(
        new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioEntryId: SCENARIO_ENTRY_ID,
            attachToScenarioEntry: true,
          }),
        }),
        { params: Promise.resolve({ modelId: MODEL_ID }) }
      );

      expect(response.status).toBe(201);
      expect(touchScenarioLinkedReportPacketsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioSetId: SCENARIO_SET_ID,
          workspaceId: WORKSPACE_ID,
        })
      );
      expect(mockAudit.info).toHaveBeenCalledWith(
        "scenario_report_writeback_succeeded",
        expect.objectContaining({ touchedReportCount: 1 })
      );
    });

    it("does not call touchScenarioLinkedReportPackets when attachToScenarioEntry is not set", async () => {
      const response = await postModelRun(
        new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioEntryId: SCENARIO_ENTRY_ID,
            // attachToScenarioEntry omitted
          }),
        }),
        { params: Promise.resolve({ modelId: MODEL_ID }) }
      );

      expect(response.status).toBe(201);
      expect(touchScenarioLinkedReportPacketsMock).not.toHaveBeenCalled();
    });
  });
});
