import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
  NO MAP WAITS FOR A `style.load` THAT ALREADY FIRED.

  `isStyleLoaded()` answers false for a while after `style.load`, while tiles
  stream. Code that checks it and then waits for one more `style.load` with
  `once` can wait forever: measured on /safety, 2 of 5 loads never drew
  (`use-workspace-gis-map-binding.ts`). The two-month review found the pattern
  at twelve call sites. They use `whenStyleAccepts` now
  (`src/lib/maps/when-style-accepts.ts`), and this guard stops a new one.

  The one allowed use is the public engagement map, which keeps its own
  style-loaded flag set by `on("style.load")`. It waits with `once` only when
  that flag says the current style has not loaded, or right after its own
  `setStyle`, so the event is still to come.

  Blind categories: an event name held in a variable or built from a template,
  a `once` reached through another name (`const wait = map.once.bind(map)`),
  `on("style.load")` paired with a hand-written `off`, and any library other
  than Mapbox and MapLibre. Comments are read too, so prose that quotes the
  pattern fails here; describe it in words instead.
*/
const ROOT = path.join(process.cwd(), "src");
const ONCE_STYLE_LOAD = /\.once\(\s*["'`]style\.load["'`]/g;

/** Files allowed a fixed number of uses, each with its reason above. */
const ALLOWED: Record<string, number> = {
  [path.join("components", "engagement", "public-map-stage.tsx")]: 1,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function countUses(source: string): number {
  return source.match(ONCE_STYLE_LOAD)?.length ?? 0;
}

describe("no map waits for a style.load that already fired", () => {
  const files = sourceFiles(ROOT);

  it("reads the source tree", () => {
    // About 2,900 files on October 13, 2026. A small number means the walk broke.
    expect(files.length).toBeGreaterThan(1000);
    expect(files.map((file) => path.relative(ROOT, file))).toContain(
      path.join("components", "cartographic", "cartographic-map-backdrop.tsx"),
    );
  });

  it("finds no new wait in application source", () => {
    const offenders = files
      .map((file) => ({ file: path.relative(ROOT, file), uses: countUses(readFileSync(file, "utf8")) }))
      .filter(({ file, uses }) => uses > (ALLOWED[file] ?? 0))
      .map(({ file, uses }) => `${file}: ${uses}`);
    expect(offenders, "use whenStyleAccepts from src/lib/maps/when-style-accepts.ts").toEqual([]);
  });

  it("keeps the allowance honest: each allowed file still has its use", () => {
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      expect(countUses(readFileSync(path.join(ROOT, file), "utf8")), file).toBe(allowed);
    }
  });

  // Seeded control: the forms the guard must see, and near misses it must not.
  it("sees the pattern in each spelling, and nothing else", () => {
    expect(countUses('map.once("style.load", paint);')).toBe(1);
    expect(countUses("map.once('style.load', paint);")).toBe(1);
    expect(countUses("map.once(`style.load`, paint);")).toBe(1);
    expect(countUses('this.map.once(\n  "style.load",\n  paint,\n);')).toBe(1);
    expect(countUses('await map.once("style.load");')).toBe(1);

    expect(countUses('map.on("style.load", paint);')).toBe(0);
    expect(countUses('map.once("load", paint);')).toBe(0);
    expect(countUses('map.once("styledata", paint);')).toBe(0);
    expect(countUses("return whenStyleAccepts(map, paint);")).toBe(0);
  });
});
