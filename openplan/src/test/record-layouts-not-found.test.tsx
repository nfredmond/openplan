/**
 * KI-2026-11-14-280: the plan, program, project and RTP cycle layouts answer a
 * real 404 for a record the reader cannot see, and the public portal layout
 * answers one for an address that reaches no campaign.
 *
 * Each record layout is held to five cases with a fake client that applies
 * row security the way the SELECT policies do (only rows in the reader's
 * workspace come back): a visible record renders the page, an absent record
 * and another workspace's record take the same path to the same 404, a
 * malformed id is refused before any query, and a failed read renders the
 * page so it can say the record could not be read.
 *
 * BLIND CATEGORY: this does not prove the HTTP status (that depends on Next.js
 * rendering the layout before `loading.tsx` streams; the lane's before and
 * after tables measure it on a running server) or the real row-security
 * policies (RLS Isolation in CI does).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
const notFoundMock = vi.fn(() => {
  throw NOT_FOUND;
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: vi.fn(),
}));

const READER_WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_SUCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ROWS = [
  { id: OWN, workspace_id: READER_WORKSPACE },
  { id: OTHER, workspace_id: OTHER_WORKSPACE },
];

type Query = { table: string; columns: string; filters: Array<[string, unknown]>; terminal: string };
let queries: Query[] = [];
let failReads = false;

/** A cookie-scoped client stand-in: the reader sees only their workspace's rows. */
function readerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "reader" } }, error: null }) },
    from(table: string) {
      const query: Query = { table, columns: "", filters: [], terminal: "" };
      queries.push(query);
      const answer = (terminal: string) => {
        query.terminal = terminal;
        if (failReads) return { data: null, error: { code: "08006", message: "connection refused" } };
        const match = ROWS.filter((row) => row.workspace_id === READER_WORKSPACE).find((row) =>
          query.filters.every(([column, value]) => row[column as keyof typeof row] === value)
        );
        if (match) return { data: match, error: null };
        // `.single()` reports an empty answer as an error; `.maybeSingle()` as a null row.
        return terminal === "single"
          ? { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }
          : { data: null, error: null };
      };
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          return answer("maybeSingle");
        },
        async single() {
          return answer("single");
        },
      };
      return builder;
    },
  };
}

const createClientMock = vi.fn(async () => readerClient());
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
  createServiceRoleClient: () => serviceClient(),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: READER_WORKSPACE, role: "owner" },
    workspace: { id: READER_WORKSPACE },
  }),
}));

import PlanRecordLayout from "@/app/(app)/plans/[planId]/layout";
import ProgramRecordLayout from "@/app/(app)/programs/[programId]/layout";
import ProjectRecordLayout from "@/app/(app)/projects/[projectId]/layout";
import RtpCycleRecordLayout from "@/app/(app)/rtp/[rtpCycleId]/layout";
import PortalCampaignLayout from "@/app/(portal)/engage/[shareToken]/layout";

const CHILD = <main data-testid="record-page">record</main>;

type RecordLayout = (props: { children: React.ReactNode; params: Promise<Record<string, string>> }) => Promise<unknown>;

const FAMILIES: Array<{ name: string; table: string; param: string; layout: RecordLayout; folder: string; children: string[] }> = [
  { name: "plans", table: "plans", param: "planId", layout: PlanRecordLayout as RecordLayout, folder: "plans/[planId]", children: [] },
  {
    name: "programs",
    table: "programs",
    param: "programId",
    layout: ProgramRecordLayout as RecordLayout,
    folder: "programs/[programId]",
    children: ["measure", "work-program"],
  },
  {
    name: "projects",
    table: "projects",
    param: "projectId",
    layout: ProjectRecordLayout as RecordLayout,
    folder: "projects/[projectId]",
    children: ["management"],
  },
  {
    name: "RTP cycles",
    table: "rtp_cycles",
    param: "rtpCycleId",
    layout: RtpCycleRecordLayout as RecordLayout,
    folder: "rtp/[rtpCycleId]",
    children: ["document", "extraction", "extraction/chapters"],
  },
];

beforeEach(() => {
  queries = [];
  failReads = false;
  serviceRows = [];
  serviceFails = false;
  notFoundMock.mockClear();
  createClientMock.mockClear();
});

describe.each(FAMILIES)("the $name record layout", ({ table, param, layout, folder, children }) => {
  const render = (id: string) => layout({ children: CHILD, params: Promise.resolve({ [param]: id }) });
  const recordQueries = () => queries.filter((query) => query.table === table);

  it("renders the page for a record the reader's client can see", async () => {
    await expect(render(OWN)).resolves.toBe(CHILD);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(recordQueries()).toHaveLength(1);
    expect(recordQueries()[0].filters[0]).toEqual(["id", OWN]);
    // The page's own detail projection, so the page can reuse this read.
    expect(recordQueries()[0].columns).toMatch(/^id, workspace_id, /);
  });

  it("answers not found for a record that does not exist", async () => {
    await expect(render(NO_SUCH)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("answers not found for another workspace's record, on the same path as an absent one", async () => {
    await expect(render(OTHER)).rejects.toBe(NOT_FOUND);
    const otherWorkspaceQueries = queries;
    queries = [];
    await expect(render(NO_SUCH)).rejects.toBe(NOT_FOUND);
    const shape = (list: Query[]) => list.map(({ table: t, columns, filters, terminal }) => [t, columns, filters.map(([c]) => c), terminal]);
    expect(shape(otherWorkspaceQueries)).toEqual(shape(queries));
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it("answers not found for a malformed id before any query", async () => {
    await expect(render("not-a-record")).rejects.toBe(NOT_FOUND);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("renders the page when the read fails, so the page can say the record could not be read", async () => {
    failReads = true;
    await expect(render(OWN)).resolves.toBe(CHILD);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it.each(children.length ? children : ["(none)"])("covers the child page %s, which renders inside this layout", (child) => {
    if (child === "(none)") return;
    const recordDir = path.join(process.cwd(), "src", "app", "(app)", ...folder.split("/"));
    expect(existsSync(path.join(recordDir, "layout.tsx"))).toBe(true);
    // Next.js renders every page below a folder inside that folder's layout,
    // so the child gets the parent's 404 before its own code runs.
    expect(existsSync(path.join(recordDir, ...child.split("/"), "page.tsx"))).toBe(true);
  });
});

// ---- The public portal: an anonymous, service-role read with a status filter as the access rule.

type ServiceRow = { id: string; share_token: string; public_slug: string | null; status: string };
let serviceRows: ServiceRow[] = [];
let serviceFails = false;

function serviceClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          if (table !== "engagement_campaigns") return { data: null, error: null };
          if (serviceFails) return { data: null, error: { message: "connection refused" } };
          const match = serviceRows.find((row) => filters.every(([column, value]) => row[column as keyof ServiceRow] === value));
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

describe("the public portal layout", () => {
  const render = (shareToken: string) =>
    PortalCampaignLayout({ children: CHILD, params: Promise.resolve({ shareToken }) });

  it("renders the page for an active campaign's token", async () => {
    serviceRows = [{ id: OWN, share_token: "active-token-1234", public_slug: null, status: "active" }];
    await expect(render("active-token-1234")).resolves.toBe(CHILD);
  });

  it("renders the closed campaign's page, not a 404, so the ended notice still shows", async () => {
    serviceRows = [{ id: OWN, share_token: "closed-token-1234", public_slug: null, status: "closed" }];
    await expect(render("closed-token-1234")).resolves.toBe(CHILD);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders a campaign reached by its printable slug", async () => {
    serviceRows = [{ id: OWN, share_token: "slug-token-12345", public_slug: "downtown-plan", status: "active" }];
    await expect(render("Downtown-Plan")).resolves.toBe(CHILD);
  });

  it.each([
    ["an unknown token", "no-such-token-1234", []],
    ["a token too short to be one", "short", []],
    ["a draft campaign's token", "draft-token-1234", [{ id: OWN, share_token: "draft-token-1234", public_slug: null, status: "draft" }]],
    ["an archived campaign's token", "archived-tok-1234", [{ id: OWN, share_token: "archived-tok-1234", public_slug: null, status: "archived" }]],
  ] as Array<[string, string, ServiceRow[]]>)("answers not found for %s", async (_label, token, rows) => {
    serviceRows = rows;
    await expect(render(token)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("renders the page when the lookup fails, so the error page says the page could not load", async () => {
    serviceFails = true;
    await expect(render("active-token-1234")).resolves.toBe(CHILD);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("covers the about page, which renders inside this layout", () => {
    const dir = path.join(process.cwd(), "src", "app", "(portal)", "engage", "[shareToken]");
    expect(existsSync(path.join(dir, "layout.tsx"))).toBe(true);
    expect(existsSync(path.join(dir, "about", "page.tsx"))).toBe(true);
  });
});
