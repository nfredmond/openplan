import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getMarkdownSection, unresolvedLocalMarkdownLinks } from "./markdown-proof-helpers";

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, "..");

const guardProofPath = path.join(appRoot, "docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md");
const appRunbookPath = path.join(appRoot, "docs/ops/RUNBOOK.md");
const rootOpsReadmePath = path.join(repoRoot, "docs/ops/README.md");
const adminSmokeRunbookPath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-admin-operations-smoke-runbook.md");

const guardProof = readFileSync(guardProofPath, "utf8");
const appRunbook = readFileSync(appRunbookPath, "utf8");
const rootOpsReadme = readFileSync(rootOpsReadmePath, "utf8");
const adminSmokeRunbook = readFileSync(adminSmokeRunbookPath, "utf8");

const rootGuardProofLink =
  "[2026-05-10 access-request manual provisioning guard proof](../../openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md)";
const adminGuardProofLink =
  "[Access request manual provisioning guard proof](../../openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md)";
const appRunbookGuardProofLink =
  "[Access request manual provisioning guard proof](2026-05-10-access-request-manual-provisioning-guard-proof.md)";

describe("access-request manual provisioning guard doc index", () => {
  it("keeps the guard proof local, no-write, and specific to the manual no-email acknowledgement", () => {
    expect(unresolvedLocalMarkdownLinks(guardProofPath, guardProof)).toEqual([]);
    expect(guardProof).toContain("manual_provisioning_no_email");
    expect(guardProof).toContain("before any service-role lookup, workspace insert, owner-invite creation, billing mutation, or provisioning RPC can run");
    expect(guardProof).toContain("No production writes were performed");
    expect(guardProof).toContain("No Supabase migration was needed");
    expect(guardProof).toContain("No autonomous provisioning was added");
  });

  it("indexes the guard from ops README sections operators actually scan", () => {
    expect(unresolvedLocalMarkdownLinks(rootOpsReadmePath, rootOpsReadme)).toEqual([]);
    expect(getMarkdownSection(rootOpsReadme, "Start Here")).toContain(rootGuardProofLink);
    expect(rootOpsReadme).toMatch(
      /### Auth \/ Billing \/ Hardening[\s\S]*\[2026-05-10 access-request manual provisioning guard proof\]\(\.\.\/\.\.\/openplan\/docs\/ops\/2026-05-10-access-request-manual-provisioning-guard-proof\.md\)/,
    );
    expect(rootOpsReadme).toMatch(
      /### Production Smoke Evidence[\s\S]*\[2026-05-10 access-request manual provisioning guard proof\]\(\.\.\/\.\.\/openplan\/docs\/ops\/2026-05-10-access-request-manual-provisioning-guard-proof\.md\)/,
    );
    expect(rootOpsReadme).toContain("manual provisioning safety proof for `/admin/operations`");
  });

  it("keeps admin runbooks pointed at the guard without weakening the no-click smoke boundary", () => {
    expect(unresolvedLocalMarkdownLinks(adminSmokeRunbookPath, adminSmokeRunbook)).toEqual([]);
    expect(unresolvedLocalMarkdownLinks(appRunbookPath, appRunbook)).toEqual([]);
    expect(adminSmokeRunbook).toContain(adminGuardProofLink);
    expect(adminSmokeRunbook).toContain("not permission to click provisioning controls during this smoke");
    expect(appRunbook).toContain(appRunbookGuardProofLink);
    expect(appRunbook).toContain("requires `manual_provisioning_no_email` before any service-role lookup");
    expect(appRunbook).toContain("not automatic public self-serve workspace activation");
  });
});
