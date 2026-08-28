import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826000004_governed_decision_packages.sql"),
  "utf8",
);
const correction = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826000005_decision_package_creator_submission.sql"),
  "utf8",
);
const enforcement = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827000002_governed_decision_enforcement.sql"),
  "utf8",
);

describe("governed decision package schema", () => {
  it("binds submissions and receipts to the ready bundle's exact hash and scope", () => {
    expect(migration).toContain("v_bundle.bundle_sha256 <> NEW.bundle_sha256");
    expect(migration).toContain("v_submission.bundle_sha256 <> NEW.bundle_sha256");
    expect(migration).toContain("decision package submission requires a ready bundle");
    expect(migration).toContain("receipt_sha256");
    expect(migration).toContain("extensions.digest");
  });

  it("requires a different assigned owner/admin and prevents self approval", () => {
    expect(correction).toContain("v_bundle.generated_by = NEW.assigned_approver_id");
    expect(correction).toContain("NEW.submitted_by = NEW.assigned_approver_id");
    expect(migration).toContain("v_submission.submitted_by = NEW.decided_by");
    expect(migration).toContain("member.role IN ('owner', 'admin')");
  });

  it("keeps submissions and decisions append-only and viewers read-only", () => {
    expect(migration).toContain("decision package submissions and decisions are append-only");
    expect(migration).not.toMatch(/GRANT\s+(?:ALL|UPDATE|DELETE)[^;]*TO authenticated/i);
    expect(migration).toContain("GRANT SELECT, INSERT ON public.project_decision_package_submissions TO authenticated");
    expect(migration).toContain("GRANT SELECT, INSERT ON public.project_decision_package_decisions TO authenticated");
  });

  it("keeps returned work visible until a new-hash replacement exists", () => {
    expect(migration).toContain("replacement.replaces_submission_id = submission.id");
    expect(correction).toContain("v_prior_decision <> 'returned'");
    expect(correction).toContain("v_prior.bundle_sha256 = NEW.bundle_sha256");
    expect(migration).toContain("stale_for_current_use");
  });

  it("states approval limits in the immutable receipt", () => {
    expect(migration).toContain("'approvalOrPublication', false");
    expect(migration).toContain("'statutoryAdoption', false");
    expect(migration).toContain("'modelValidation', false");
  });

  it("makes a complete v2 manifest an authoritative database prerequisite", () => {
    expect(enforcement).toContain("project_decision_package_manifest_is_ready");
    expect(enforcement).toContain("project_evidence_manifest.v2");
    expect(enforcement).toContain("openplan.evidence_descriptor.v1");
    expect(enforcement).toContain("project/linked-plan.json");
    expect(enforcement).toContain("v_entry->'retrieval'->'retrievedAt' IS DISTINCT FROM v_evidence->'retrievedAt'");
    expect(enforcement).toContain("coalesce(v_entry->>'byteSize', '') !~ '^[0-9]+$'");
    expect(enforcement).toContain("v_entry->'path' IS DISTINCT FROM 'null'::jsonb");
    expect(enforcement).toContain("v_plan_entry_count <> 1");
    expect(enforcement).toContain("v_pdf_entry_count <> 1");
    expect(enforcement).toContain("NOT IN ('supported', 'not_a_numeric_claim')");
    expect(enforcement).toContain("jsonb_typeof(v_evidence->'revisionToken')");
    expect(enforcement).toContain("jsonb_typeof(v_evidence->'checksumSha256')");
    expect(enforcement).toContain("jsonb_typeof(v_entry->'revisionToken')");
    expect(enforcement).toContain("jsonb_typeof(v_entry->'checksumSha256')");
    expect(enforcement).toContain("(v_evidence->'revisionToken') IS DISTINCT FROM (v_entry->'revisionToken')");
    expect(enforcement).toContain("FROM public.report_artifacts artifact");
    expect(enforcement).toContain("JOIN public.reports report ON report.id = artifact.report_id");
    expect(enforcement).toContain("artifact.updated_at <= v_bundle.generated_at");
    expect(enforcement).toContain("decision package submission requires a complete ready v2 manifest");
    expect(enforcement).toContain("decision package approval requires a complete ready v2 manifest");
  });

  it("keeps bundle finalization and the immutable stored ZIP on one service boundary", () => {
    expect(enforcement).toContain("DROP POLICY IF EXISTS project_evidence_bundles_writer_finalize");
    expect(enforcement).toContain("REVOKE UPDATE ON public.project_evidence_bundles FROM authenticated");
    expect(enforcement.match(/FROM storage\.objects stored_bundle/g)).toHaveLength(2);
    expect(enforcement.match(/stored_bundle\.bucket_id = 'project-evidence-bundles'/g)).toHaveLength(2);
    expect(enforcement.match(/stored_bundle\.name = v_bundle\.storage_path/g)).toHaveLength(2);
    expect(enforcement.match(/::bigint = v_bundle\.byte_count/g)).toHaveLength(2);
  });

  it("blocks stale affirmative decisions while preserving return", () => {
    const approvalBranch = enforcement.indexOf("IF NEW.decision = 'approved' THEN");
    const projectFreshness = enforcement.indexOf("project.updated_at = v_bundle.project_revision", approvalBranch);
    const receiptBuild = enforcement.indexOf("v_receipt := jsonb_build_object", approvalBranch);
    expect(approvalBranch).toBeGreaterThan(-1);
    expect(projectFreshness).toBeGreaterThan(approvalBranch);
    expect(projectFreshness).toBeLessThan(receiptBuild);
    expect(enforcement).toContain("A stale package must remain returnable");
  });

  it("permits only one disposition chain for an exact bundle and hash", () => {
    expect(enforcement).toContain("project_decision_package_one_submission_per_bundle_idx");
    expect(enforcement).toContain("project_decision_package_one_submission_per_hash_idx");
    expect(enforcement).toContain("project_decision_package_one_decision_per_bundle_idx");
    expect(enforcement).toContain("project_decision_package_one_decision_per_hash_idx");
  });

  it("stores the exact receipt download preimage and snapshots approver authority", () => {
    expect(enforcement).toContain("receipt_canonical_json");
    expect(enforcement).toContain("convert_to(NEW.receipt_canonical_json, 'UTF8')");
    expect(enforcement).toContain("'approverAuthority', jsonb_build_object");
    expect(enforcement).toContain("'workspaceRole', v_approver_role");
    expect(enforcement).toContain("'requiredAction', 'decision_packages.approve'");
  });
});
