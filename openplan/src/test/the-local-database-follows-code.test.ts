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
      "npm exec -- supabase migration up --local --yes --output-format json",
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
});
