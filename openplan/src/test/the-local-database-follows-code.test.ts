import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = process.cwd();
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const packageJson = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
const upgradeWorkflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/upgrade-path.yml"), "utf8");

describe("the database follows checked-out code", () => {
  it("applies pending local migrations before the development server starts", () => {
    expect(packageJson.scripts.predev).toBe("npm run db:sync");
    expect(packageJson.scripts["db:sync"]).toBe(
      "node scripts/ops/sync-local-db.mjs",
    );
    expect(packageJson.scripts["db:sync"]).not.toContain("db reset");
    expect(packageJson.scripts["db:sync"]).not.toContain("--linked");
  });

  it("rehearses populated upgrades whenever migration files reach main", () => {
    expect(upgradeWorkflow).toContain("push:\n    branches: [main]");
    expect(upgradeWorkflow).toContain('"openplan/supabase/migrations/**"');
    expect(upgradeWorkflow).toContain('git -C .. tag --merged "${GITHUB_SHA}^" --sort=-version:refname');
    expect(upgradeWorkflow).toContain('REQUESTED_BASE="${{ inputs.base_tag }}"');
    expect(upgradeWorkflow).not.toContain("describe --tags --abbrev=0");
  });

  it("passes --include-all to the upgrade only for files listed below that base tag's mark", () => {
    const step = upgradeWorkflow.slice(upgradeWorkflow.indexOf("- name: Apply HEAD's migrations"), upgradeWorkflow.indexOf("- name: Assert the seeded rows survived"));
    expect(step).toContain('require("./supabase/inserted-below-shipped-mark.json")');
    expect(step).toContain('e.belowTags.includes(t)');
    expect(step).toContain('"${BASE_TAG#v}"');
    expect(step.split("supabase migration up --include-all").length - 1).toBe(1);
    expect(step.indexOf("supabase migration up --include-all")).toBeGreaterThan(step.lastIndexOf("exit 1; }"));
    expect(step).toMatch(/if \[ \$\{#BELOW\[@\]\} -eq 0 \]; then\n\s+npm exec -- supabase migration up\n\s+exit 0/);
  });
});
