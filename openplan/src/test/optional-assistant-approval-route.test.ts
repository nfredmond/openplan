import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const insert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { POST } from "@/app/api/assistant/actions/approvals/route";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const rtpCycleId = "22222222-2222-4222-8222-222222222222";
function request(generateAfterCreate: boolean, requireApproval: boolean) {
  return new NextRequest("http://localhost/api/assistant/actions/approvals", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      workspaceId, requireApproval, action: { kind: "create_rtp_packet_record", rtpCycleId, generateAfterCreate, modelingCountyRunId: null },
    }),
  });
}
describe("optional approval for RTP packet actions", () => {
  beforeEach(() => {
    insert.mockReset().mockResolvedValue({ error: null });
    createServiceRoleClientMock.mockReset().mockReturnValue({ from: (table: string) => {
      expect(table).toBe("assistant_action_approvals");return { insert };
    } });
    createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "member" }, error: null }) }) }) }) }),
    });
  });
  it("mints explicit consent for record creation with normalized defaults", async () => {
    const response = await POST(request(false, true));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.approvalId).toEqual(expect.any(String));
    expect(result.inputHash).toBe(hashAssistantActionPayload({ kind: "create_rtp_packet_record", rtpCycleId }));
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: result.approvalId, input_hash: result.inputHash, workspace_id: workspaceId }));
  });
  it("refuses to mint single-use consent for two sequential effects", async () => {
    const response = await POST(request(true, true));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Create the packet record first, then approve artifact generation separately." });
    expect(insert).not.toHaveBeenCalled();
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });
  it("preserves the existing quick-link path that does not request separate consent", async () => {
    const response = await POST(request(true, false));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ approvalId: null, expiresAt: null });
    expect(insert).not.toHaveBeenCalled();
  });
});
