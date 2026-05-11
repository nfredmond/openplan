import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSmokeStatus, parseSmokeStatus } from "@/lib/operations/pilot-readiness";
import { getOpenPlanRepositoryArtifactUrl } from "@/lib/operations/pilot-readiness-proof-paths";

const tempDirs: string[] = [];

async function makeOpsDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "openplan-pilot-readiness-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pilot readiness status parsing", () => {
  it("recognizes explicit status headers", () => {
    expect(parseSmokeStatus("**Status**: PASS\n\nProof follows.")).toBe("PASS");
    expect(parseSmokeStatus("Status: FAIL\n\nBroken.")).toBe("FAIL");
  });

  it("recognizes line-item PASS evidence when no status header exists", () => {
    expect(parseSmokeStatus("# Smoke\n\n- PASS: Created QA auth user.\n- PASS: Rendered report detail.")).toBe("PASS");
  });

  it("lets explicit headers win over line-item evidence", () => {
    expect(parseSmokeStatus("Status: PENDING\n\nPASS: old retained line item.")).toBe("PENDING");
  });

  it("uses the latest matching smoke doc for each tracked lane", async () => {
    const opsDir = await makeOpsDir();
    await writeFile(
      path.join(opsDir, "2026-04-05-openplan-production-authenticated-smoke.md"),
      "Status: FAIL\n",
      "utf8",
    );
    await writeFile(
      path.join(opsDir, "2026-04-08-openplan-production-authenticated-smoke.md"),
      "PASS: Created QA auth user.\nPASS: Dashboard rendered.\n",
      "utf8",
    );

    const statuses = getSmokeStatus(opsDir);
    expect(statuses.find((status) => status.lane === "Authenticated Auth")).toMatchObject({
      status: "PASS",
      lastRun: "2026-04-08",
      details: "2026-04-08-openplan-production-authenticated-smoke.md",
      proofArtifact: "docs/ops/2026-04-08-openplan-production-authenticated-smoke.md",
      proofArtifactHref: getOpenPlanRepositoryArtifactUrl(
        "docs/ops/2026-04-08-openplan-production-authenticated-smoke.md",
      ),
    });
  });

  it("tracks the May 1 release-to-sale workflow gates", async () => {
    const opsDir = await makeOpsDir();
    const seed: Array<[string, string]> = [
      ["2026-05-01-openplan-local-workspace-url-isolation-smoke.md", "- PASS: Cross-workspace denial confirmed.\n"],
      ["2026-05-01-openplan-local-rtp-release-review-smoke.md", "- PASS: Generated board packet.\n"],
      ["2026-05-01-openplan-local-grants-flow-smoke.md", "- PASS: Award reimbursement closed.\n"],
      ["2026-05-01-openplan-local-engagement-report-handoff-smoke.md", "- PASS: Public submission published.\n"],
      ["2026-05-01-openplan-local-analysis-report-linkage-smoke.md", "- PASS: Report attached to managed run.\n"],
      ["2026-05-02-openplan-local-spine-smoke.md", "- PASS: Project reused across surfaces.\n"],
      ["2026-05-02-openplan-local-aerial-evidence-smoke.md", "- PASS: Aerial AOI ready package built.\n"],
      ["2026-05-01-openplan-local-admin-support-flow-smoke.md", "- PASS: Reviewer triaged request.\n"],
      ["2026-05-01-openplan-production-admin-operations-authenticated-smoke.md", "- PASS: Allowlisted reviewer landed.\n"],
    ];
    for (const [name, body] of seed) {
      await writeFile(path.join(opsDir, name), body, "utf8");
    }

    // Cousins that look similar but should not be picked up by the anchored regexes.
    await writeFile(
      path.join(opsDir, "2026-04-25-openplan-local-workspace-url-isolation-smoke-prep.md"),
      "- PASS: Prep only, not the smoke itself.\n",
      "utf8",
    );
    await writeFile(
      path.join(opsDir, "2026-03-17-engagement-report-handoff-slice.md"),
      "- PASS: Earlier slice doc, not the smoke.\n",
      "utf8",
    );

    const statuses = getSmokeStatus(opsDir);
    const expected: Array<[string, string, string]> = [
      ["Workspace URL Isolation", "2026-05-01", "2026-05-01-openplan-local-workspace-url-isolation-smoke.md"],
      ["RTP Release Review", "2026-05-01", "2026-05-01-openplan-local-rtp-release-review-smoke.md"],
      ["Grants Flow", "2026-05-01", "2026-05-01-openplan-local-grants-flow-smoke.md"],
      ["Engagement Report Handoff", "2026-05-01", "2026-05-01-openplan-local-engagement-report-handoff-smoke.md"],
      ["Analysis Report Linkage", "2026-05-01", "2026-05-01-openplan-local-analysis-report-linkage-smoke.md"],
      ["Phase 1 Spine", "2026-05-02", "2026-05-02-openplan-local-spine-smoke.md"],
      ["Aerial Evidence Spine", "2026-05-02", "2026-05-02-openplan-local-aerial-evidence-smoke.md"],
      ["Admin Support Flow", "2026-05-01", "2026-05-01-openplan-local-admin-support-flow-smoke.md"],
      ["Production Admin Operations Auth", "2026-05-01", "2026-05-01-openplan-production-admin-operations-authenticated-smoke.md"],
    ];
    for (const [lane, lastRun, details] of expected) {
      expect(statuses.find((s) => s.lane === lane)).toMatchObject({
        status: "PASS",
        lastRun,
        details,
        proofArtifact: `docs/ops/${details}`,
        proofArtifactHref: getOpenPlanRepositoryArtifactUrl(`docs/ops/${details}`),
      });
    }
  });
});
