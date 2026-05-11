import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT } from "@/lib/access-request-status";
import { getSupervisedOnboardingEvidenceFlow } from "@/lib/operations/supervised-onboarding-evidence";

import { unresolvedLocalMarkdownLinks } from "./markdown-proof-helpers";

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, "..");

const traceDocPath = path.join(appRoot, "docs/ops/2026-05-10-request-access-copy-to-admin-guard-trace.md");
const guardProofPath = path.join(appRoot, "docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md");
const requestAccessPagePath = path.join(appRoot, "src/app/(public)/request-access/page.tsx");
const requestAccessFormPath = path.join(appRoot, "src/components/request-access/request-access-form.tsx");
const requestAccessPageTestPath = path.join(appRoot, "src/test/request-access-page.test.tsx");
const requestAccessFormTestPath = path.join(appRoot, "src/test/request-access-form.test.tsx");
const accessRequestRouteTestPath = path.join(appRoot, "src/test/access-request-route.test.ts");
const adminOperationsPageTestPath = path.join(appRoot, "src/test/admin-operations-page.test.tsx");
const provisioningControlsTestPath = path.join(appRoot, "src/test/access-request-provision-controls.test.tsx");

const traceDoc = readFileSync(traceDocPath, "utf8");
const guardProof = readFileSync(guardProofPath, "utf8");
const requestAccessPage = readFileSync(requestAccessPagePath, "utf8");
const requestAccessForm = readFileSync(requestAccessFormPath, "utf8");
const requestAccessPageTest = readFileSync(requestAccessPageTestPath, "utf8");
const requestAccessFormTest = readFileSync(requestAccessFormTestPath, "utf8");
const accessRequestRouteTest = readFileSync(accessRequestRouteTestPath, "utf8");
const adminOperationsPageTest = readFileSync(adminOperationsPageTestPath, "utf8");
const provisioningControlsTest = readFileSync(provisioningControlsTestPath, "utf8");

const proofArtifacts = [
  "openplan/src/test/request-access-page.test.tsx",
  "openplan/src/test/request-access-form.test.tsx",
  "openplan/src/test/access-request-route.test.ts",
  "openplan/src/test/admin-operations-page.test.tsx",
  "openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md",
];

function resolveRepoArtifact(artifact: string) {
  return path.join(repoRoot, artifact);
}

describe("request-access copy to admin provisioning guard trace", () => {
  it("keeps the trace doc local, resolvable, and explicitly non-mutating", () => {
    expect(unresolvedLocalMarkdownLinks(traceDocPath, traceDoc)).toEqual([]);

    for (const artifact of proofArtifacts) {
      expect(traceDoc).toContain(artifact);
      expect(existsSync(resolveRepoArtifact(artifact)), `${artifact} should exist`).toBe(true);
    }

    expect(traceDoc).toContain("not automatic public self-serve workspace activation");
    expect(traceDoc).toContain("No email automation is implied or added");
    expect(traceDoc).toContain("No provisioning is allowed during Admin Operations smoke/proof checks");
    expect(traceDoc).toContain("No Supabase production writes");
    expect(traceDoc).toContain("No workspace, invitation, billing, or support records were created");
    expect(traceDoc).not.toMatch(/workspace will be created automatically/i);
    expect(traceDoc).not.toMatch(/self-serve onboarding proof/i);
  });

  it("anchors the public request-access copy to review-first and no-auto-send language", () => {
    expect(requestAccessPage).toContain("Reviewed first");
    expect(requestAccessPage).toContain(
      "not a live workspace, hosted subscription, or service commitment",
    );
    expect(requestAccessPage).toContain("outbound follow-up stays under human control");
    expect(requestAccessPage).toContain(
      "without turning prospect interest into automatic workspace creation",
    );
    expect(requestAccessPage).toContain(
      "Prepare any workspace setup, invitations, or service scope only after ownership, data posture, billing, and support obligations are clear",
    );
    expect(requestAccessPageTest).toContain(
      "does not create an account, hosted workspace, subscription, or services contract",
    );
    expect(requestAccessPageTest).toContain(
      "collect public intake without turning prospect interest into automatic workspace creation",
    );
  });

  it("keeps the request form copy separate from email, billing, and workspace activation", () => {
    expect(requestAccessForm).toContain(
      "Route the request to the right Nat Ford delivery lane before anyone creates a workspace",
    );
    expect(requestAccessForm).toContain("No outbound message is sent automatically from this form");
    expect(requestAccessForm).toContain(
      "Self-hosting, managed-hosting billing, onboarding, and paid implementation remain separate supervised steps",
    );
    expect(requestAccessFormTest).toContain(
      "move from evaluation to a supervised pilot or production decision",
    );
    expect(requestAccessFormTest).toContain("get from evaluation to production use");
  });

  it("connects stored intake and admin operations to the manual provisioning acknowledgement", () => {
    const flow = getSupervisedOnboardingEvidenceFlow();
    const publicIntakeStage = flow.stages.find((stage) => stage.key === "public-intake");
    const adminReviewStage = flow.stages.find((stage) => stage.key === "admin-operations-review");
    const manualProvisioningStage = flow.stages.find((stage) => stage.key === "manual-provisioning-ack");

    expect(publicIntakeStage?.buyerSafeCaveat).toContain("does not create a workspace, send email, or imply acceptance");
    expect(adminReviewStage?.buyerSafeCaveat).toContain("allowlisted operators only");
    expect(manualProvisioningStage?.operatorCheckpoint).toContain(ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT);
    expect(flow.manualProvisioningGuard.acknowledgement).toBe(ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT);
    expect(flow.manualProvisioningGuard.guardrails).toContain("No production writes during proof smoke");
    expect(flow.manualProvisioningGuard.guardrails).toContain("No autonomous provisioning");
    expect(flow.manualProvisioningGuard.guardrails).toContain("No outbound email");

    expect(accessRequestRouteTest).toContain("status: \"new\"");
    expect(adminOperationsPageTest).toContain("Manual provisioning guard");
    expect(provisioningControlsTest).toContain("ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT");
    expect(guardProof).toContain(ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT);
    expect(guardProof).toContain(
      "before any service-role lookup, workspace insert, owner-invite creation, billing mutation, or provisioning RPC can run",
    );
    expect(guardProof).toContain("No production writes were performed");
  });
});
