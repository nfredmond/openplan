import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

/*
  PLANNER PAGES CARRY NO BUILD NOTES.

  Nathaniel, October 10, 2026: "There are also some weird notes in there that
  shouldn't even be public facing." Regional Plan ended with "Next slice: What
  comes next", a roadmap for the code; five pages told planners to "apply the
  Lane C migration"; the RTP cycle page said "No chapter shell yet". The
  overhaul removed them (docs/reviews/2026-10-10-ui-overhaul/PLAN.md, section
  6, rule 5). This keeps them out.

  It reads every string the app's pages and components can render, not only
  JSX text nodes: props, ternaries and template literals carry most of the
  words, and the older vocabulary guard sees text nodes only. Comments are
  stripped first, because a comment is where a build note belongs.

  Blind categories: notes phrased in words not on this list, a phrase split
  across a template interpolation (`${"next"} slice`), notes in `src/lib`
  strings rendered through a helper, and notes in exported documents.
*/
const ROOTS = ["src/app", "src/components"].map((dir) => path.join(process.cwd(), dir));

const BUILD_NOTES: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\b(?:next|this|first|later) slice\b/i, why: "a delivery slice is how the code was built, not the planner's work" },
  { pattern: /\bwhy this slice\b/i, why: "a delivery slice is how the code was built" },
  { pattern: /\bLane [A-Z]\b/, why: "the name of an internal work stream" },
  { pattern: /\bautomation theater\b/i, why: "a design note to other developers" },
  { pattern: /\b(?:cycle|chapter|record) shell\b/i, why: "scaffolding vocabulary from the build" },
  { pattern: /\bNext (?:domain|output)\b/, why: "the roadmap panel removed on October 10, 2026" },
  { pattern: /\bno longer just\b/i, why: "a changelog line about the build, not the planner's work" },
];

/** Public marketing copy that legitimately describes the product's roadmap. */
const ALLOWED_FILES = new Set(["src/app/(public)/examples/page.tsx"]);

const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const JSX_TEXT = new RegExp(">([^<>{}]{3,})<", "gs");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function renderableText(source: string): string[] {
  const code = stripSourceComments(source);
  return [...(code.match(STRING_LITERAL) ?? []), ...[...code.matchAll(JSX_TEXT)].map((match) => match[1])];
}

const files = ROOTS.flatMap(sourceFiles).filter(
  (file) => !ALLOWED_FILES.has(path.relative(process.cwd(), file)) && !file.includes(`${path.sep}test${path.sep}`)
);

describe("planner pages carry no build notes", () => {
  it("reads a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("finds no build note in any string a page can render", () => {
    const findings: string[] = [];
    for (const file of files) {
      for (const text of renderableText(readFileSync(file, "utf8"))) {
        for (const note of BUILD_NOTES) {
          if (note.pattern.test(text)) {
            findings.push(`${path.relative(process.cwd(), file)}: "${text.trim().slice(0, 100)}" (${note.why})`);
          }
        }
      }
    }
    expect(findings).toEqual([]);
  });
});
