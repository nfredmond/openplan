import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { comparisonFixture, comparisonId, comparisonRevision, comparisonCostFixture, rehashComparison } from "./fixtures/safety/comparison";
import type { SafetyComparisonSnapshot } from "@/lib/reports/safety-comparison-snapshot";

const mocks = vi.hoisted(() => ({ create: vi.fn(), service: vi.fn(), access: vi.fn(), pdf: vi.fn(), upload: vi.fn(), rpc: vi.fn() }));
let activeComparison: ReturnType<typeof comparisonFixture>;
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/reports/api", () => ({ loadReportAccess: mocks.access }));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: mocks.pdf }));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: () => "manual" }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { generateSafetyComparison } from "@/lib/reports/safety-comparison-server";

type PersistenceArgs = { p_actor: string; p_report: string; p_command_text: string; p_artifact: {
  id: string; artifact_kind: string; generated_at: string; storage_path: string;
  metadata_json: { safetyPlanSnapshotV2: SafetyComparisonSnapshot; sha256: string };
} };

function query(data: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  const comparison = activeComparison = comparisonFixture();
  const prior = query(null), selected = query(comparison);
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: comparisonId(1) } } }) },
    from: (table: string) => table === "report_safety_comparison_generations" ? prior : table === "report_safety_comparison_revisions" ? selected : (() => { throw new Error(`Unexpected table ${table}`); })() });
  mocks.access.mockResolvedValue({ report: { id: comparison.report_id, project_id: comparison.project_id, workspace_id: comparison.workspace_id,
    metadata_json: { safetyComparisonV2: { version: "openplan.safety-comparison.v2", revisionId: comparison.id, hash: comparison.content_hash } } }, membership: { role: "member" }, error: null });
  mocks.pdf.mockResolvedValue({ bytes: new TextEncoder().encode("SYNTHETIC renderer bytes, not a native PDF"), engine: "builtin", pageCount: 1, disclosure: "Synthetic renderer double" });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (_name: string, args: PersistenceArgs) => {
    const command = JSON.parse(args.p_command_text);
    return { error: null, data: { schema: "openplan.safety-comparison-generation.v2", requestId: command.requestId,
      requestHash: createHash("sha256").update(args.p_command_text).digest("hex"), artifactId: command.requestId,
      reportId: comparison.report_id, projectId: comparison.project_id, workspaceId: comparison.workspace_id,
      revisionId: comparison.id, contentHash: comparison.content_hash, snapshotHash: args.p_artifact.metadata_json.safetyPlanSnapshotV2.hash,
      sourceProjectRevision: command.expectedProjectRevision, sourceReportRevision: command.expectedReportRevision,
      projectRevision: "2026-10-19T12:00:00.123458+00:00", reportRevision: "2026-10-19T12:00:00.123457+00:00" } };
  });
  mocks.service.mockReturnValue({ rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload }) } });
});

describe("Safety comparison generation renderer contract", () => {
  it.each(["stored", "ready"] as const)("generates from retained %s estimate metadata without changing its state or exact amount", async status => {
    const comparison = activeComparison;
    const cost = comparisonCostFixture(status);
    comparison.payload.inputs.alternatives[1].cost = { kind: "project_estimate", scopeRelationship: cost.scopeRelationship, scopeRationale: "Synthetic contextual estimate", estimatingBasis: cost.estimatingBasis, includedElements: cost.includedElements };
    comparison.payload.costs = [cost];
    rehashComparison(comparison);
    mocks.access.mockResolvedValue({ report: { id: comparison.report_id, project_id: comparison.project_id, workspace_id: comparison.workspace_id,
      metadata_json: { safetyComparisonV2: { version: "openplan.safety-comparison.v2", revisionId: comparison.id, hash: comparison.content_hash } } }, membership: { role: "member" }, error: null });
    const response = await generateSafetyComparison(new NextRequest("http://localhost/api/reports/generate", { method: "POST" }), comparison.report_id, {
      requestId: comparisonId(70), revisionId: comparison.id, contentHash: comparison.content_hash, expectedReportRevision: comparisonRevision, expectedProjectRevision: comparisonRevision, format: "pdf",
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [, args] = mocks.rpc.mock.calls[0] as [string, PersistenceArgs];
    const retained = args.p_artifact.metadata_json.safetyPlanSnapshotV2.comparison.payload.costs[0];
    expect(retained).toEqual(comparison.payload.costs[0]);
    expect(retained.sourceDocument?.status).toBe(status);
    expect(retained.amount).toBe("100.01");
    expect(mocks.pdf.mock.calls[0][0]).toContain("Synthetic retained estimate.xlsx");
  });
  it("passes the immutable title and snapshot timestamp to the PDF renderer before retaining its receipt", async () => {
    const comparison = comparisonFixture();
    const command = { requestId: comparisonId(70), revisionId: comparison.id, contentHash: comparison.content_hash,
      expectedReportRevision: comparisonRevision, expectedProjectRevision: comparisonRevision, format: "pdf" };
    const response = await generateSafetyComparison(new NextRequest("http://localhost/api/reports/generate", {
      method: "POST", headers: { "x-test-harmless-note": "No execution authority" } }), comparison.report_id, command);
    expect(response.status).toBe(200);
    expect(mocks.pdf).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [name, args] = mocks.rpc.mock.calls[0] as [string, PersistenceArgs];
    expect(name).toBe("persist_safety_comparison_generation");
    const snapshot = args.p_artifact.metadata_json.safetyPlanSnapshotV2;
    expect(snapshot.generatedAt).toEqual(expect.any(String));
    expect(mocks.pdf).toHaveBeenCalledWith(expect.stringContaining("Synthetic input review"), {
      title: comparison.payload.inputs.title, generatedAt: snapshot.generatedAt,
      footerLabel: "Safety input comparison, effects unassessed",
    });
    expect(args.p_artifact.generated_at).toBe(snapshot.generatedAt);
    expect(args.p_artifact.id).toBe(command.requestId);
    expect(args.p_actor).toBe(comparisonId(1));
    expect(args.p_report).toBe(comparison.report_id);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(args.p_artifact.storage_path).toContain(`/${comparison.report_id}/${command.requestId}-`);
  });
});
// Renderer, Storage and RPC doubles do not prove native
// PDF rendering, database privileges/locks, immutable retention or browser use.
