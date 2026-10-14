import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

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

import { POST as postBootstrap } from "@/app/api/workspaces/bootstrap/route";
import { NEW_WORKSPACE_GETTING_STARTED_STEPS } from "@/lib/onboarding/getting-started";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/workspaces/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/workspaces/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    vi.unstubAllEnvs();
    rpcMock.mockResolvedValue({
      data: {
        created: true,
        owned: 1,
        limit: 5,
        workspace: {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "regional-planning-commission",
          // What the column default (migration 20260805000001) stamps on a
          // workspace born with no template named: the nationwide federal-aid
          // floor, never one state's pack.
          stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
          stage_gate_template_version: "0.1.0",
          stage_gate_template_selection: "interim_unconfigured_default",
        },
      },
      error: null,
    });

    // The route writes through create_owned_workspace only. A direct table
    // write would bypass the per-person limit, so any .from() call fails.
    fromMock.mockImplementation((table: string) => {
      throw new Error(`Unexpected table: ${table}`);
    });

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    createServiceRoleClientMock.mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await postBootstrap(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 200 with expected response shape on successful bootstrap", async () => {
    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      workspaceId: string;
      slug: string;
      stageGateTemplate: {
        id: string;
        version: string;
        jurisdiction: string;
        bindingMode: string;
        lapmFormIdsStatus: string | null;
      };
      onboardingChecklist: string[];
    };

    expect(payload.workspaceId).toBeDefined();
    expect(payload.slug).toBe("regional-planning-commission");
    // A bootstrap that names no template and has no geography binds the
    // nationwide US federal-aid floor — not any one state's pack — and declares
    // no Caltrans form-set status, because a nationwide template has none.
    expect(payload.stageGateTemplate).toMatchObject({
      id: "us_federal_aid_stage_gates_v0_1",
      version: "0.1.0",
      jurisdiction: "US",
      bindingMode: "workspace_bootstrap_interim",
      lapmFormIdsStatus: null,
    });
    expect(Array.isArray(payload.onboardingChecklist)).toBe(true);
    expect(payload.onboardingChecklist.length).toBeGreaterThan(0);
    // The response carries the SHARED getting-started list — the same one the
    // in-app Help page renders (src/lib/onboarding/getting-started.ts). A list
    // re-inlined here would drift from the one people actually read.
    expect(payload.onboardingChecklist).toEqual([...NEW_WORKSPACE_GETTING_STARTED_STEPS]);

    /**
     * The first thing a new workspace reads may not assume a supervised pilot.
     *
     * The original list told every agency in the country to "set pilot success
     * metrics" and "schedule pilot readout and weekly KPI review cadence" —
     * steps that only made sense inside one county's supervised engagement. The
     * product is self-serve (non-negotiable #4), so nobody is running a readout
     * for the person reading this, and no place, agency, or program may be named
     * in it (non-negotiable #0).
     */
    const checklistText = payload.onboardingChecklist.join(" ");
    expect(checklistText).not.toMatch(/\bpilot\b/i);
    expect(checklistText).not.toMatch(/\breadout\b/i);
    expect(checklistText).not.toMatch(/\bKPI\b/);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("create_owned_workspace", {
      p_user_id: "22222222-2222-4222-8222-222222222222",
      p_name: "Regional Planning Commission",
      p_slug: "regional-planning-commission",
      p_stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
      p_stage_gate_template_version: "0.1.0",
      p_stage_gate_binding_source: "workspace_bootstrap_interim",
      p_stage_gate_template_selection: "interim_unconfigured_default",
      p_max_owned: 5,
    });

    expect(createApiAuditLoggerMock).toHaveBeenCalledWith(
      "workspaces.bootstrap",
      expect.any(NextRequest)
    );
  });

  it("returns 400 when unsupported stage-gate template is requested", async () => {
    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
        stageGateTemplateId: "unsupported_template",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Unsupported stage-gate template" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts explicit california stage-gate template selection", async () => {
    // The insert result mock mirrors what the database would return for this
    // request, so the response assertions read the same story the insert wrote.
    rpcMock.mockResolvedValue({
      data: {
        created: true,
        owned: 1,
        limit: 5,
        workspace: {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "regional-planning-commission",
          stage_gate_template_id: "ca_stage_gates_v0_1",
          stage_gate_template_version: "0.1.0",
          stage_gate_template_selection: "explicitly_requested",
        },
      },
      error: null,
    });

    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
        stageGateTemplateId: "ca_stage_gates_v0_1",
      })
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_owned_workspace",
      expect.objectContaining({
        p_stage_gate_template_id: "ca_stage_gates_v0_1",
        p_stage_gate_template_selection: "explicitly_requested",
      })
    );

    // Choosing California still carries California's declarations — the LAPM
    // form-set status belongs to the CA pack, not to every binding.
    const payload = (await response.json()) as {
      stageGateTemplate: { id: string; lapmFormIdsStatus: string | null; templateSelection: string };
    };
    expect(payload.stageGateTemplate.id).toBe("ca_stage_gates_v0_1");
    expect(payload.stageGateTemplate.lapmFormIdsStatus).toBe("deferred_to_v0_2");
    expect(payload.stageGateTemplate.templateSelection).toBe("explicitly_requested");
  });

  it("returns 500 when the database refuses the workspace", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insert failed", code: "XX000" } });

    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to bootstrap workspace" });
  });

  it("refuses an unrecognized reply instead of treating it as a workspace", async () => {
    rpcMock.mockResolvedValue({ data: { created: true }, error: null });

    const response = await postBootstrap(jsonRequest({ workspaceName: "Regional Planning Commission" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to bootstrap workspace" });
  });

  it("retries a taken slug with a suffix", async () => {
    const created = await rpcMock();
    rpcMock.mockReset();
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "duplicate key value violates unique constraint \"workspaces_slug_key\"", code: "23505" } })
      .mockResolvedValueOnce(created);

    const response = await postBootstrap(jsonRequest({ workspaceName: "Regional Planning Commission" }));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[1][1].p_slug).toMatch(/^regional-planning-commission-[0-9a-f]{4}$/);
  });

  describe("workspaces one person may own", () => {
    it("refuses plainly when the person already owns the limit, and creates nothing", async () => {
      rpcMock.mockResolvedValue({ data: { created: false, owned: 5, limit: 5 }, error: null });

      const response = await postBootstrap(jsonRequest({ workspaceName: "Sixth Workspace" }));

      expect(response.status).toBe(403);
      const payload = (await response.json()) as { error: string; limit: number; workspaceId?: string };
      expect(payload.error).toBe(
        "You already own 5 workspaces, the most this OpenPlan site allows. Ask whoever runs this site to raise the limit."
      );
      expect(payload.limit).toBe(5);
      expect(payload.workspaceId).toBeUndefined();
      // The refusal names the operator and sells nothing.
      expect(payload.error).not.toMatch(/\b(upgrade|plan|tier|pay|paid)\b/i);
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(mockAudit.warn).toHaveBeenCalledWith("owned_workspace_limit_reached", {
        userId: "22222222-2222-4222-8222-222222222222",
        owned: 5,
        limit: 5,
      });
    });

    it("creates the workspace while the person is under the limit", async () => {
      rpcMock.mockResolvedValue({
        data: {
          created: true,
          owned: 4,
          limit: 5,
          workspace: {
            id: "33333333-3333-4333-8333-333333333333",
            slug: "fourth-workspace",
            stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
            stage_gate_template_version: "0.1.0",
            stage_gate_template_selection: "interim_unconfigured_default",
          },
        },
        error: null,
      });

      const response = await postBootstrap(jsonRequest({ workspaceName: "Fourth Workspace" }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ workspaceId: "33333333-3333-4333-8333-333333333333" });
    });

    it("passes the operator's limit from OPENPLAN_MAX_OWNED_WORKSPACES", async () => {
      vi.stubEnv("OPENPLAN_MAX_OWNED_WORKSPACES", "12");

      await postBootstrap(jsonRequest({ workspaceName: "Regional Planning Commission" }));

      expect(rpcMock).toHaveBeenCalledWith("create_owned_workspace", expect.objectContaining({ p_max_owned: 12 }));
    });

    it("keeps the default of 5 when the setting is not a positive whole number", async () => {
      for (const value of ["0", "-3", "2.5", "lots", ""]) {
        rpcMock.mockClear();
        vi.stubEnv("OPENPLAN_MAX_OWNED_WORKSPACES", value);

        await postBootstrap(jsonRequest({ workspaceName: "Regional Planning Commission" }));

        expect(rpcMock, value).toHaveBeenCalledWith("create_owned_workspace", expect.objectContaining({ p_max_owned: 5 }));
      }
    });

    it("words a limit of one in the singular", async () => {
      rpcMock.mockResolvedValue({ data: { created: false, owned: 1, limit: 1 }, error: null });

      const response = await postBootstrap(jsonRequest({ workspaceName: "Second Workspace" }));

      expect((await response.json()) as { error: string }).toMatchObject({
        error: "You already own 1 workspace, the most this OpenPlan site allows. Ask whoever runs this site to raise the limit.",
      });
    });
  });
});
