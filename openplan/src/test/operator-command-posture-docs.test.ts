import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");
const appPackagePath = path.join(repoRoot, "openplan/package.json");

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const activeOperatorDocs = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
  "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md",
  "docs/ops/README.md",
];

describe("OpenPlan operator command posture docs", () => {
  it("keeps current live operator commands on npm while preserving pnpm as audit/legacy context only", () => {
    const packageJson = JSON.parse(readFileSync(appPackagePath, "utf8"));
    const packageScripts = packageJson.scripts as Record<string, string>;

    expect(packageScripts["ops:check-pilot-preflight"]).toBe("node scripts/ops/check-pilot-preflight.mjs");
    expect(packageScripts["ops:check-buyer-demo-preflight"]).toBe("node scripts/ops/check-buyer-demo-preflight.mjs");
    expect(packageScripts["qa:gate"]).toContain("corepack pnpm audit --prod --audit-level=moderate");

    const docs = Object.fromEntries(activeOperatorDocs.map((doc) => [doc, read(doc)]));
    const currentCommandSections: Record<string, string> = {
      "AGENTS.md": docs["AGENTS.md"].slice(docs["AGENTS.md"].indexOf("## Commands")),
      "CLAUDE.md": docs["CLAUDE.md"].slice(docs["CLAUDE.md"].indexOf("## Commands")),
      "CONTRIBUTING.md": docs["CONTRIBUTING.md"],
      "README.md": docs["README.md"],
      "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md":
        docs["docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md"],
      "docs/ops/README.md": docs["docs/ops/README.md"],
    };

    for (const [doc, content] of Object.entries(currentCommandSections)) {
      expect(content, `${doc} should keep npm as the current operator baseline`).toMatch(/npm run|npm exec/);
      expect(content, `${doc} should not reintroduce pnpm as a current live operator command`).not.toMatch(
        /(?:^|[\s`])pnpm\s+(?:run\s+)?(?:dev|build|lint|test|start|seed:|ops:check|qa:gate)/m,
      );
    }

    expect(docs["AGENTS.md"]).toContain("**Current command posture:** use `npm run …` / `npm exec …` for live operator commands");
    expect(docs["CLAUDE.md"]).toContain("**Current command posture:** use `npm run …` / `npm exec …` for live operator commands");
    expect(docs["README.md"]).toContain("package scripts are invoked with `npm run …` in current operator docs");
    expect(docs["README.md"]).toContain("Corepack supplies the pnpm audit lane inside `npm run qa:gate`");
    expect(docs["docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md"]).toContain(
      "Historical proof artifacts may still cite the older pnpm shorthand",
    );
  });

  it("keeps the buyer-demo preflight indexed beside the pilot preflight command", () => {
    const opsReadme = read("docs/ops/README.md");
    const pilotPreflight = read("docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md");

    expect(opsReadme).toContain("npm run ops:check-buyer-demo-preflight");
    expect(opsReadme).toContain("npm run ops:check-pilot-preflight");
    expect(pilotPreflight).toContain("npm run ops:check-pilot-preflight -- --skip-health --skip-vercel");
    expect(pilotPreflight).toContain("npm --silent run ops:check-pilot-preflight -- --json");
  });
});
