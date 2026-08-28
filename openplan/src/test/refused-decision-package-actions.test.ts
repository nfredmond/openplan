import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const SUBMIT_ROUTE = path.join(
  process.cwd(),
  "src/app/api/projects/[projectId]/decision-packages/route.ts",
);
const DECIDE_ROUTE = path.join(
  process.cwd(),
  "src/app/api/projects/[projectId]/decision-packages/[submissionId]/decision/route.ts",
);

describe("agency package submission and disposition stay human-only", () => {
  it("registers no assistant action that can submit or decide a package", () => {
    const offenders = Object.keys(ACTION_METADATA).filter((kind) =>
      kind.includes("decision_package") || kind.includes("agency_package"),
    );
    expect(offenders).toEqual([]);
  });

  it.each([SUBMIT_ROUTE, DECIDE_ROUTE])(
    "keeps an executable refusal before authentication and database writes in %s",
    (routePath) => {
      const source = readFileSync(routePath, "utf8");
      const refusal = source.indexOf("if (assistantAttempt(request))");
      const authentication = source.indexOf(
        routePath === SUBMIT_ROUTE ? "const checked = await access(" : "const client = await createClient()",
        refusal,
      );
      const insert = source.indexOf(").insert({", refusal);
      expect(refusal).toBeGreaterThan(-1);
      expect(refusal).toBeLessThan(authentication);
      expect(refusal).toBeLessThan(insert);
      expect(source).toContain('error: "human_review_required"');
    },
  );
});
