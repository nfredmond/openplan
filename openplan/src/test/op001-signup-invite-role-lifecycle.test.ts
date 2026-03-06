import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const createStripeCheckoutSessionMock = vi.fn();
const logBillingEventMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

type AuthUser = {
  id: string;
  email: string;
} | null;

type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  stage_gate_template_id: string;
  stage_gate_template_version: string;
  stage_gate_binding_source: string;
  stripe_customer_id: string | null;
  subscription_plan?: string;
  subscription_status?: string;
  billing_updated_at?: string;
};

type WorkspaceMemberRecord = {
  workspace_id: string;
  user_id: string;
  role: string;
};

const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_EMAIL = "owner@example.com";
const INVITED_USER_ID = "33333333-3333-4333-8333-333333333333";
const INVITED_EMAIL = "analyst@example.com";

const state: {
  authUser: AuthUser;
  workspaceSequence: number;
  workspaces: WorkspaceRecord[];
  workspaceMembers: WorkspaceMemberRecord[];
} = {
  authUser: null,
  workspaceSequence: 0,
  workspaces: [],
  workspaceMembers: [],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/billing/checkout", () => ({
  createStripeCheckoutSession: (...args: unknown[]) => createStripeCheckoutSessionMock(...args),
}));

vi.mock("@/lib/billing/events", () => ({
  logBillingEvent: (...args: unknown[]) => logBillingEventMock(...args),
}));

import { POST as postBootstrap } from "@/app/api/workspaces/bootstrap/route";
import { POST as postCheckout } from "@/app/api/billing/checkout/route";

function setAuthUser(user: AuthUser) {
  state.authUser = user;
}

function inviteMember(workspaceId: string, userId: string, role: string) {
  state.workspaceMembers.push({ workspace_id: workspaceId, user_id: userId, role });
}

function updateMemberRole(workspaceId: string, userId: string, role: string) {
  const target = state.workspaceMembers.find(
    (member) => member.workspace_id === workspaceId && member.user_id === userId
  );

  if (!target) {
    throw new Error("Unable to update role for missing workspace member");
  }

  target.role = role;
}

function buildClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
    from: (table: string) => {
      if (table === "workspaces") {
        return {
          insert: (payload: {
            name: string;
            slug: string;
            plan: string;
            stage_gate_template_id: string;
            stage_gate_template_version: string;
            stage_gate_binding_source: string;
          }) => {
            const workspace: WorkspaceRecord = {
              id: `00000000-0000-4000-8000-${String(state.workspaceSequence + 1).padStart(12, "0")}`,
              name: payload.name,
              slug: payload.slug,
              plan: payload.plan,
              stage_gate_template_id: payload.stage_gate_template_id,
              stage_gate_template_version: payload.stage_gate_template_version,
              stage_gate_binding_source: payload.stage_gate_binding_source,
              stripe_customer_id: null,
            };

            state.workspaceSequence += 1;
            state.workspaces.push(workspace);

            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: workspace.id,
                    slug: workspace.slug,
                    plan: workspace.plan,
                    stage_gate_template_id: workspace.stage_gate_template_id,
                    stage_gate_template_version: workspace.stage_gate_template_version,
                  },
                  error: null,
                }),
              }),
            };
          },
          select: () => {
            const filters: Record<string, string> = {};

            return {
              eq: (column: string, value: string) => {
                filters[column] = value;
                return {
                  maybeSingle: async () => {
                    const workspace = state.workspaces.find(
                      (item) => item.id === filters.id
                    );

                    return {
                      data: workspace
                        ? { stripe_customer_id: workspace.stripe_customer_id }
                        : null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update: (payload: Partial<WorkspaceRecord>) => ({
            eq: async (column: string, value: string) => {
              const workspace = state.workspaces.find((item) => item[column as keyof WorkspaceRecord] === value);
              if (!workspace) {
                return { error: { message: "workspace not found" } };
              }

              Object.assign(workspace, payload);
              return { error: null };
            },
          }),
        };
      }

      if (table === "workspace_members") {
        return {
          insert: async (payload: WorkspaceMemberRecord) => {
            state.workspaceMembers.push(payload);
            return { error: null };
          },
          select: () => {
            const filters: Record<string, string> = {};

            const chain = {
              eq: (column: string, value: string) => {
                filters[column] = value;
                return chain;
              },
              maybeSingle: async () => {
                const member = state.workspaceMembers.find(
                  (item) =>
                    item.workspace_id === filters.workspace_id && item.user_id === filters.user_id
                );

                return {
                  data: member
                    ? {
                        workspace_id: member.workspace_id,
                        role: member.role,
                      }
                    : null,
                  error: null,
                };
              },
            };

            return chain;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function bootstrapRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/workspaces/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function checkoutRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("OP-001 lifecycle regression: signup -> invite -> role-update", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    state.authUser = { id: OWNER_USER_ID, email: OWNER_EMAIL };
    state.workspaceSequence = 0;
    state.workspaces.length = 0;
    state.workspaceMembers.length = 0;

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockImplementation(async () => buildClient());
    createServiceRoleClientMock.mockImplementation(() => ({
      from: (table: string) => {
        if (table !== "workspaces") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: () => {
            const filters: Record<string, string> = {};
            return {
              eq: (column: string, value: string) => {
                filters[column] = value;
                return {
                  maybeSingle: async () => {
                    const workspace = state.workspaces.find(
                      (item) => item.id === filters.id
                    );
                    return {
                      data: workspace
                        ? { stripe_customer_id: workspace.stripe_customer_id }
                        : null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update: (payload: Partial<WorkspaceRecord>) => ({
            eq: async (_column: string, value: string) => {
              const workspace = state.workspaces.find((item) => item.id === value);
              if (!workspace) {
                return { error: { message: "workspace not found" } };
              }

              Object.assign(workspace, payload);
              return { error: null };
            },
          }),
        };
      },
    }));

    createStripeCheckoutSessionMock.mockResolvedValue({
      id: "cs_test_lifecycle",
      url: "https://checkout.stripe.com/c/pay/cs_test_lifecycle",
    });
    logBillingEventMock.mockResolvedValue(undefined);
  });

  it("keeps API authorization aligned across signup/bootstrap, invite, and role update", async () => {
    const bootstrapResponse = await postBootstrap(
      bootstrapRequest({
        workspaceName: "Lifecycle Regression Workspace",
      })
    );

    expect(bootstrapResponse.status).toBe(200);
    const bootstrapPayload = (await bootstrapResponse.json()) as { workspaceId: string };
    const workspaceId = bootstrapPayload.workspaceId;

    expect(state.workspaceMembers).toEqual(
      expect.arrayContaining([
        {
          workspace_id: workspaceId,
          user_id: OWNER_USER_ID,
          role: "owner",
        },
      ])
    );

    // Simulate invite acceptance creating membership as "member".
    inviteMember(workspaceId, INVITED_USER_ID, "member");

    setAuthUser({ id: INVITED_USER_ID, email: INVITED_EMAIL });

    const memberCheckoutAttempt = await postCheckout(
      checkoutRequest({
        workspaceId,
        plan: "starter",
      })
    );

    expect(memberCheckoutAttempt.status).toBe(403);
    expect(await memberCheckoutAttempt.json()).toMatchObject({
      error: "Owner/admin access is required",
    });

    // Simulate role update from member -> admin.
    updateMemberRole(workspaceId, INVITED_USER_ID, "admin");

    const adminCheckoutAttempt = await postCheckout(
      checkoutRequest({
        workspaceId,
        plan: "starter",
      })
    );

    expect(adminCheckoutAttempt.status).toBe(200);
    expect(await adminCheckoutAttempt.json()).toMatchObject({
      workspaceId,
      plan: "starter",
      mode: "stripe_checkout_session",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_lifecycle",
    });
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });
});
