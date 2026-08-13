import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { stripSourceComments } from "./helpers/source-text";

/**
 * A MAP INSIDE A CLOSED TAB MUST BE RE-MEASURED WHEN THE TAB OPENS.
 *
 * Mapbox measures its container once, at construction. A closed `PageTabPanel`
 * is `display: none` and still mounts its children, so every map inside a
 * non-default tab was built against a 0x0 box and stayed 0x0 after the reader
 * opened the tab — four of them, on three different pages, all rendering a
 * blank rectangle. `keepMapSizedToContainer` is the fix: a `ResizeObserver` on
 * the container, so the box going from nothing to something is what triggers
 * the resize, and nobody has to remember why.
 *
 * WHY THIS FILE DISCOVERS ITS SUBJECTS INSTEAD OF LISTING THEM. The first
 * version of this guard held a hand-written list of three component files. A
 * FOURTH map — `ParticipationHeatmapMap`, two levels inside the campaign
 * page's Analysis tab — was shipped blank and stayed invisible to the guard,
 * because a list cannot notice what nobody added to it. The set is now walked
 * out of the source: every file that renders a `<PageTabPanel>`, every
 * component named inside one of those panels, and then transitively every
 * component those render, to a fixed point. Whatever in that closure calls
 * `new mapboxgl.Map` has to keep itself sized.
 *
 * WHAT THE WALK COVERS, AND WHAT CAN STILL SLIP PAST IT. The walk is fully
 * transitive in depth — there is no depth limit — but it is textual, so it
 * follows only these edges:
 *
 *   - a JSX tag `<Foo …>` whose name is bound by an `import` in the same file,
 *     or by `const Foo = dynamic(() => import("…"))`;
 *   - resolved through the `@/` alias or a relative path, to a `.tsx`/`.ts`
 *     file (or its `index`) inside `src/`.
 *
 * Once a component is IN the closure, its whole file is scanned, not just its
 * render — deliberately conservative, since a map behind a condition is still
 * a map in a tab. What it cannot see: a component reached only through a value
 * (an element in an array or object, a component passed as a prop from a file
 * outside the closure and never named inside one), a tag whose name is
 * re-bound at runtime, a barrel re-export (`export { Foo } from "./bar"` —
 * `bar` is only reached if the barrel itself is in the closure), and anything
 * rendered through `React.createElement` rather than JSX. A new map arriving by
 * one of those routes would still be invisible here; every map added the
 * ordinary way is not.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. Mapbox GL does not run in jsdom —
 * there is no WebGL, no stylesheet and no box model here, so NOTHING in this
 * file is evidence that a map draws, that a container has a size, or that a
 * hidden panel is hidden. Two separate things are checked instead:
 *
 * 1. The helper's own behaviour, against a fake observer and a fake map. That
 *    part is real: it is plain DOM-free logic and it is exercised, not read.
 * 2. That each map reachable from a tabbed panel is WIRED to the helper, by
 *    reading the source. Structural, deliberately — the alternative would be a
 *    test that claims to see a canvas resize and cannot.
 */

const SRC = path.join(process.cwd(), "src");

type FakeEntry = { contentRect: { width: number; height: number } };

/**
 * A stand-in for the browser's `ResizeObserver`, installed on `globalThis` for
 * the duration of one test. jsdom does not provide one, which is also why the
 * helper degrades to a no-op rather than throwing in this environment.
 */
function withFakeResizeObserver<T>(
  run: (fire: (entries: FakeEntry[]) => void, state: { observed: unknown[]; disconnected: number }) => T,
): T {
  const state = { observed: [] as unknown[], disconnected: 0 };
  let callback: ((entries: FakeEntry[]) => void) | null = null;

  class FakeResizeObserver {
    constructor(cb: (entries: FakeEntry[]) => void) {
      callback = cb;
    }
    observe(target: unknown) {
      state.observed.push(target);
    }
    disconnect() {
      state.disconnected += 1;
    }
  }

  const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  try {
    return run((entries) => callback?.(entries), state);
  } finally {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
  }
}

describe("keepMapSizedToContainer", () => {
  it("resizes the map when its container stops being zero-sized", () => {
    withFakeResizeObserver((fire, state) => {
      let resizes = 0;
      const container = { nodeName: "DIV" } as unknown as Element;
      const stop = keepMapSizedToContainer({ resize: () => void resizes++ }, container);

      expect(state.observed).toEqual([container]);

      // The tab is still shut: the browser reports the box, and it is nothing.
      fire([{ contentRect: { width: 0, height: 0 } }]);
      expect(resizes).toBe(0);

      // The reader opens the tab.
      fire([{ contentRect: { width: 820, height: 360 } }]);
      expect(resizes).toBe(1);

      stop();
      expect(state.disconnected).toBe(1);
    });
  });

  it("keeps resizing on every later change, not just the first", () => {
    withFakeResizeObserver((fire) => {
      let resizes = 0;
      const stop = keepMapSizedToContainer(
        { resize: () => void resizes++ },
        {} as unknown as Element,
      );

      fire([{ contentRect: { width: 820, height: 360 } }]);
      fire([{ contentRect: { width: 420, height: 360 } }]);
      expect(resizes).toBe(2);
      stop();
    });
  });

  it("does nothing where there is no ResizeObserver, rather than throwing", () => {
    // Server rendering and jsdom both land here. A helper that threw would
    // take down the component that called it.
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    try {
      expect(() =>
        keepMapSizedToContainer({ resize: () => {} }, {} as unknown as Element)(),
      ).not.toThrow();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });
});

// ─────────────────────────────────────────────────────────── the source walk

/** Every `.ts`/`.tsx` file under `src/`, excluding this suite's own directory. */
function allSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || full === path.join(SRC, "test")) continue;
      allSourceFiles(full, found);
      continue;
    }
    if (entry.endsWith(".tsx") || entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

const sourceCache = new Map<string, string>();

/** File contents with comments blanked — a comment is prose, not a render. */
function code(file: string): string {
  const cached = sourceCache.get(file);
  if (cached !== undefined) return cached;
  const text = stripSourceComments(readFileSync(file, "utf8"));
  sourceCache.set(file, text);
  return text;
}

const RESOLVE_SUFFIXES = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

/**
 * A module specifier as written in `importer`, turned into a file under `src/`,
 * or null for anything outside it (packages, CSS, `node:` builtins).
 */
function resolveSpecifier(importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(importer), specifier);
  else return null;

  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Local name → file, for every binding this file brings in from `src/`. Covers
 * both static `import` and the `const X = dynamic(() => import("…"))` form the
 * heavier maps are loaded through.
 */
function importedNames(file: string): Map<string, string> {
  const source = code(file);
  const bindings = new Map<string, string>();

  const record = (name: string, specifier: string) => {
    const target = resolveSpecifier(file, specifier);
    if (target) bindings.set(name, target);
  };

  const importPattern = /import\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const [, clause, specifier] of source.matchAll(importPattern)) {
    for (const raw of clause.replace(/[{}]/g, " ").split(",")) {
      const piece = raw.trim().replace(/^type\s+/, "");
      if (!piece || piece === "*") continue;
      // `Foo as Bar` binds Bar; `* as Foo` binds Foo.
      const local = piece.split(/\s+as\s+/).pop()?.trim();
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) record(local, specifier);
    }
  }

  const dynamicPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*dynamic\s*\([\s\S]*?import\s*\(\s*["']([^"']+)["']/g;
  for (const [, name, specifier] of source.matchAll(dynamicPattern)) record(name, specifier);

  return bindings;
}

/** Capitalised JSX tag names opened anywhere in `text` (`<Foo>`, `<Foo.Bar>`). */
function jsxTagNames(text: string): string[] {
  return [...text.matchAll(/<([A-Z][\w$]*)/g)].map(([, name]) => name);
}

/**
 * The regions of `source` between `<PageTabPanel …>` and its closing tag,
 * counting nested panels so a panel inside a panel does not end the outer one.
 */
function tabPanelRegions(source: string): string[] {
  const regions: string[] = [];
  const open = /<PageTabPanel[\s>]/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) !== null) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (depth > 0) {
      const nextOpen = source.indexOf("<PageTabPanel", cursor);
      const nextClose = source.indexOf("</PageTabPanel>", cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + "<PageTabPanel".length;
        continue;
      }
      depth -= 1;
      cursor = nextClose + "</PageTabPanel>".length;
      if (depth === 0) regions.push(source.slice(match.index, nextClose));
    }
  }
  return regions;
}

/**
 * Every file a tabbed panel can render, transitively. The seeds are the
 * components named inside a `<PageTabPanel>`; from there the whole of each
 * reached file is scanned, because a map behind a condition is still a map in
 * a tab.
 */
function filesReachableFromTabPanels(): { seedPages: string[]; reachable: Set<string> } {
  const seedPages: string[] = [];
  const queue: string[] = [];

  for (const file of allSourceFiles(SRC)) {
    if (!file.endsWith(".tsx")) continue;
    const source = code(file);
    const regions = tabPanelRegions(source);
    if (regions.length === 0) continue;
    seedPages.push(file);
    const bindings = importedNames(file);
    for (const region of regions) {
      for (const tag of jsxTagNames(region)) {
        const target = bindings.get(tag.split(".")[0]);
        if (target) queue.push(target);
      }
    }
  }

  const reachable = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    const bindings = importedNames(file);
    for (const tag of jsxTagNames(code(file))) {
      const target = bindings.get(tag.split(".")[0]);
      if (target && !reachable.has(target)) queue.push(target);
    }
  }

  return { seedPages, reachable };
}

const { seedPages, reachable } = filesReachableFromTabPanels();
const mapsInTabs = [...reachable].filter((file) => code(file).includes("new mapboxgl.Map")).sort();

describe("every map that can sit inside a closed tab is kept sized", () => {
  it("finds the tabbed pages and the maps under them", () => {
    // Not a hardcoded expectation of WHICH files — floors, so that a walk
    // silently returning nothing (a renamed panel component, a broken alias)
    // fails here instead of passing every assertion below vacuously.
    expect(seedPages.length, "no file renders a <PageTabPanel> — the walk found nothing to start from").
      toBeGreaterThan(0);
    expect(mapsInTabs.length, "the walk reached no map at all, so it is proving nothing").
      toBeGreaterThan(0);
  });

  it.each(mapsInTabs.map((file) => [path.relative(SRC, file), file] as const))(
    "wires %s to the container observer",
    (_label, file) => {
      const source = code(file);

      expect(source, `${file} constructs a map but never observes its container`).toMatch(
        /keepMapSizedToContainer\(/,
      );

      // The observer has to be handed the SAME node the map was built into. A
      // call passing something else would compile, run, and never fire for the
      // box that matters — so the map's `container:` and the observer's second
      // argument are compared here rather than assumed.
      // `container: node` and the shorthand `container,` both appear in this
      // repo; the shorthand names the variable `container`.
      const match = source.match(/\bcontainer(?::\s*([A-Za-z_$][\w$]*))?\s*,/);
      const container = match ? (match[1] ?? "container") : undefined;
      expect(container, `${file} no longer names its map container`).toBeTruthy();
      expect(
        source,
        `${file} observes something other than the container it built the map into`,
      ).toContain(`keepMapSizedToContainer(map, ${container})`);

      // And it must be torn down with the map. An observer outliving its map
      // calls `resize()` on a removed one.
      expect(source, `${file} never stops observing`).toMatch(/stopSizing\(\)/);
    },
  );
});
