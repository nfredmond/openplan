// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { guidedComparisonRequestSchema } from "@/lib/reports/guided-comparison-request";

const sampleSnapshotId = "00000000-0000-4000-8000-000000000110";
const source = ts.createSourceFile("guided-comparison-route-rls.test.ts",
  readFileSync(new URL("./guided-comparison-route-rls.test.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sites: ts.ObjectLiteralExpression[] = [];
function staticName(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && staticName(node.name) === "guidedComparisonSelectionV1" &&
    ts.isObjectLiteralExpression(node.initializer)) sites.push(node.initializer);
  ts.forEachChild(node, visit);
}
visit(source);

// This guards the six static inline sites, without evaluating the native test.
// Indirect builders or new serialization paths require separate coverage.
describe("native guided comparison request contract", () => {
  it("retains exactly six static inline request sites", () => {
    expect(sites).toHaveLength(6);
  });

  it.each([1, 2, 3, 4, 5, 6])("request site %i satisfies the real strict request schema", number => {
    const site = sites[number - 1];
    expect(site, `request site ${number} exists`).toBeDefined();
    const sample: Record<string, unknown> = {};
    for (const member of site.properties) {
      if (!ts.isPropertyAssignment(member)) throw new Error(`request site ${number}: only explicit properties are supported`);
      const name = staticName(member.name);
      if (!name) throw new Error(`request site ${number}: computed properties are unsupported`);
      expect(Object.hasOwn(sample, name), `request site ${number}: duplicate ${name}`).toBe(false);
      const value = member.initializer;
      if (name === "snapshotId") {
        expect(ts.isPropertyAccessExpression(value) && !value.questionDotToken &&
          ts.isIdentifier(value.expression) && value.expression.text === "f" && value.name.text === "snapshotId",
        `request site ${number}: snapshotId must bind f.snapshotId`).toBe(true);
        sample[name] = sampleSnapshotId;
      } else if (ts.isNumericLiteral(value)) sample[name] = Number(value.text);
      else if (ts.isStringLiteral(value)) sample[name] = value.text;
      else if (value.kind === ts.SyntaxKind.TrueKeyword) sample[name] = true;
      else if (value.kind === ts.SyntaxKind.FalseKeyword) sample[name] = false;
      else if (value.kind === ts.SyntaxKind.NullKeyword) sample[name] = null;
      else throw new Error(`request site ${number}: unsupported nonliteral property ${name}`);
    }
    const parsed = guidedComparisonRequestSchema.safeParse(sample);
    expect(parsed.success, `request site ${number}: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ snapshotId: sampleSnapshotId });
  });

  it("accepts the snapshot-only request without creating a persisted selection", () => {
    expect(guidedComparisonRequestSchema.parse({ snapshotId: sampleSnapshotId }))
      .toEqual({ snapshotId: sampleSnapshotId });
  });

  it("refuses the original versioned wire request", () => {
    const parsed = guidedComparisonRequestSchema.safeParse({ version: 1, snapshotId: sampleSnapshotId });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toMatchObject([{ code: "unrecognized_keys", keys: ["version"] }]);
  });
});
