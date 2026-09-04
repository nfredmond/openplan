// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCapabilityEvidence } from "../../scripts/ops/capability-evidence.mjs";

const root = mkdtempSync(join(tmpdir(), "openplan-capability-evidence-"));
mkdirSync(join(root, "docs"));
const bytes = "Synthetic test record, not product acceptance evidence.\n";
writeFileSync(join(root, "docs/proof.md"), bytes);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const today = "2026-09-04";

function record() {
  return {
    reviewedAt: "2026-09-01",
    dimensions: {
      planner: [{
        id: "example-planner",
        status: "proven",
        reviewedAt: today,
        evidence: [{ path: "docs/proof.md", sha256 }],
      }],
    },
  };
}

describe("evidence behind proven capability cells", () => {
  it("accepts a currently reviewed exact-byte record and does not invent proof requirements for partial coverage", () => {
    expect(() => validateCapabilityEvidence(record(), root, today)).not.toThrow();
    const partial = { reviewedAt: today, dimensions: { planner: [{ id: "unproven", status: "partial" }] } };
    expect(() => validateCapabilityEvidence(partial, root, today)).not.toThrow();
  });

  it("refuses promotion without an attributable evidence record", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence = [];
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/no evidence records/);
  });

  it.each(["", "2026-08-31", "2026-09-05", "2026-02-30"])("refuses an invalid, stale, or future cell review date: %s", (reviewedAt) => {
    const registry = record();
    registry.dimensions.planner[0].reviewedAt = reviewedAt;
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/valid review date/);
  });

  it("refuses missing files and changed evidence bytes", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence[0].path = "docs/missing.md";
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/file is missing/);
    const changed = record();
    changed.dimensions.planner[0].evidence[0].sha256 = "0".repeat(64);
    expect(() => validateCapabilityEvidence(changed, root, today)).toThrow(/hash changed/);
  });

  it("refuses unbound digests and duplicate evidence", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence[0].sha256 = "";
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/needs a lowercase SHA-256/);
    const duplicate = record();
    duplicate.dimensions.planner[0].evidence.push(duplicate.dimensions.planner[0].evidence[0]);
    expect(() => validateCapabilityEvidence(duplicate, root, today)).toThrow(/repeats evidence/);
  });

  it("refuses an empty record even when its digest matches", () => {
    const registry = record();
    writeFileSync(join(root, "docs/empty.md"), "");
    registry.dimensions.planner[0].evidence[0] = {
      path: "docs/empty.md",
      sha256: createHash("sha256").update("").digest("hex"),
    };
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/file is empty/);
  });

  it("refuses absolute paths instead of binding evidence to one developer's computer", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence[0].path = join(root, "docs/proof.md");
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/repository-relative/);
  });
});
