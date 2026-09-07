import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), loadAccess: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/programs/api", () => ({ loadProgramAccess: mocks.loadAccess }));
import { authorizeWorkProgram, loadWorkProgramPreparation } from "@/lib/programs/work-program/server";
const programId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";

describe("work-program route access boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: userId } } }) } });
    mocks.loadAccess.mockResolvedValue({ program: { id: programId, workspace_id: "workspace" }, membership: { role: "owner" }, allowed: true });
  });
  it("uses the read/write action and the authenticated actor, and allows ordinary manual preparation", async () => {
    const request = new NextRequest("http://localhost/api/example");
    const write = await authorizeWorkProgram(request, programId, true);
    expect(write.response).toBeUndefined(); expect(write.user?.id).toBe(userId);
    expect(mocks.loadAccess).toHaveBeenCalledWith(expect.anything(), programId, userId, "programs.write");
    await authorizeWorkProgram(request, programId, false);
    expect(mocks.loadAccess).toHaveBeenLastCalledWith(expect.anything(), programId, userId, "programs.read");
  });
  it("refuses unregistered agent writes before loading privileged resources", async () => {
    const request = new NextRequest("http://localhost/api/example", { headers: { "x-openplan-assistant-execution-source": "planner_agent_quick_link" } });
    expect((await authorizeWorkProgram(request, programId, true)).response?.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("refuses invalid identifiers, missing sessions, missing membership, viewer writes and failed authorization reads", async () => {
    const request = new NextRequest("http://localhost/api/example");
    expect((await authorizeWorkProgram(request, "not-a-uuid", true)).response?.status).toBe(400);
    mocks.createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await authorizeWorkProgram(request, programId, true)).response?.status).toBe(401);
    mocks.loadAccess.mockResolvedValueOnce({ program: null, membership: null });
    expect((await authorizeWorkProgram(request, programId, true)).response?.status).toBe(404);
    mocks.loadAccess.mockResolvedValueOnce({ program: { id: programId }, membership: null, allowed: true });
    expect((await authorizeWorkProgram(request, programId, true)).response?.status).toBe(404);
    mocks.loadAccess.mockResolvedValueOnce({ program: { id: programId }, membership: { role: "viewer" }, allowed: false });
    expect((await authorizeWorkProgram(request, programId, true)).response?.status).toBe(403);
    mocks.loadAccess.mockResolvedValueOnce({ error: { message: "database unavailable" } });
    expect((await authorizeWorkProgram(request, programId, true)).response?.status).toBe(503);
  });
});

describe("immutable source and revision loading", () => {
  it("captures the latest revision before paginating sources and binds history to that revision", async () => {
    const calls: { table: string; projection: string; filters: [string, unknown][]; range?: number[] }[] = [];
    const latest = { id: "revision", revision: 2, content_json: {} };
    const source = (index: number) => ({ id: `source-${index}`, kb_documents: { title: `Original ${index}` } });
    const client = { from: (table: string) => {
      const call = { table, projection: "", filters: [] as [string, unknown][], range: undefined as number[] | undefined }; calls.push(call);
      const query = {
        select: (value: string) => { call.projection = value; return query; },
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
        lte: (column: string, value: unknown) => { call.filters.push([`lte:${column}`, value]); return query; },
        order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: latest, error: null }),
        range: async (from: number, to: number) => { call.range = [from, to]; return { error: null, data: table.endsWith("sources") ? from === 0 ? Array.from({ length: 100 }, (_, index) => source(index)) : [source(100)] : [latest] }; },
      }; return query;
    } };
    const result = await loadWorkProgramPreparation(client as unknown as Parameters<typeof loadWorkProgramPreparation>[0], programId);
    expect(result.sources).toHaveLength(101); expect(result.sources[100].title).toBe("Original 100");
    expect(calls[0]).toMatchObject({ table: "program_work_program_revisions" });
    expect(calls[0].projection).toContain("content_json");
    for (const call of calls.filter((entry) => entry.table !== "program_work_program_extractions")) expect(call.filters).toContainEqual(["program_id", programId]);
    const versionCalls = calls.filter((entry) => entry.table === "program_work_program_extractions");
    expect(versionCalls).toHaveLength(101);
    for (const [index, call] of versionCalls.entries()) {
      expect(call.filters).toEqual([["source_id", `source-${index}`]]);
      expect(call.projection).toBe("id, source_id, document_extraction_id, extraction_json, content_sha256, page_count, created_at");
      expect(call.range).toEqual([0,99]);
    }
    expect(calls.filter((call) => call.table.endsWith("sources")).map((call) => call.range)).toEqual([[0, 99], [100, 199]]);
    expect(calls[1].projection).toBe("id, document_id, document_checksum, source_role, source_url, page_count, extraction_json, created_at, kb_documents(title)");
    expect(calls.at(-1)?.filters).toContainEqual(["lte:revision", 2]);
  });
});
