import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { exampleBcaDocument } from "@/lib/bca/workbench/document";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/bca/workbench/access", () => ({
  authorizeBcaProject: mocks.access,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
import { GET, POST } from "@/app/api/projects/[projectId]/bca-analyses/route";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const context = { params: Promise.resolve({ projectId: project }) };
const document = () => exampleBcaDocument(project);
function query(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(
    `http://localhost/api/projects/${project}/bca-analyses`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    supabase: { from: mocks.from },
    user: { id: user },
    project: { id: project },
  });
});
describe("BCA HTTP custody", () => {
  it("rejects unsupported assistant execution before database access", async () => {
    expect(
      (
        await POST(
          request({}, { "x-openplan-assistant-approval-id": "approval" }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("propagates access refusal and rejects another project before insert", async () => {
    mocks.access.mockResolvedValueOnce({
      error: NextResponse.json({ error: "denied" }, { status: 403 }),
    });
    expect(
      (await POST(request({ id, document: document() }), context)).status,
    ).toBe(403);
    const doc = document();
    doc.projectId = user;
    expect((await POST(request({ id, document: doc }), context)).status).toBe(
      400,
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("stores exact inputs and server engine identity, never supplied totals", async () => {
    const doc = document();
    const q = query({
      data: { id, created_by: user, document_json: doc },
      error: null,
    });
    mocks.from.mockReturnValue(q);
    const response = await POST(request({ id, document: doc }), context);
    expect(response.status).toBe(201);
    expect(mocks.access).toHaveBeenCalledWith(project, true);
    expect(q.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        project_id: project,
        created_by: user,
        document_json: doc,
        engine_version: "annual-ledger-1",
      }),
    );
    expect(q.select).toHaveBeenCalledWith(
      "id, project_id, created_by, created_at, document_json, engine_version",
    );
    expect(
      (await response.json()).calculation.benefitCostRatio,
    ).toBeGreaterThan(1);
    expect(
      (await POST(request({ id, document: doc, total: 999 }), context)).status,
    ).toBe(400);
  });
  it("recovers only the same author's exact prior document", async () => {
    const doc = document(),
      insert = query({ data: null, error: { code: "23505" } }),
      prior = query({
        data: { id, created_by: user, document_json: doc },
        error: null,
      });
    mocks.from.mockReturnValueOnce(insert).mockReturnValueOnce(prior);
    const r = await POST(request({ id, document: doc }), context);
    expect(r.status).toBe(200);
    expect((await r.json()).replayed).toBe(true);
    expect(prior.eq).toHaveBeenCalledWith("project_id", project);
    expect(prior.eq).toHaveBeenCalledWith("id", id);
    expect(prior.select).toHaveBeenCalledWith(
      "id, project_id, created_by, created_at, document_json, engine_version",
    );
    for (const row of [
      { created_by: project, document_json: doc },
      { created_by: user, document_json: { ...doc, title: "Different" } },
    ]) {
      mocks.from
        .mockReturnValueOnce(insert)
        .mockReturnValueOnce(query({ data: { id, ...row }, error: null }));
      expect((await POST(request({ id, document: doc }), context)).status).toBe(
        409,
      );
    }
  });
  it("keeps a failed recovery unresolved", async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: null, error: { code: "23505" } }))
      .mockReturnValueOnce(query({ data: null, error: { code: "57014" } }));
    expect(
      (await POST(request({ id, document: document() }), context)).status,
    ).toBe(503);
  });
  it("scopes and pages history with a validated cursor", async () => {
    const q = query({
      data: Array.from({ length: 101 }, (_, i) => ({
        id: String(i),
        document_json: document(),
      })),
      error: null,
    });
    mocks.from.mockReturnValue(q);
    const r = await GET(
      new NextRequest(
        `http://localhost/?before=2026-10-06T00:00:00Z&beforeId=${id}`,
      ),
      context,
    );
    const p = await r.json();
    expect(p.versions).toHaveLength(100);
    expect(p.hasMore).toBe(true);
    expect(q.eq).toHaveBeenCalledWith("project_id", project);
    expect(q.or).toHaveBeenCalledWith(
      `created_at.lt.2026-10-06T00:00:00Z,and(created_at.eq.2026-10-06T00:00:00Z,id.lt.${id})`,
    );
    expect(q.select).toHaveBeenCalledWith(
      "id, project_id, created_by, created_at, document_json, engine_version",
    );
    for (const cursor of [
      "before=2026-10-06T00:00:00Z&beforeId=bad",
      `before=bad&beforeId=${id}`,
    ]) {
      expect((await GET(new NextRequest(`http://localhost/?${cursor}`), context)).status).toBe(400);
    }
  });
  it("canonicalizes key order without losing content", () => {
    expect(canonicalBcaJson({ b: 2, a: [{ z: 1, y: 2 }] })).toBe(
      canonicalBcaJson({ a: [{ y: 2, z: 1 }], b: 2 }),
    );
    expect(JSON.parse(canonicalBcaJson({ b: 2, a: 1 }))).toEqual({
      a: 1,
      b: 2,
    });
  });
});
