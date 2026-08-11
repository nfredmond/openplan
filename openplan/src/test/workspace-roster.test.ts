import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEPARTED_ASSIGNEE_SENTENCE,
  assigneeCountsAsUnassigned,
  isOnRoster,
  loadWorkspaceRoster,
  resolveAssignee,
  type RosterMember,
  type RosterServiceClient,
} from "@/lib/workspaces/roster";

/**
 * The roster/identity seam. The load-bearing fact under all of it: the only
 * SELECT policy on workspace_members is members_read_own (user_id =
 * auth.uid()), so an RLS roster read returns exactly one row — the caller.
 * The helper therefore reads with the SERVICE role, and must itself enforce
 * the authorization RLS no longer can: the caller has to be a member of the
 * workspace being read.
 *
 * The fake service client below is FILTER-FAITHFUL: it answers from its row
 * set according to the .eq() filters actually applied, the way the live
 * database would. A fake that ignores filters cannot tell "checked the
 * caller's membership in the requested workspace" from "checked nothing".
 */

type MemberRow = { workspace_id: string; user_id: string; role: string };

function fakeService(options: {
  rows: MemberRow[];
  emails?: Record<string, string>;
  callerCheckError?: string;
  rosterError?: string;
  emailLookupFailsFor?: string[];
}): { client: RosterServiceClient; emailLookups: string[] } {
  const emailLookups: string[] = [];
  const client: RosterServiceClient = {
    from(table: string) {
      if (table !== "workspace_members") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select() {
          const filters: Array<[string, string]> = [];
          const chain = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return chain;
            },
            order() {
              return chain;
            },
            async maybeSingle() {
              if (options.callerCheckError) {
                return { data: null, error: { message: options.callerCheckError } };
              }
              const match = options.rows.find((row) =>
                filters.every(([column, value]) => row[column as keyof MemberRow] === value)
              );
              return { data: match ?? null, error: null };
            },
            async limit(count: number) {
              if (options.rosterError) {
                return { data: null, error: { message: options.rosterError } };
              }
              const matches = options.rows
                .filter((row) =>
                  filters.every(([column, value]) => row[column as keyof MemberRow] === value)
                )
                .slice(0, count);
              return { data: matches, error: null };
            },
          };
          return chain;
        },
      };
    },
    auth: {
      admin: {
        async getUserById(id: string) {
          emailLookups.push(id);
          if (options.emailLookupFailsFor?.includes(id)) {
            throw new Error("auth admin unavailable");
          }
          const email = options.emails?.[id];
          return { data: { user: email ? { email } : null } };
        },
      },
    },
  };
  return { client, emailLookups };
}

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_WORKSPACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CALLER = "11111111-1111-4111-8111-111111111111";
const TEAMMATE = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const DEPARTED = "99999999-9999-4999-8999-999999999999";

const TEAM: MemberRow[] = [
  { workspace_id: WORKSPACE, user_id: CALLER, role: "member" },
  { workspace_id: WORKSPACE, user_id: TEAMMATE, role: "admin" },
  { workspace_id: WORKSPACE, user_id: THIRD, role: "viewer" },
  // A decoy row in another workspace: it must never appear in this roster.
  { workspace_id: OTHER_WORKSPACE, user_id: DEPARTED, role: "owner" },
];

const EMAILS: Record<string, string> = {
  [CALLER]: "caller@agency.gov",
  [TEAMMATE]: "teammate@agency.gov",
  [THIRD]: "viewer@agency.gov",
};

describe("loadWorkspaceRoster", () => {
  it("returns the whole team, not just the caller — the members_read_own trap", async () => {
    const { client } = fakeService({ rows: TEAM, emails: EMAILS });
    const result = await loadWorkspaceRoster(client, CALLER, WORKSPACE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members).toHaveLength(3);
    expect(result.members.map((member) => member.userId).sort()).toEqual(
      [CALLER, TEAMMATE, THIRD].sort()
    );
    // Emails and roles are carried per member, not copied from the caller.
    expect(result.members.find((m) => m.userId === TEAMMATE)).toEqual({
      userId: TEAMMATE,
      email: "teammate@agency.gov",
      role: "admin",
    });
    // The other workspace's member never leaks in.
    expect(result.members.some((m) => m.userId === DEPARTED)).toBe(false);
  });

  it("refuses a caller who is not a member of the workspace", async () => {
    const { client } = fakeService({ rows: TEAM, emails: EMAILS });
    const result = await loadWorkspaceRoster(client, DEPARTED, WORKSPACE);
    expect(result).toEqual({ ok: false, reason: "caller_not_member", message: null });
  });

  it("checks membership against the REQUESTED workspace, not membership anywhere", async () => {
    // The caller IS a member — of the other workspace. Asking for this one
    // must still refuse: a cross-workspace caller with any membership at all
    // would otherwise read every roster.
    const { client } = fakeService({ rows: TEAM, emails: EMAILS });
    const result = await loadWorkspaceRoster(client, DEPARTED, OTHER_WORKSPACE);
    expect(result.ok).toBe(true);

    const denied = await loadWorkspaceRoster(client, CALLER, OTHER_WORKSPACE);
    expect(denied).toEqual({ ok: false, reason: "caller_not_member", message: null });
  });

  it("reports a failed roster read as a failure, never as an empty team", async () => {
    const { client } = fakeService({ rows: TEAM, rosterError: "connection lost" });
    const result = await loadWorkspaceRoster(client, CALLER, WORKSPACE);
    expect(result).toEqual({ ok: false, reason: "roster_read_failed", message: "connection lost" });
  });

  it("reports a failed membership check as its own failure", async () => {
    const { client } = fakeService({ rows: TEAM, callerCheckError: "timeout" });
    const result = await loadWorkspaceRoster(client, CALLER, WORKSPACE);
    expect(result).toEqual({ ok: false, reason: "membership_check_failed", message: "timeout" });
  });

  it("skips email resolution entirely when asked to", async () => {
    const { client, emailLookups } = fakeService({ rows: TEAM, emails: EMAILS });
    const result = await loadWorkspaceRoster(client, CALLER, WORKSPACE, { resolveEmails: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members.every((member) => member.email === null)).toBe(true);
    expect(emailLookups).toEqual([]);
  });

  it("yields a null email for a failed auth lookup without failing the roster", async () => {
    const { client } = fakeService({
      rows: TEAM,
      emails: EMAILS,
      emailLookupFailsFor: [TEAMMATE],
    });
    const result = await loadWorkspaceRoster(client, CALLER, WORKSPACE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members.find((m) => m.userId === TEAMMATE)?.email).toBeNull();
    expect(result.members.find((m) => m.userId === CALLER)?.email).toBe("caller@agency.gov");
  });
});

describe("resolveAssignee", () => {
  const roster: RosterMember[] = [
    { userId: CALLER, email: "caller@agency.gov", role: "member" },
    { userId: TEAMMATE, email: "teammate@agency.gov", role: "admin" },
  ];

  it("resolves the RIGHT member, not the first one", () => {
    const resolved = resolveAssignee(roster, { assigneeUserId: TEAMMATE });
    expect(resolved).toEqual({ kind: "member", member: roster[1] });
  });

  it("resolves a recorded assignee who left as departed, with the exact shared sentence", () => {
    const resolved = resolveAssignee(roster, { assigneeUserId: DEPARTED, ownerLabel: "Old Name" });
    expect(resolved).toEqual({
      kind: "departed",
      userId: DEPARTED,
      sentence: "Unassigned — previously a member",
    });
    // The sentence constant and the literal must agree — surfaces render the constant.
    expect(DEPARTED_ASSIGNEE_SENTENCE).toBe("Unassigned — previously a member");
  });

  it("resolves a free-text owner label as an external party, trimmed", () => {
    expect(resolveAssignee(roster, { ownerLabel: "  GHD (consultant)  " })).toEqual({
      kind: "external",
      label: "GHD (consultant)",
    });
  });

  it("resolves nothing at all as unassigned", () => {
    expect(resolveAssignee(roster, {})).toEqual({ kind: "unassigned" });
    expect(resolveAssignee(roster, { assigneeUserId: null, ownerLabel: "   " })).toEqual({
      kind: "unassigned",
    });
  });

  it("counts departed and unassigned — and only those — as unassigned for queues", () => {
    expect(assigneeCountsAsUnassigned(resolveAssignee(roster, {}))).toBe(true);
    expect(assigneeCountsAsUnassigned(resolveAssignee(roster, { assigneeUserId: DEPARTED }))).toBe(true);
    expect(assigneeCountsAsUnassigned(resolveAssignee(roster, { assigneeUserId: TEAMMATE }))).toBe(false);
    expect(assigneeCountsAsUnassigned(resolveAssignee(roster, { ownerLabel: "Consultant" }))).toBe(false);
  });

  it("isOnRoster answers per user id", () => {
    expect(isOnRoster(roster, TEAMMATE)).toBe(true);
    expect(isOnRoster(roster, DEPARTED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/roster — the member-visible route over the helper.
// ---------------------------------------------------------------------------

const getUserMock = vi.fn();
const serviceFactoryMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => {
      // The roster must never be read through the RLS client: members_read_own
      // would silently shrink the team to the caller. Fail loudly instead.
      throw new Error("The roster route must not read tables through the RLS client");
    },
  }),
  createServiceRoleClient: () => serviceFactoryMock(),
}));

import { GET as getRoster } from "@/app/api/workspaces/roster/route";

function rosterRequest(query = `?workspaceId=${WORKSPACE}`) {
  return new NextRequest(`http://localhost/api/workspaces/roster${query}`);
}

describe("GET /api/workspaces/roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: CALLER } } });
    serviceFactoryMock.mockImplementation(
      () => fakeService({ rows: TEAM, emails: EMAILS }).client
    );
  });

  it("400s without a workspace id", async () => {
    expect((await getRoster(rosterRequest(""))).status).toBe(400);
  });

  it("401s when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect((await getRoster(rosterRequest())).status).toBe(401);
  });

  it("404s for a non-member rather than revealing the workspace exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: DEPARTED } } });
    expect((await getRoster(rosterRequest())).status).toBe(404);
  });

  it("lists id + email + role for every member — and NOTHING else", async () => {
    const res = await getRoster(rosterRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callerUserId).toBe(CALLER);
    // toEqual is strict about extra keys: joined_at or any future column
    // leaking into this member-visible payload fails here.
    expect(body.members).toEqual([
      { userId: CALLER, email: "caller@agency.gov", role: "member" },
      { userId: TEAMMATE, email: "teammate@agency.gov", role: "admin" },
      { userId: THIRD, email: "viewer@agency.gov", role: "viewer" },
    ]);
  });

  it("answers 500 on a failed roster read — never a 200 with an empty team", async () => {
    serviceFactoryMock.mockImplementation(
      () => fakeService({ rows: TEAM, rosterError: "connection lost" }).client
    );
    const res = await getRoster(rosterRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to load the workspace roster");
    expect(body.members).toBeUndefined();
  });

  it("answers 500 when the membership check itself fails, not 404", async () => {
    serviceFactoryMock.mockImplementation(
      () => fakeService({ rows: TEAM, callerCheckError: "timeout" }).client
    );
    const res = await getRoster(rosterRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to verify workspace access");
  });
});
