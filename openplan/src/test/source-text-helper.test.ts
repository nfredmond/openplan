import { describe, expect, it } from "vitest";

import { codeIncludes, stripSourceComments } from "@/test/helpers/source-text";

/**
 * THE HELPER'S OWN BEHAVIOUR IS TESTED, because a broken stripper makes every
 * guard that depends on it pass — or fail — for the wrong reason.
 *
 * That is not hypothetical caution. `reachable-write-surface.ts` carries the
 * same note for the same reason ("a broken walk would make every assertion
 * above pass by finding nothing"), and the five incidents this helper exists to
 * prevent were all guards reaching a confident verdict off text they had
 * misread. A stripper that silently stopped stripping would restore all five at
 * once, quietly.
 */

describe("stripSourceComments", () => {
  it("blanks a whole-line comment", () => {
    const code = stripSourceComments('// mentions forbiddenThing\nconst x = 1;');
    expect(code).not.toContain("forbiddenThing");
    expect(code).toContain("const x = 1;");
  });

  it("blanks a TRAILING comment — the case two of the three old copies missed", () => {
    // `const x = 1; // forbiddenThing` does not START with `//`, so a
    // line-filtering stripper left the whole line intact and the guard matched
    // the comment.
    const code = stripSourceComments('const x = 1; // forbiddenThing\n');
    expect(code).not.toContain("forbiddenThing");
    expect(code).toContain("const x = 1;");
  });

  it("blanks a block comment, including JSDoc", () => {
    const code = stripSourceComments('/**\n * forbiddenThing is bad\n */\nconst y = 2;');
    expect(code).not.toContain("forbiddenThing");
    expect(code).toContain("const y = 2;");
  });

  it("keeps URLs intact", () => {
    // Without the `[^:]` guard this truncates at `//` and a guard checking for
    // a host would silently stop finding it.
    const code = stripSourceComments('const u = "https://example.org/gtfs.zip";');
    expect(code).toContain("https://example.org/gtfs.zip");
  });

  it("preserves length, line count and offsets", () => {
    /**
     * Blanking rather than deleting is what lets a guard report WHERE it found
     * something, and keeps a multi-line regex behaving the same as it would on
     * the original. A stripper that deletes shifts every position after the
     * first comment.
     */
    const source = 'const a = 1; // note\n/* block */\nconst b = 2;\n';
    const stripped = stripSourceComments(source);

    expect(stripped).toHaveLength(source.length);
    expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
    expect(stripped.indexOf("const b")).toBe(source.indexOf("const b"));
  });

  it("leaves code with no comments completely untouched", () => {
    const source = 'const a = 1;\nconst b = "x";\n';
    expect(stripSourceComments(source)).toBe(source);
  });

  it("blanks a // inside a string literal too — the documented limit", () => {
    /**
     * Asserted rather than hidden. Distinguishing this needs a real lexer, and
     * the failure direction is the safe one: a guard may MISS a violation
     * hidden in such a string, never invent one. Recorded so a future session
     * meets the limit as a decision instead of as a surprise.
     */
    const code = stripSourceComments('const s = "a // b";');
    expect(code).not.toContain('"a // b"');
  });
});

describe("codeIncludes", () => {
  it("ignores a mention in prose and finds the real thing", () => {
    const source = [
      "// Never call request.json() directly in a mutating route.",
      "const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);",
    ].join("\n");

    // The exact false positive that flagged a compliant route earlier today.
    expect(codeIncludes(source, "request.json()")).toBe(false);
    expect(codeIncludes(source, "readJsonOrNullWithLimit")).toBe(true);
  });

  it("still finds a violation that a comment happens to describe", () => {
    // The mirror case: prose about the offence must not EXCUSE the offence.
    const source = [
      "// This route deliberately calls request.json() and should be fixed.",
      "const body = await request.json();",
    ].join("\n");

    expect(codeIncludes(source, "request.json()")).toBe(true);
  });
});
