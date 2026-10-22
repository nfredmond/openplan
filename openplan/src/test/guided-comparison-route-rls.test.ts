// @vitest-environment node
// R82 private SOURCE PREPARATION. UNINSTALLED AND UNRUN.
// Run only after root admits the corrected437 readiness baseline and this join.
// Use Node's real react-server export condition for the server-only marker.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest as NativeNextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LIVE_RLS } from "./local-supabase-env";
import type { GuidedNativeFixture, Fixture } from "./fixtures/reports/guided-report-native-fixture";
import type { verifyGuidedComparisonReport as NativeVerifier } from "@/lib/reports/guided-comparison-server";
import type { readGuidedComparisonSelection as NativeSelectionReader } from "@/lib/reports/guided-comparison";
import type { guidedComparisonReportMarkup as NativeMarkup } from "@/lib/reports/guided-comparison-html";
import type { POST as NativeCreate } from "@/app/api/reports/route";
import type { GET as NativeReopen, PATCH as NativeSave } from "@/app/api/reports/[reportId]/route";
import type { POST as NativeGenerate } from "@/app/api/reports/[reportId]/generate/route";
import type { loadArtifactBytes as NativeByteReader, resolveRunWorkDir as NativeRunDirectory } from "@/lib/models/artifact-source";

const session = vi.hoisted(() => ({ member: null as SupabaseClient | null }));
// This is the sole injected boundary. Keep the real service client factory,
// verifier, queries, native commands, Storage, byte reader and handlers.
vi.mock("@/lib/supabase/server", async (original) => ({
  ...await original<typeof import("@/lib/supabase/server")>(),
  createClient: async () => {
    if (!session.member) throw new Error("Root-admitted ordinary native session is unavailable");
    return session.member;
  },
}));
// These erased signatures do not evaluate a server-only module at collection.
// Assign real exports in admitted beforeEach, after every environment restore.
let NextRequest: typeof NativeNextRequest;
let verifyGuidedComparisonReport: typeof NativeVerifier;
let readGuidedComparisonSelection: typeof NativeSelectionReader;
let guidedComparisonReportMarkup: typeof NativeMarkup;
let createReport: typeof NativeCreate;
let reopenReport: typeof NativeReopen;
let saveReport: typeof NativeSave;
let generateReport: typeof NativeGenerate;
let loadArtifactBytes: typeof NativeByteReader;
let resolveRunWorkDir: typeof NativeRunDirectory;

const createdSchema = z.object({ reportId: z.string().uuid() });
const generatedSchema = z.object({ reportId: z.string().uuid(), artifactId: z.string().uuid(),
  format: z.literal("html"), storagePath: z.string().min(1) });
const refusal = "Guided comparison cannot be included: headline KPI is missing or ambiguous.";
function request(url: string, method: "POST" | "PATCH", body: unknown) {
  return new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function context(reportId: string) { return { params: Promise.resolve({ reportId }) }; }
function pick(row: Record<string, unknown>) {
  return { id: row.id, run_id: row.run_id, attempt_id: row.attempt_id, kpi_name: row.kpi_name, value: row.value, unit: row.unit };
}
function sorted(rows: Record<string, unknown>[]) { return rows.map(pick).sort((a, b) => String(a.id).localeCompare(String(b.id))); }

// The ordinary mode skips native cases. No source-string guard substitutes for
// these subjects. A future full native invocation must register all six cases.
describe.skipIf(!LIVE_RLS)("Reports actual managed current KPI authority with retained evidence", () => {
  let native: GuidedNativeFixture;
  beforeAll(async () => {
    // No helper value import occurs during ordinary skipped collection.
    const { GuidedNativeFixture: Factory } = await import("./fixtures/reports/guided-report-native-fixture");
    native = await Factory.open(); session.member = native.member;
  });
  // Maintained Vitest configuration restores stubbed env before each case.
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", native.lifetime.apiUrl);
    // The maintained helper privately resolves the real service credential.
    // Never place credentials or tokens in this test's output or receipt.
    const { getLocalSupabaseEnv } = await import("./local-supabase-env");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", getLocalSupabaseEnv().SERVICE_ROLE_KEY);
    vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", native.workerRoot);
    // The target, ordinary session and real service/byte-root environment are
    // bound before any actual server-only subject or server factory evaluates.
    ({ NextRequest } = await import("next/server"));
    ({ verifyGuidedComparisonReport } = await import("@/lib/reports/guided-comparison-server"));
    ({ readGuidedComparisonSelection } = await import("@/lib/reports/guided-comparison"));
    ({ guidedComparisonReportMarkup } = await import("@/lib/reports/guided-comparison-html"));
    ({ POST: createReport } = await import("@/app/api/reports/route"));
    ({ GET: reopenReport, PATCH: saveReport } = await import("@/app/api/reports/[reportId]/route"));
    ({ POST: generateReport } = await import("@/app/api/reports/[reportId]/generate/route"));
    ({ loadArtifactBytes, resolveRunWorkDir } = await import("@/lib/models/artifact-source"));
  });
  afterAll(async () => { if (native) await native.close(); session.member = null; });

  function input(f: Fixture) {
    return { client: native.member as Parameters<typeof verifyGuidedComparisonReport>[0]["client"],
      workspaceId: f.workspaceId, projectId: f.projectId, snapshotId: f.snapshotId, reportType: "analysis_summary" };
  }
  async function createPlain(f: Fixture, selection = false): Promise<string> {
    const response = await createReport(request("http://localhost/api/reports", "POST", {
      projectId: f.projectId, reportType: "analysis_summary", title: "SYNTHETIC Reports authority, no scientific acceptance", sections: [],
      ...(selection ? { guidedComparisonSelectionV1: { version: 1, snapshotId: f.snapshotId } } : {}),
    }));
    expect(response.status, await response.clone().text()).toBe(201);
    const result = createdSchema.parse(await response.json()); native.recordReport(result.reportId); return result.reportId;
  }
  async function persistedSelection(reportId: string) {
    const result = await native.member.from("reports").select("id,metadata_json,updated_at,status").eq("id", reportId).single();
    expect(result.error).toBeNull(); expect(result.data).not.toBeNull();
    return { report: result.data!, selection: readGuidedComparisonSelection(result.data!.metadata_json) };
  }
  function requireCurrentSelection(selection: Awaited<ReturnType<typeof verifyGuidedComparisonReport>>, f: Fixture) {
    const actual = selection.payload.sources.flatMap(source => source.kpis);
    expect(actual).toHaveLength(8); expect(f.currentKpis).toHaveLength(8);
    expect(actual.map(row => `${row.kpi_name}:${row.value}:${row.unit}`).sort()).toEqual([
      "total_trips:160012:trips/day", "total_trips:160012:trips/day",
      "daily_vmt:450909.6:vehicle-miles/day", "daily_vmt:443317.9:vehicle-miles/day",
      "activitysim_trips:74775:trips", "activitysim_trips:74775:trips",
      "activitysim_daily_vmt:401455.9:vehicle-miles/day", "activitysim_daily_vmt:398090.6:vehicle-miles/day",
    ].sort());
    expect(sorted(actual)).toEqual(sorted(f.currentKpis));
    expect(selection.payload.sources).toHaveLength(4);
    expect(selection.payload.results).toHaveLength(2);
    expect(selection.payload.results.map(result => result.metrics.length)).toEqual([2, 2]);
    for (const old of f.oldKpis) expect(actual.some(row => row.id === old.id)).toBe(false);
    for (const source of selection.payload.sources) {
      expect(source.decision.claim_status).toBe("prototype_only");
      expect(source.validation.scientific_outcome).toBe("inconclusive");
      expect(source.decision.source).toBe("model_attempt_instrument_custody");
      expect(f.outputIds).toContain(source.output.id);
    }
    expect(selection.payload.populationArtifacts).toHaveLength(7);
  }

  it("creates, saves and generates HTML with exactly eight current headlines while preserving all first-attempt evidence", async () => {
    const f = await native.prepare("current");
    // prepare() has already required actual native and ordinary-readable rows.
    await native.assertAuthority(f);
    const original = native.persisted(f);
    const selection = await verifyGuidedComparisonReport(input(f));
    requireCurrentSelection(selection, f);
    expect(native.persisted(f)).toEqual(original);

    const reportId = await createPlain(f, true);
    const created = await persistedSelection(reportId);
    expect(created.selection).toEqual(selection);
    expect(native.persisted(f).models).toEqual(original.models);

    const saved = await saveReport(request(`http://localhost/api/reports/${reportId}`, "PATCH", {
      guidedComparisonSelectionV1: { version: 1, snapshotId: f.snapshotId },
      summary: "SYNTHETIC current-result selection; old evidence remains retained; scientific status inconclusive.",
    }), context(reportId));
    expect(saved.status, await saved.clone().text()).toBe(200);
    const afterSave = await persistedSelection(reportId);
    expect(afterSave.selection).toEqual(selection);
    expect(afterSave.report.updated_at > created.report.updated_at).toBe(true);
    expect(native.persisted(f).models).toEqual(original.models);

    // Actual unchanged handler calls the full verifier on entry and again
    // immediately before real Storage. No spy or mocked verifier counts calls.
    const generated = await generateReport(request(`http://localhost/api/reports/${reportId}/generate`, "POST", { format: "html" }), context(reportId));
    expect(generated.status, await generated.clone().text()).toBe(200);
    const result = generatedSchema.parse(await generated.json());
    expect(result.reportId).toBe(reportId);
    expect(result.storagePath).toBe(`${f.workspaceId}/${reportId}/${result.artifactId}.html`);
    const artifact = await native.member.from("report_artifacts").select("id,report_id,artifact_kind,storage_path,metadata_json")
      .eq("id", result.artifactId).eq("report_id", reportId).single();
    expect(artifact.error).toBeNull(); expect(artifact.data).not.toBeNull();
    const metadata = z.record(z.string(), z.unknown()).parse(artifact.data!.metadata_json);
    expect(metadata.guidedComparisonSelectionV1).toEqual(selection);
    expect(z.record(z.string(), z.unknown()).parse(metadata.sourceContext).guidedComparisonSelectionV1).toEqual(selection);
    const receipt = z.object({ schema: z.literal("openplan.report-generation-writeback.v1"), reportUpdatedAt: z.string() }).strict().parse(metadata.generationWriteback);
    const final = await persistedSelection(reportId);
    expect(final.selection).toEqual(selection); expect(final.report.status).toBe("generated");
    expect(receipt.reportUpdatedAt).toBe(final.report.updated_at);
    expect(final.report.updated_at > afterSave.report.updated_at).toBe(true);
    const download = await native.service.storage.from("report-artifacts").download(result.storagePath);
    expect(download.error).toBeNull(); expect(download.data).not.toBeNull();
    const html = await download.data!.text(); expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(guidedComparisonReportMarkup(selection));
    for (const old of f.oldKpis) expect(html).not.toContain(old.id);
    for (const current of f.currentKpis) expect(html).toContain(current.id);
    const beforeReopen = native.persisted(f);
    const reopenedResponse = await reopenReport(new NextRequest(`http://localhost/api/reports/${reportId}`), context(reportId));
    expect(reopenedResponse.status, await reopenedResponse.clone().text()).toBe(200);
    const reopened = z.object({ report: z.object({ id: z.string().uuid(), project_id: z.string().uuid(), metadata_json: z.unknown() }),
      guidedComparisonSelectionV1: z.unknown(), artifacts: z.array(z.object({ id: z.string().uuid(), report_id: z.string().uuid() }).passthrough()),
    }).passthrough().parse(await reopenedResponse.json());
    expect(reopened.report.id).toBe(reportId); expect(reopened.report.project_id).toBe(f.projectId);
    expect(reopened.guidedComparisonSelectionV1).toEqual(selection);
    expect(readGuidedComparisonSelection(reopened.report.metadata_json)).toEqual(selection);
    expect(reopened.artifacts.map(item => ({ id: item.id, report_id: item.report_id }))).toEqual([{ id: result.artifactId, report_id: reportId }]);
    expect(selection.snapshotId).toBe(f.snapshotId);
    expect(selection.payload.sources.map(source => source.runId).sort()).toEqual([...f.runIds].sort());
    expect(native.persisted(f)).toEqual(beforeReopen);
    expect(native.persisted(f).models).toEqual(original.models);
    await native.assertAuthority(f);
    // Reports, its immutable artifact, stored bytes and model evidence remain.
  });

  it.each(["missing", "revoked-only", "wrong-producer", "ambiguous-current"] as const)(
    "refuses %s named input in the real verifier, Create and Save without writing reports or artifacts", async variant => {
      const f = await native.prepare(variant);
      // A plain report is legitimate. No knowingly invalid saved seal is forged
      // to reach a Generate-specific KPI refusal after Create/Save would deny it.
      const reportId = await createPlain(f);
      const before = native.persisted(f);
      expect(before.artifacts).toEqual([]); expect(before.storage).toEqual([]);
      await expect(verifyGuidedComparisonReport(input(f))).rejects.toThrow(refusal);
      expect(native.persisted(f)).toEqual(before);
      const create = await createReport(request("http://localhost/api/reports", "POST", {
        projectId: f.projectId, reportType: "analysis_summary", title: "SYNTHETIC refused selected input", sections: [],
        guidedComparisonSelectionV1: { version: 1, snapshotId: f.snapshotId },
      }));
      expect(create.status).toBe(409); expect(await create.json()).toEqual({ error: refusal });
      expect(native.persisted(f)).toEqual(before);
      const save = await saveReport(request(`http://localhost/api/reports/${reportId}`, "PATCH", {
        guidedComparisonSelectionV1: { version: 1, snapshotId: f.snapshotId },
      }), context(reportId));
      expect(save.status).toBe(409); expect(await save.json()).toEqual({ error: refusal });
      expect(native.persisted(f)).toEqual(before);
      const unchanged = await persistedSelection(reportId); expect(unchanged.selection).toBeNull();
      await native.assertAuthority(f);
    },
  );

  it("refuses real HTML Generate when one exact saved output file is unavailable, then restores its path, bytes and mode", async () => {
    const f = await native.prepare("current");
    await native.assertAuthority(f);
    const selection = await verifyGuidedComparisonReport(input(f));
    requireCurrentSelection(selection, f);
    const reportId = await createPlain(f, true);
    const created = await persistedSelection(reportId);
    expect(created.selection).toEqual(selection);
    const save = await saveReport(request(`http://localhost/api/reports/${reportId}`, "PATCH", {
      guidedComparisonSelectionV1: { version: 1, snapshotId: f.snapshotId },
      summary: "SYNTHETIC file availability refusal; no KPI or scientific authority mutation.",
    }), context(reportId));
    expect(save.status, await save.clone().text()).toBe(200);
    const saved = await persistedSelection(reportId);
    expect(saved.selection).toEqual(selection);
    expect(saved.report.updated_at > created.report.updated_at).toBe(true);
    const before = native.persisted(f);
    expect(before.artifacts).toEqual([]); expect(before.storage).toEqual([]);

    await native.withQuarantinedOutput(f, async file => {
      expect(selection.payload.sources.some(source => source.output.id === file.artifact.id)).toBe(true);
      // The native descriptor authority is unchanged by filesystem availability.
      await native.assertAuthority(f);
      expect(native.persisted(f)).toEqual(before);
      // Capture the actual confined reader error. Do not invent a product
      // error label or infer a pass from any unrelated failure/status.
      const unavailable = await loadArtifactBytes(file.artifact.file_url, {
        bucket: "run-artifacts", objectPathPrefix: `model-runs/${file.artifact.run_id}/`,
        localRoot: resolveRunWorkDir(native.workerRoot, file.artifact.run_id),
      }).then(() => { throw new Error("Quarantined output unexpectedly remained readable"); }, (error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        return z.object({ code: z.literal("ENOENT"), path: z.literal(file.originalPath),
          message: z.string().min(1) }).parse(error);
      });
      const generated = await generateReport(request(`http://localhost/api/reports/${reportId}/generate`, "POST", { format: "html" }), context(reportId));
      expect(generated.status, await generated.clone().text()).toBe(409);
      expect(await generated.json()).toEqual({ error: unavailable.message });
      expect(native.persisted(f)).toEqual(before);
      await native.assertAuthority(f);
    });
    // withQuarantinedOutput restores and checks the exact path, bytes and mode
    // in finally even if Generate or an assertion fails. No database rollback.
    expect(native.persisted(f)).toEqual(before);
    const unchanged = await persistedSelection(reportId);
    expect(unchanged.selection).toEqual(selection);
    expect(unchanged.report).toEqual(saved.report);
    await native.assertAuthority(f);
  });
});
