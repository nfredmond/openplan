import { stripSourceComments } from "@/test/helpers/source-text";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Exactly one module may emit PDF bytes.
 *
 * OpenPlan grew TWO hand-rolled PDF writers — the corridor report and the RTP
 * board packet — and both made the same mistakes independently: a single
 * `/Type /Pages … /Count 1` object, content cut with `.slice()` to fit it
 * (48 and 60 lines), wrapping by character count against a point-width column,
 * and `[^\x20-\x7E] -> "?"` so every em dash and accented name was mangled.
 * Neither said anything had been dropped.
 *
 * Copies diverge silently, which is why this is a guard and not a convention:
 * the second writer was not a port of the first, it was a re-invention with the
 * same bugs. `src/lib/reports/pdf-writer.ts` is now the only place that may
 * assemble the byte structure.
 */

const SRC = path.join(process.cwd(), "src");
const WRITER = path.join(SRC, "lib", "reports", "pdf-writer.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/** Product source, excluding the writer itself. Tests may inspect PDF bytes. */
function otherProductFiles(): string[] {
  return walk(SRC).filter(
    (file) => !file.startsWith(path.join(SRC, "test")) && file !== WRITER
  );
}

/**
 * Strip comments before scanning CODE.
 *
 * A guard that forbade DESCRIBING the defect would push the next maintainer to
 * delete the explanation of why this module exists, which is the most useful
 * thing in it. Same convention as `crash-source-token-guard.test.ts`.
 */
function codeOf(file: string): string {
  return stripSourceComments(readFileSync(file, "utf8"));
}

/** Structural markers only a PDF assembler emits. */
const PDF_STRUCTURE_MARKERS = [
  /%PDF-/,
  /\/Type\s*\/Pages/,
  /\/Type\s*\/Catalog/,
  /startxref/,
];

describe("PDF writer confinement", () => {
  it("is the only module that assembles PDF byte structure", () => {
    const offenders: string[] = [];

    for (const file of otherProductFiles()) {
      const source = codeOf(file);
      for (const marker of PDF_STRUCTURE_MARKERS) {
        if (marker.test(source)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${marker}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("carries no truncation of its own content", () => {
    const source = codeOf(WRITER);
    // The bug this module replaced was `.slice(0, 48)` / `.slice(0, 60)`.
    // Slicing a line list is how a deliverable silently loses pages.
    expect(source).not.toMatch(/\.slice\(\s*0\s*,\s*\d+\s*\)/);
  });

  it("reads no clock, so identical input stays byte-identical", () => {
    const source = codeOf(WRITER);
    expect(source).not.toMatch(/new Date\(/);
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/Math\.random\(/);
  });

  it("guards the guard — the markers catch what the deleted writers emitted", () => {
    const deleted = [
      '"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"',
      'pushPart("%PDF-1.4\\n%OpenPlan\\n");',
      '"<< /Type /Catalog /Pages 2 0 R >>"',
      "push(`startxref\\n${xrefStart}\\n%%EOF\\n`);",
    ];
    for (const line of deleted) {
      expect(PDF_STRUCTURE_MARKERS.some((marker) => marker.test(line))).toBe(true);
    }
  });

  it("guards the guard — the scan reaches the routes that used to hold copies", () => {
    const files = otherProductFiles();
    expect(files.length).toBeGreaterThan(100);
    for (const previousHome of [
      path.join("api", "report", "route.ts"),
      path.join("export", "route.ts"),
    ]) {
      expect(files.some((file) => file.includes(previousHome))).toBe(true);
    }
    expect(files).not.toContain(WRITER);
  });
});
