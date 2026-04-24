import { describe, expect, it, vi } from "vitest";
import {
  buildInvitationUrl,
  createWorkspaceInvitation,
  defaultInvitationExpiresAt,
  hashInvitationToken,
  higherWorkspaceRole,
  normalizeInvitationEmail,
  normalizeInvitationRole,
  tokenPrefixFromHash,
} from "@/lib/workspaces/invitations";

function createInvitationClient(existingId?: string) {
  const storedRows: Record<string, unknown>[] = [];
  const maybeSingleMock = vi.fn(async () => ({
    data: existingId ? { id: existingId } : null,
    error: null,
  }));
  const existingEqMock = vi.fn(() => existingQuery);
  const existingQuery = {
    eq: existingEqMock,
    maybeSingle: maybeSingleMock,
  };
  const selectExistingMock = vi.fn(() => existingQuery);

  const singleMock = vi.fn(async () => ({
    data: {
      id: existingId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ...storedRows.at(-1),
    },
    error: null,
  }));
  const selectMutationMock = vi.fn(() => ({ single: singleMock }));
  const updateEqMock = vi.fn(() => ({ select: selectMutationMock }));
  const updateMock = vi.fn((payload: Record<string, unknown>) => {
    storedRows.push(payload);
    return { eq: updateEqMock };
  });
  const insertMock = vi.fn((payload: Record<string, unknown>) => {
    storedRows.push(payload);
    return { select: selectMutationMock };
  });

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table !== "workspace_invitations") throw new Error(`Unexpected table: ${table}`);
        return {
          select: selectExistingMock,
          insert: insertMock,
          update: updateMock,
        };
      }),
    },
    insertMock,
    updateMock,
    updateEqMock,
    storedRows,
  };
}

describe("workspace invitation helpers", () => {
  it("normalizes invited emails and constrained roles", () => {
    expect(normalizeInvitationEmail(" Planner@Agency.Gov ")).toBe("planner@agency.gov");
    expect(normalizeInvitationRole(" ADMIN ")).toBe("admin");
    expect(normalizeInvitationRole("owner")).toBe("owner");
    expect(normalizeInvitationRole("viewer")).toBeNull();
  });

  it("hashes tokens and derives a non-secret lookup prefix", () => {
    const token = "plain-invitation-token";
    const tokenHash = hashInvitationToken(token);

    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).not.toContain(token);
    expect(tokenPrefixFromHash(tokenHash)).toBe(tokenHash.slice(0, 12));
  });

  it("builds sign-up URLs that carry invite and dashboard redirect context", () => {
    expect(buildInvitationUrl("https://openplan.example", "token-123")).toBe(
      "https://openplan.example/sign-up?invite=token-123&redirect=%2Fdashboard"
    );
  });

  it("defaults invitation expiry to 14 days", () => {
    expect(defaultInvitationExpiresAt(new Date("2026-04-24T12:00:00.000Z")).toISOString()).toBe(
      "2026-05-08T12:00:00.000Z"
    );
  });

  it("keeps the higher existing workspace role when accepting an invite", () => {
    expect(higherWorkspaceRole("owner", "member")).toBe("owner");
    expect(higherWorkspaceRole("member", "admin")).toBe("admin");
    expect(higherWorkspaceRole("admin", "member")).toBe("admin");
  });

  it("inserts a pending invitation while storing only a token hash", async () => {
    const { client, insertMock, storedRows } = createInvitationClient();

    const result = await createWorkspaceInvitation({
      supabase: client as never,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      email: " Planner@Agency.Gov ",
      role: "member",
      invitedByUserId: "22222222-2222-4222-8222-222222222222",
      origin: "https://openplan.example",
      now: new Date("2026-04-24T12:00:00.000Z"),
    });

    expect(result.reissued).toBe(false);
    expect(result.invitationUrl).toContain("/sign-up?invite=");
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(storedRows[0]).toMatchObject({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      email: "Planner@Agency.Gov",
      email_normalized: "planner@agency.gov",
      role: "member",
      status: "pending",
      invited_by_user_id: "22222222-2222-4222-8222-222222222222",
      expires_at: "2026-05-08T12:00:00.000Z",
    });
    expect(storedRows[0]).toHaveProperty("token_hash");
    expect(storedRows[0]).not.toHaveProperty("token");
  });

  it("reissues an existing pending invitation for the same email/workspace", async () => {
    const { client, updateMock, updateEqMock } = createInvitationClient(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    );

    const result = await createWorkspaceInvitation({
      supabase: client as never,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      email: "planner@agency.gov",
      role: "admin",
      origin: "https://openplan.example",
    });

    expect(result.reissued).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateEqMock).toHaveBeenCalledWith("id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});
