import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaProjectPlace, bcaProjectRow } from "./fixtures/bca/project-place";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
import { createHash } from "node:crypto";
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
const document = () => reviewBcaProjectPlace(exampleBcaDocument(project), bcaProjectPlace());
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
    project: bcaProjectRow(),
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
    mocks.from.mockReturnValueOnce(query({ data: null, error: null })).mockReturnValue(q);
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
    mocks.from.mockReturnValueOnce(query({ data: null, error: null })).mockReturnValueOnce(insert).mockReturnValueOnce(prior);
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
        .mockReturnValueOnce(query({ data: null, error: null }))
        .mockReturnValueOnce(insert)
        .mockReturnValueOnce(query({ data: { id, ...row }, error: null }));
      expect((await POST(request({ id, document: doc }), context)).status).toBe(
        409,
      );
    }
  });
  it("keeps a failed recovery unresolved", async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: null, error: null }))
      .mockReturnValueOnce(query({ data: null, error: { code: "23505" } }))
      .mockReturnValueOnce(query({ data: null, error: { code: "57014" } }));
    expect(
      (await POST(request({ id, document: document() }), context)).status,
    ).toBe(503);
  });
  it("does not insert when the initial request-identity read is unresolved", async () => {
    const q = query({ data: null, error: { code: "57014" } });
    mocks.from.mockReturnValue(q);
    expect((await POST(request({ id, document: document() }), context)).status).toBe(503);
    expect(q.insert).not.toHaveBeenCalled();
  });
  it("reports a native locked-source mismatch without replacing or rebinding the request", async () => {
    const doc = document(), before = canonicalBcaJson(doc);
    const prior = query({ data: null, error: null });
    const insertion = query({ data: null, error: { code: "PT409" } });
    mocks.from.mockReturnValueOnce(prior).mockReturnValueOnce(insertion);
    const response = await POST(request({ id, document: doc }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("project changed before the database retained");
    expect(insertion.insert).toHaveBeenCalledWith(expect.objectContaining({ id, document_json: doc }));
    expect(canonicalBcaJson(doc)).toBe(before);
    expect(mocks.from).toHaveBeenCalledTimes(2);
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
    expect(p.versions[0].projectPlaceReview.status).toBe("matched-at-read");
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
  it("refuses new legacy, forged-place and stale-microsecond saves without inserting", async () => {
    const q = query({ data: null, error: null });
    mocks.from.mockReturnValue(q);
    const bound = document();
    if (bound.schemaVersion !== 2) throw new Error("Expected bound fixture");
    for (const doc of [exampleBcaDocument(project),
      { ...bound, projectPlace: { ...bound.projectPlace, projectUpdatedAt: "2026-10-19T01:02:03.123457+00:00" } },
      { ...bound, projectPlace: { ...bound.projectPlace, jurisdiction: { version: 1, state: "unresolved", entries: [], recordedBy: user, recordedAt: "2026-10-19T00:00:00Z" } } },
    ]) expect((await POST(request({ id, document: doc }), context)).status).toBe(409);
    expect(q.insert).not.toHaveBeenCalled();
    expect(q.eq).toHaveBeenCalledWith("project_id", project);
    expect(q.select).toHaveBeenCalledWith("id, project_id, created_by, created_at, document_json, engine_version");
  });
  it("recovers exact legacy and stale saves before mutable place validation", async () => {
    for (const current of [{ id: project }, { ...bcaProjectRow(), updated_at: "2026-10-19T01:02:03.123457+00:00" }]) {
      mocks.access.mockResolvedValue({ supabase: { from: mocks.from }, user: { id: user }, project: current });
      for (const doc of [exampleBcaDocument(project), document()]) {
        const q = query({ data: { id, created_by: user, document_json: doc }, error: null });
        mocks.from.mockReturnValue(q);
        const response = await POST(request({ id, document: doc }), context);
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.version.document_json).toEqual(doc);
        expect(payload.version.inputHash).toBe(createHash("sha256").update(canonicalBcaJson(doc)).digest("hex"));
        expect(q.insert).not.toHaveBeenCalled();
      }
    }
  });
  it("refuses an absent or malformed current project scope for a new save", async () => {
    const q = query({ data: null, error: null });
    mocks.from.mockReturnValue(q);
    for (const row of [{ id: project }, { ...bcaProjectRow(), jurisdiction_context: { bad: true } }]) {
      mocks.access.mockResolvedValueOnce({ supabase: { from: mocks.from }, user: { id: user }, project: row });
      expect((await POST(request({ id, document: document() }), context)).status).toBe(409);
    }
    expect(q.insert).not.toHaveBeenCalled();
  });
  it("leaves legacy history unbound and marks unreadable documents separately", async () => {
    const legacy = exampleBcaDocument(project);
    const q = query({ data: [{ id, document_json: legacy }, { id: user, document_json: { bad: true } }], error: null });
    mocks.from.mockReturnValue(q);
    const response = await GET(new NextRequest("http://localhost/"), context);
    const payload = await response.json();
    expect(payload.versions[0].projectPlaceReview.status).toBe("unbound");
    expect(payload.versions[0].document_json).toEqual(legacy);
    expect(payload.versions[1].projectPlaceReview.status).toBe("invalid-document");
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
