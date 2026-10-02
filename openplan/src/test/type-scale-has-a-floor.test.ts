import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

import { stripSourceComments } from "./helpers/source-text";
import { sourceFiles } from "./helpers/read-error-detectors";

/**
 * NOTHING IS SET SMALLER THAN 12 PIXELS.
 *
 * The October 2026 review found 619 arbitrary font sizes under 12px in
 * components and 70 in the stylesheets, down to 9.3px. Rendered, 28 percent of
 * all text across 32 routes was under 12px, and the status badge was 9.9px at
 * 623 call sites. `text-label` (12px) is now the floor.
 *
 * Blind category: this reads literal sizes in class strings and `font-size`
 * declarations. It does not see a size built at runtime, an inline `style`
 * prop, `em` units, or a `scale()` transform.
 */

const FLOOR_PX = 12;
const toPx = (value: string, unit: string) => Number(value) * (unit === "rem" ? 16 : 1);

function undersizedUtilities(source: string): string[] {
  return [...source.matchAll(/text-\[([0-9.]+)(rem|px)\]/g)]
    .filter((match) => toPx(match[1], match[2]) < FLOOR_PX)
    .map((match) => match[0]);
}

function undersizedDeclarations(css: string): string[] {
  return [...css.matchAll(/font-size:\s*([0-9.]+)(rem|px)/g)]
    .filter((match) => toPx(match[1], match[2]) < FLOOR_PX)
    .map((match) => match[0]);
}

const CSS_FILES = ["src/app/globals.css", "src/app/cartographic.css", "src/app/workspace-gis.css"];

describe("the type scale has a floor", () => {
  it("has no arbitrary text utility under 12px in any component or page", () => {
    const offenders = ["src/app", "src/components"]
      .flatMap((dir) => sourceFiles(path.join(process.cwd(), dir), (name) => name.endsWith(".tsx")))
      .flatMap((file) =>
      undersizedUtilities(stripSourceComments(readFileSync(file, "utf8"))).map(
        (hit) => `${path.relative(process.cwd(), file)}: ${hit}`
      )
    );

    expect(offenders, "use text-label (12px) or larger").toEqual([]);
  });

  it("has no font-size declaration under 12px in any stylesheet", () => {
    const offenders = CSS_FILES.flatMap((file) =>
      undersizedDeclarations(stripSourceComments(readFileSync(path.join(process.cwd(), file), "utf8"))).map(
        (hit) => `${file}: ${hit}`
      )
    );

    expect(offenders, "use var(--fs-label) or larger").toEqual([]);
  });

  it("would catch the sizes that shipped, and lets the floor itself through", () => {
    expect(undersizedUtilities('className="text-[0.62rem] text-[11px] text-[0.75rem] text-label"')).toEqual([
      "text-[0.62rem]",
      "text-[11px]",
    ]);
    expect(undersizedDeclarations("a { font-size: 9.5px } b { font-size: 0.58rem } c { font-size: 12px }")).toEqual([
      "font-size: 9.5px",
      "font-size: 0.58rem",
    ]);
  });

  it("keeps a type-scale class when a colour class follows it in cn()", () => {
    // tailwind-merge reads an unknown `text-*` as a colour unless told otherwise.
    expect(cn("text-label", "text-muted-foreground")).toBe("text-label text-muted-foreground");
    expect(cn("text-compact text-reading")).toBe("text-reading");
  });
});
