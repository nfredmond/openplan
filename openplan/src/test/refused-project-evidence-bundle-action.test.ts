import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const ROUTE = path.join(
  process.cwd(),
  "src/app/api/projects/[projectId]/evidence-bundles/route.ts"
);

describe("the assistant remains refused from selecting project evidence", () => {
  it("registers no evidence-bundle creation action", () => {
    const offenders = Object.keys(ACTION_METADATA).filter((kind) =>
      ["evidence", "bundle"].every((word) => kind.includes(word))
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the executable route refusal before authentication or writes", () => {
    const source = readFileSync(ROUTE, "utf8");
    const refusal = source.indexOf("if (assistantAttempt(request))");
    const client = source.indexOf("caller = await createClient()");
    const write = source.indexOf('.from("project_evidence_bundles").insert');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(client);
    expect(refusal).toBeLessThan(write);
    expect(source).toContain('error: "human_review_required"');
  });
});
