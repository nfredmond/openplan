import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getMarkdownSection, unresolvedLocalMarkdownLinks } from "./markdown-proof-helpers";

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, "..");
const helperPath = path.join(repoRoot, "docs/ops/2026-05-10-prod-health-evidence-log-helper.md");
const opsReadmePath = path.join(repoRoot, "docs/ops/README.md");
const checklistPath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md");
const runbookPath = path.join(appRoot, "docs/ops/RUNBOOK.md");

const helperDoc = readFileSync(helperPath, "utf8");
const opsReadme = readFileSync(opsReadmePath, "utf8");
const checklist = readFileSync(checklistPath, "utf8");
const runbook = readFileSync(runbookPath, "utf8");

const helperLink = "[2026-05-10 prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md)";

describe("production health evidence logger docs index", () => {
  it("keeps the helper doc locally resolvable and inside the no-write safety boundary", () => {
    expect(unresolvedLocalMarkdownLinks(helperPath, helperDoc)).toEqual([]);
    expect(helperDoc).toContain("npm run ops:check-prod-health");
    expect(helperDoc).toContain("npm run ops:log-prod-health-evidence");
    expect(helperDoc).toContain("does not call Supabase, mutate production, or consume secret tokens");
    expect(helperDoc).toContain("Gate decision: PASS");
  });

  it("indexes the helper in the ops README start-here table and production smoke section", () => {
    expect(getMarkdownSection(opsReadme, "Start Here")).toContain(helperLink);
    expect(opsReadme).toContain(
      "post-main-push helper that records Vercel Ready state and `ops:check-prod-health` output together without secrets, Supabase access, or production writes",
    );
    expect(opsReadme).toContain(
      "operator helper for logging the post-main-push production health evidence gate once Vercel is Ready; local file output only, no secrets, no Supabase, no production writes",
    );
  });

  it("keeps final pilot-readiness and incident runbooks pointed at the helper", () => {
    expect(checklist).toContain("[prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md)");
    expect(checklist).toContain("Production health evidence logger");
    expect(checklist).toContain("does not prove Supabase, billing, Mapbox, or SLA readiness");
    expect(runbook).toContain("../docs/ops/2026-05-10-prod-health-evidence-log-helper.md");
    expect(runbook).toContain("does not use Supabase, secrets, or production writes");
  });
});
