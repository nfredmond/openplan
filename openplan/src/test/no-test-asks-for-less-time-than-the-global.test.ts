import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * A PER-TEST TIMEOUT MAY RAISE THE GLOBAL LIMIT. IT MAY NOT LOWER IT.
 *
 * `vitest.config.ts` sets 20s for everything, deliberately, because the 5s
 * default failed CI twice in one day on correct code: a timeout measures how
 * loaded the machine is, not whether the code is right. Its comment says "20s
 * applies to everything, so no individual file has to remember to ask".
 *
 * The trap this guards is a per-test timeout that was correct when written and
 * silently inverted later. `project-detail-page.test.tsx` asked for 10s on
 * 2026-05-14, when vitest's default was 5 — that was RAISING the ceiling for a
 * heavy test. When the global moved to 20s on 2026-08-18 the same literal
 * became a REDUCTION, capping the largest test in the file at half the
 * deliberate limit. It then failed on a loaded machine on 2026-08-22, reported
 * as the test timing out rather than as the machine being busy.
 *
 * Nothing announces that inversion: the number did not change, its meaning did.
 * So the check is not "avoid per-test timeouts" — it is "a per-test timeout
 * must still be doing what it was written to do", which only a comparison
 * against the current global can answer.
 */

const CONFIG = path.join(process.cwd(), "vitest.config.ts");
const SRC = path.join(process.cwd(), "src");

/** Every test file under `src/`. Walked here rather than shared — each guard in
 *  this directory walks its own tree, and one more caller does not yet justify
 *  extracting a helper. */
function testFiles(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return /\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The global `testTimeout` from vitest.config.ts, in milliseconds. */
function globalTestTimeout(): number {
  const source = stripSourceComments(readFileSync(CONFIG, "utf8"));
  const match = source.match(/testTimeout:\s*([\d_]+)/);
  if (!match) throw new Error("vitest.config.ts no longer declares a numeric testTimeout");
  return Number(match[1].replace(/_/g, ""));
}

/**
 * Per-test timeouts, read from the AST rather than matched as text.
 *
 * A regex over `}, <number>)` was tried first and was wrong: it also matched a
 * `201` status in a mocked response and a delay in a fake, reporting eight
 * files that set no test timeout at all. The third argument of `it`/`test` is a
 * position in the grammar, not a shape in the source, so only a parser can
 * identify it.
 */
function perTestTimeouts(file: string): Array<{ name: string; timeout: number }> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const found: Array<{ name: string; timeout: number }> = [];

  /** `it`, `test`, and their `.only` / `.skip` / `.each(...)` forms. */
  function isTestCall(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) return expression.text === "it" || expression.text === "test";
    if (ts.isPropertyAccessExpression(expression)) return isTestCall(expression.expression);
    if (ts.isCallExpression(expression)) return isTestCall(expression.expression);
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isTestCall(node.expression) && node.arguments.length >= 3) {
      const timeoutArg = node.arguments[2];
      if (ts.isNumericLiteral(timeoutArg)) {
        const nameArg = node.arguments[0];
        const name = ts.isStringLiteralLike(nameArg) ? nameArg.text : "(unnamed)";
        found.push({ name, timeout: Number(timeoutArg.text.replace(/_/g, "")) });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return found;
}

describe("no test asks for less time than the global timeout", () => {
  const globalTimeout = globalTestTimeout();

  it("reads a real global timeout from the config", () => {
    expect(globalTimeout).toBeGreaterThan(0);
  });

  it("finds no per-test timeout below it", () => {
    const offenders: string[] = [];
    const files = testFiles();

    // A broken walker returns no files, finds no offenders, and passes. The
    // floor is what separates "nothing is wrong" from "nothing was checked".
    expect(files.length, "the test-file walk found almost nothing — it is broken").toBeGreaterThan(
      900
    );

    for (const file of files) {
      for (const { name, timeout } of perTestTimeouts(file)) {
        if (timeout < globalTimeout) {
          offenders.push(
            `${path.relative(process.cwd(), file)} — "${name}": ${timeout}ms < ${globalTimeout}ms`
          );
        }
      }
    }

    expect(
      offenders,
      `A per-test timeout below the ${globalTimeout}ms global caps that test more tightly than the ` +
        `config intends — usually because the global was raised after the literal was written. ` +
        `Delete the argument to inherit the global, or raise it above the global if the test ` +
        `genuinely needs longer:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
