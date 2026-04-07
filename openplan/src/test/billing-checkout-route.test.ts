import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const createStripeCheckoutSessionMock = vi.fn();
const logBillingEventMock = vi.fn();

const authGetUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const workspacesMaybeSingleMock = vi.fn();
const workspacesEqForSelectMock = vi.fn(() => ({ maybeSingle: workspacesMaybeSingleMock }));
const workspacesSelectMock = vi.fn(() => ({ eq: workspacesEqForSelectMock }));

const workspacesEqForUpdateMock = vi.fn();
const workspacesUpdateMock = vi.fn(() => ({ eq: workspacesEqForUpdateMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
  isMissingEnvironmentVariableError: (error: unknown) =>
    error instanceof Error && error.name === "MissingEnvironmentVariableError",
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

import { GET as getCheckout, POST as postCheckout } from "@/app/api/billing/checkout/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/billing/checkout safe messaging", () => {
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

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        role: "owner",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: (table: string) => {
        if (table === "workspace_members") {
          return { select: membershipSelectMock };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    workspacesMaybeSingleMock.mockResolvedValue({
      data: { stripe_customer_id: "cus_existing_123" },
      error: null,
    });

    workspacesEqForUpdateMock.mockResolvedValue({ error: null });

    createServiceRoleClientMock.mockImplementation(() => ({
      from: (table: string) => {
        if (table !== "workspaces") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: workspacesSelectMock,
          update: workspacesUpdateMock,
        };
      },
    }));

    createStripeCheckoutSessionMock.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    logBillingEventMock.mockResolvedValue(undefined);
  });

  it("rejects GET so checkout cannot be launched from a link prefetch", async () => {
    const response = await getCheckout();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toMatchObject({ error: "Use POST to initialize billing checkout." });
    expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("returns 401 Unauthorized when user is unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postCheckout(
      jsonRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        plan: "starter",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 with owner/admin guidance when role is not authorized", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        role: "member",
      },
      error: null,
    });

    const response = await postCheckout(
      jsonRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        plan: "starter",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Owner/admin access is required" });
  });

  it("returns 503 when service-role billing configuration is missing", async () => {
    const missingEnvError = new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
    missingEnvError.name = "MissingEnvironmentVariableError";
    createServiceRoleClientMock.mockImplementationOnce(() => {
      throw missingEnvError;
    });

    const response = await postCheckout(
      jsonRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        plan: "starter",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Billing configuration unavailable" });
    expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("returns safe activation error when checkout session creation fails", async () => {
    createStripeCheckoutSessionMock.mockRejectedValueOnce(new Error("stripe unavailable"));

    const response = await postCheckout(
      jsonRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        plan: "starter",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to initialize checkout" });
  });
});
