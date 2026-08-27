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
});
