import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadReportAdoption } from "@/lib/land-use-plans/report-adoption";

const planId = "10000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000002";
const reviewReleaseId = "30000000-0000-4000-8000-000000000003";
const contentHash = "a".repeat(64);
const manifestHash = "b".repeat(64);
const decision = {
  kind: "adoption", body: "SYNTHETIC retained decision", instrumentType: "Resolution",
  instrumentIdentifier: "SYNTHETIC-1", vote: null, decidedOn: "2026-10-16", effectiveOn: null,
};

async function readDecision(value: unknown, present = true) {
  const manifest = { planId, versionId, versionContentHash: contentHash, reviewReleaseId,
    ...(present ? { decision: value } : {}) };
  const native = { plan_id: planId, version_id: versionId, version_content_hash: contentHash,
    review_release_id: reviewReleaseId, adoption_manifest: manifest, adoption_manifest_hash: manifestHash };
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: native, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  const supabase = { from } as unknown as Parameters<typeof loadReportAdoption>[0]["supabase"];
  const result = await loadReportAdoption({ supabase, metadata: { adoptionManifest: manifest,
    adoptionManifestHash: manifestHash, reviewReleaseId }, planId, versionId, contentHash });
  return { result, from, query };
}

describe("retained publication decision reader boundary", () => {
  it("accepts typed nullable fields and preserves the exact native query", async () => {
    const { result, from, query } = await readDecision(decision);
    expect(result).toEqual({ status: "verified", decision });
    expect(from).toHaveBeenCalledExactlyOnceWith("land_use_plan_decisions");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("plan_id, version_id, version_content_hash, review_release_id, adoption_manifest, adoption_manifest_hash");
    expect(query.eq.mock.calls).toEqual([["plan_id", planId], ["version_id", versionId], ["adoption_manifest_hash", manifestHash]]);
  });
  it("refuses a missing nested decision before a native query", async () => {
    const { result, from } = await readDecision(undefined, false);
    expect(result.status).toBe("invalid"); expect(from).not.toHaveBeenCalled();
  });
  it.each([null, "decision", [], 1])("refuses a non-object decision %#", async value => {
    const { result, from } = await readDecision(value);
    expect(result.status).toBe("invalid"); expect(from).not.toHaveBeenCalled();
  });
  it.each([
    ["body", 1], ["body", "\u00a0\ufeff"], ["kind", "unknown"], ["vote", false],
    ["decidedOn", "2026-02-30"], ["effectiveOn", 1],
  ])("refuses a reader-invalid %s field %#", async (key, value) => {
    const { result, from } = await readDecision({ ...decision, [key as string]: value });
    expect(result.status).toBe("invalid"); expect(from).not.toHaveBeenCalled();
  });
  it.each(["vote", "effectiveOn"])("refuses a missing required nullable %s key", async key => {
    const value: Record<string, unknown> = { ...decision }; delete value[key];
    const { result, from } = await readDecision(value);
    expect(result.status).toBe("invalid"); expect(from).not.toHaveBeenCalled();
  });
});

describe("retained publication SQL composition, not database execution", () => {
  const path = process.env.OPENPLAN_PUBLICATION_SQL_FIXTURE ?? join(process.cwd(), "supabase/migrations/20261017030608_land_use_plan_publication_transaction.sql");
  const sql = readFileSync(path, "utf8");
  it("counts every artifact so newer PDFs and timestamp ties cannot pass singleton verification", () => {
    expect(sql).toContain("SELECT count(*) INTO artifact_count FROM public.report_artifacts WHERE report_id=report_row.id;");
    expect(sql).toContain("IF artifact_count<>1 THEN RAISE EXCEPTION");
    expect(sql).toContain("WHERE report_id=report_row.id FOR SHARE NOWAIT;");
    expect(sql).toContain("IF NOT FOUND OR artifact.artifact_kind IS DISTINCT FROM 'html'");
  });
  it("rejects the reader-disqualifying implementation report marker", () => {
    expect(sql).toContain("OR artifact.metadata_json->>'kind'='land_use_plan_implementation_report'");
  });
  it("requires an object and every required decision key before publication", () => {
    expect(sql).toContain("IF jsonb_typeof(manifest_decision) IS DISTINCT FROM 'object'");
    expect(sql).toContain("(manifest_decision ?& ARRAY['kind','body','instrumentType','instrumentIdentifier','vote','decidedOn','effectiveOn']) IS NOT TRUE");
    expect(sql.indexOf("The retained adoption decision is unreadable or inconsistent")).toBeLessThan(sql.indexOf("already_published:="));
  });
  it("keeps scalar types and required nullable fields distinct from missing values", () => {
    for (const key of ["kind", "body", "instrumentType", "instrumentIdentifier", "decidedOn"]) {
      expect(sql).toContain(`jsonb_typeof(manifest_decision->'${key}') IS DISTINCT FROM 'string'`);
    }
    for (const key of ["vote", "effectiveOn"]) {
      expect(sql).toContain(`coalesce(jsonb_typeof(manifest_decision->'${key}') IN ('string','null'),false) IS NOT TRUE`);
    }
  });
  it("rejects reader-blank native text and dates outside four-digit calendar years", () => {
    for (const field of ["decision_body", "instrument_type", "instrument_identifier"]) {
      expect(sql).toContain(`btrim(decision.${field},trim_chars)=''`);
    }
    expect(sql).toContain("\\FEFF");
    expect(sql).toContain("decision.decided_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'");
    expect(sql).toContain("decision.effective_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'");
  });
  it("compares all retained decision values to native columns without rewriting the manifest", () => {
    expect(sql).toContain("(manifest_decision @> jsonb_build_object(");
    expect(sql).toContain("'kind',decision.decision_kind,'body',decision.decision_body,");
    expect(sql).toContain("'instrumentType',decision.instrument_type,'instrumentIdentifier',decision.instrument_identifier,");
    expect(sql).toContain("'vote',decision.vote,'decidedOn',to_char(decision.decided_on,'YYYY-MM-DD'),");
    expect(sql).toContain("'effectiveOn',to_char(decision.effective_on,'YYYY-MM-DD'))) IS NOT TRUE THEN");
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public\.land_use_plan_decisions/);
  });
});
