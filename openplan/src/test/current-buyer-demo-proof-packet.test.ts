import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");
const packetPath = path.join(repoRoot, "docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md");
const salesReadmePath = path.join(repoRoot, "docs/sales/README.md");
const opsReadmePath = path.join(repoRoot, "docs/ops/README.md");
const knownIssuesPath = path.join(repoRoot, "docs/ops/KNOWN_ISSUES.md");
const appPackagePath = path.join(repoRoot, "openplan/package.json");
const buyerDemoPreflightScriptPath = path.join(repoRoot, "openplan/scripts/ops/check-buyer-demo-preflight.mjs");

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function referencedRepoArtifacts(markdown: string) {
  return [...markdown.matchAll(/`((?:docs|openplan)\/[\w./-]+)`/g)]
    .map((match) => match[1])
    .filter((artifact) => !artifact.includes("*"));
}

describe("current buyer/demo proof packet", () => {
  it("is indexed as the current buyer/demo entry point", () => {
    const packet = readFileSync(packetPath, "utf8");
    const salesReadme = readFileSync(salesReadmePath, "utf8");
    const opsReadme = readFileSync(opsReadmePath, "utf8");

    expect(salesReadme).toContain("docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md");
    expect(opsReadme).toContain("../sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md");
    expect(packet).toContain("Status:_ Current buyer-safe demo packet");
  });

  it("keeps every cited local proof artifact resolvable", () => {
    const packet = readFileSync(packetPath, "utf8");
    const artifacts = Array.from(new Set(referencedRepoArtifacts(packet)));

    expect(artifacts).toContain("docs/ops/KNOWN_ISSUES.md");
    expect(artifacts).toContain("docs/ops/2026-05-17-openplan-production-project-report-deeplink-smoke.md");
    expect(artifacts).toContain("docs/ops/2026-05-17-test-output/prod-health-evidence/20260517T220335Z-prod-health-evidence.md");

    const missing = artifacts.filter((artifact) => !existsSync(path.join(repoRoot, artifact)));

    expect(missing).toEqual([]);
  });

  it("keeps the packet aligned with the known-issues gate and active caveat set", () => {
    const packet = readFileSync(packetPath, "utf8");
    const knownIssues = readFileSync(knownIssuesPath, "utf8");

    expect(knownIssues).toMatch(/\*\*Open blockers:\*\* 0/);
    expect(packet).toContain("The current known-issues register has **0 open blockers**");

    for (const caveat of ["Billing", "Modeling", "Recovery"]) {
      expect(packet, `packet should keep ${caveat} visible as an active caveat`).toMatch(
        new RegExp(`\\*\\*${caveat}:\\*\\*`, "i"),
      );
    }
  });

  it("preserves the bounded buyer claim and overclaim prohibitions", () => {
    const packet = read("docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md");

    expect(packet).toContain("supports scoped buyer demos and pilot diligence");
    expect(packet).toContain("not broad self-serve municipal SaaS or autonomous planning claims");

    for (const prohibitedClaim of [
      "fully self-serve municipal SaaS operation",
      "autonomous AI planning",
      "validated behavioral forecasting",
      "legal-grade LAPM/compliance automation",
      "fresh same-cycle paid checkout proof",
    ]) {
      expect(packet, `packet should prohibit ${prohibitedClaim}`).toContain(prohibitedClaim);
    }
  });
  it("keeps latest buyer-demo proof-chain currency guarded", () => {
    const packet = read("docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md");
    const salesReadme = read("docs/sales/README.md");
    const evidenceNote = read("docs/sales/2026-05-17-openplan-buyer-demo-evidence-note.md");
    const preflightProof = read("openplan/docs/ops/2026-05-17-buyer-demo-preflight-proof.md");

    for (const artifact of [packet, salesReadme, evidenceNote, preflightProof]) {
      expect(artifact).toContain("35bfa58e");
    }

    expect(packet).toContain("109f18d2");
    expect(packet).toContain("a962072d");
    expect(packet).toContain("fc5a1797");
    expect(packet).not.toContain("reviewed through commit `fc5a1797`");
    expect(salesReadme).toContain("operator-surface/script/checklist guardrails, not new buyer functionality");
  });

  it("exposes a read-only buyer-demo preflight bundle for supervised demos", () => {
    const packageJson = JSON.parse(readFileSync(appPackagePath, "utf8"));
    const script = readFileSync(buyerDemoPreflightScriptPath, "utf8");

    expect(packageJson.scripts["ops:check-buyer-demo-preflight"]).toBe(
      "node scripts/ops/check-buyer-demo-preflight.mjs",
    );
    expect(script).toContain("test:sales-proof-claim-boundaries");
    expect(script).toContain("src/test/nevada-county-example-fixture.test.ts");
    expect(script).toContain("src/test/buyer-demo-talk-track.test.ts");
    expect(script).toContain("ops:check-pilot-preflight");
    expect(script).toContain("ops:check-public-demo-preflight");
    expect(script).toContain("--skip-health");
    expect(script).toContain("--skip-vercel");
    expect(script).toContain("Live external reads are opt-in only");
    expect(script).toContain("no production writes");
    expect(script).not.toContain("supabase db push");
    expect(script).not.toContain("seed:nctc");
  });

});
