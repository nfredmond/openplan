import { describe, expect, it } from "vitest";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

describe("contract verification stack isolation", () => {
  it.each([
    "supabase_db_m11-contract-verification",
    "supabase_db_m11-contract-verification-upgrade",
    "supabase_db_m2d3-reimbursement-verification",
    "supabase_db_independent-fixes-20261001",
    "supabase_db_openplan-restore-target-1",
  ])("permits the approved disposable stack %s", container => {
    expect(() => requireContractVerificationStack(container, "false")).not.toThrow();
  });

  it.each([
    "supabase_db_openplan",
    "supabase_db_openplan-demo",
    "supabase_db_independent-review-20261001-01",
    "supabase_db_independent-fixes-20261002",
    "supabase_db_independent-fixes-20261001-demo",
    "supabase_db_unknown",
    "supabase_db_openplan-restore-target-0",
  ])("refuses an unapproved local stack %s", container => {
    expect(() => requireContractVerificationStack(container, "false"))
      .toThrow("Select an explicitly named disposable contract verification stack");
  });

  it("keeps the default stack exception limited to explicit CI", () => {
    expect(() => requireContractVerificationStack("supabase_db_openplan", "true")).not.toThrow();
    expect(() => requireContractVerificationStack("supabase_db_openplan-demo", "true")).toThrow();
    expect(() => requireContractVerificationStack("supabase_db_unknown", "true")).toThrow();
  });
});
