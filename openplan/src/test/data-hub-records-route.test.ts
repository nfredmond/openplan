import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const fromMock = vi.fn();

const workspaceMembersLimitMock = vi.fn();
const workspaceMembersEqWorkspaceMock = vi.fn(() => ({ limit: workspaceMembersLimitMock }));
const workspaceMembersEqUserMock = vi.fn(() => ({ eq: workspaceMembersEqWorkspaceMock }));
const workspaceMembersSelectMock = vi.fn(() => ({ eq: workspaceMembersEqUserMock }));

const connectorsLookupLimitMock = vi.fn();
const connectorsLookupEqWorkspaceMock = vi.fn(() => ({ limit: connectorsLookupLimitMock }));
const connectorsLookupEqIdMock = vi.fn(() => ({ eq: connectorsLookupEqWorkspaceMock }));
const connectorsLookupSelectMock = vi.fn(() => ({ eq: connectorsLookupEqIdMock }));
const connectorsInsertSingleMock = vi.fn();
const connectorsInsertSelectMock = vi.fn(() => ({ single: connectorsInsertSingleMock }));
const connectorsInsertMock = vi.fn(() => ({ select: connectorsInsertSelectMock }));

const projectsLookupLimitMock = vi.fn();
const projectsLookupEqWorkspaceMock = vi.fn(() => ({ limit: projectsLookupLimitMock }));
const projectsLookupEqIdMock = vi.fn(() => ({ eq: projectsLookupEqWorkspaceMock }));
const projectsLookupSelectMock = vi.fn(() => ({ eq: projectsLookupEqIdMock }));

const datasetsInsertSingleMock = vi.fn();
const datasetsInsertSelectMock = vi.fn(() => ({ single: datasetsInsertSingleMock }));
const datasetsInsertMock = vi.fn(() => ({ select: datasetsInsertSelectMock }));

const datasetProjectLinkInsertMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postDataHubRecord } from "@/app/api/data-hub/records/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/data-hub/records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/data-hub/records", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    workspaceMembersLimitMock.mockResolvedValue({
      data: [{ workspace_id: "11111111-1111-4111-8111-111111111111" }],
      error: null,
    });

    connectorsLookupLimitMock.mockResolvedValue({
      data: [{ id: "33333333-3333-4333-8333-333333333333" }],
      error: null,
    });

    connectorsInsertSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        workspace_id: "11111111-1111-4111-8111-111111111111",
        key: "census-acs5",
        display_name: "Census ACS 5-Year",
        source_type: "census",
        category: "federal",
        status: "active",
        cadence: "annual",
        auth_mode: "none",
        endpoint_url: "https://api.census.gov/data/2023/acs/acs5",
        owner_label: "Priya",
        description: "Primary demographics connector",
        policy_monitor_enabled: true,
        last_sync_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
      },
      error: null,
    });

    projectsLookupLimitMock.mockResolvedValue({
      data: [{ id: "55555555-5555-4555-8555-555555555555" }],
      error: null,
    });

    datasetsInsertSingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        workspace_id: "11111111-1111-4111-8111-111111111111",
        connector_id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County ACS equity indicators",
        status: "ready",
        geography_scope: "tract",
        geometry_attachment: "analysis_tracts",
        thematic_metric_key: "pctBelowPoverty",
        thematic_metric_label: "Poverty share",
        coverage_summary: "Nevada County corridors",
        vintage_label: "ACS 2023",
        source_url: "https://api.census.gov/data/2023/acs/acs5",
        license_label: "Public domain",
        citation_text: "U.S. Census Bureau ACS 5-Year",
        schema_version: "v2026.03",
        checksum: "sha256:abc",
        row_count: 1842,
        refresh_cadence: "annual",
        last_refreshed_at: null,
        notes: "Validated in QA sweep",
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
      },
      error: null,
    });

    datasetProjectLinkInsertMock.mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "workspace_members") {
        return { select: workspaceMembersSelectMock };
      }

      if (table === "data_connectors") {
        return {
          select: connectorsLookupSelectMock,
          insert: connectorsInsertMock,
        };
      }

      if (table === "projects") {
        return { select: projectsLookupSelectMock };
      }

      if (table === "data_datasets") {
        return { insert: datasetsInsertMock };
      }

      if (table === "data_dataset_project_links") {
        return { insert: datasetProjectLinkInsertMock };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postDataHubRecord(
      jsonRequest({
        recordType: "connector",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        displayName: "Census ACS 5-Year",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("creates a connector record", async () => {
    const response = await postDataHubRecord(
      jsonRequest({
        recordType: "connector",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        displayName: "Census ACS 5-Year",
        sourceType: "census",
        category: "federal",
        status: "active",
        cadence: "annual",
        authMode: "none",
        endpointUrl: "https://api.census.gov/data/2023/acs/acs5",
        ownerLabel: "Priya",
        description: "Primary demographics connector",
        policyMonitorEnabled: true,
      })
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      recordType: string;
      record: { id: string; key: string; display_name: string; policy_monitor_enabled: boolean };
    };

    expect(payload.recordType).toBe("connector");
    expect(payload.record).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      key: "census-acs5",
      display_name: "Census ACS 5-Year",
      policy_monitor_enabled: true,
    });

    expect(connectorsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Census ACS 5-Year",
        source_type: "census",
        category: "federal",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
  });

  it("creates a dataset and links it to a project", async () => {
    const response = await postDataHubRecord(
      jsonRequest({
        recordType: "dataset",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County ACS equity indicators",
        connectorId: "33333333-3333-4333-8333-333333333333",
        projectId: "55555555-5555-4555-8555-555555555555",
        relationshipType: "primary_input",
        status: "ready",
        geographyScope: "tract",
        geometryAttachment: "analysis_tracts",
        thematicMetricKey: "pctBelowPoverty",
        thematicMetricLabel: "Poverty share",
        coverageSummary: "Nevada County corridors",
        vintageLabel: "ACS 2023",
        sourceUrl: "https://api.census.gov/data/2023/acs/acs5",
        licenseLabel: "Public domain",
        citationText: "U.S. Census Bureau ACS 5-Year",
        schemaVersion: "v2026.03",
        checksum: "sha256:abc",
        rowCount: 1842,
        refreshCadence: "annual",
        notes: "Validated in QA sweep",
      })
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      recordType: string;
      record: { id: string; name: string; connector_id: string };
      projectLink: { projectId: string; relationshipType: string } | null;
    };

    expect(payload.recordType).toBe("dataset");
    expect(payload.record).toMatchObject({
      id: "66666666-6666-4666-8666-666666666666",
      name: "Nevada County ACS equity indicators",
      connector_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(payload.projectLink).toMatchObject({
      projectId: "55555555-5555-4555-8555-555555555555",
      relationshipType: "primary_input",
    });

    expect(datasetsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "11111111-1111-4111-8111-111111111111",
        connector_id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County ACS equity indicators",
        status: "ready",
        geography_scope: "tract",
        geometry_attachment: "analysis_tracts",
        thematic_metric_key: "pctBelowPoverty",
      })
    );

    expect(datasetProjectLinkInsertMock).toHaveBeenCalledWith({
      dataset_id: "66666666-6666-4666-8666-666666666666",
      project_id: "55555555-5555-4555-8555-555555555555",
      relationship_type: "primary_input",
      linked_by: "22222222-2222-4222-8222-222222222222",
    });
  });
});
