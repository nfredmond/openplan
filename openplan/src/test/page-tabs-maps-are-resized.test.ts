import { readFileSync } from "node:fs";
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
 * opened the tab — three of them, on three different pages, all rendering a
 * blank rectangle. `keepMapSizedToContainer` is the fix: a `ResizeObserver` on
 * the container, so the box going from nothing to something is what triggers
 * the resize, and nobody has to remember why.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. Mapbox GL does not run in jsdom —
 * there is no WebGL, no stylesheet and no box model here, so NOTHING in this
 * file is evidence that a map draws, that a container has a size, or that a
 * hidden panel is hidden. Two separate things are checked instead:
 *
 * 1. The helper's own behaviour, against a fake observer and a fake map. That
 *    part is real: it is plain DOM-free logic and it is exercised, not read.
 * 2. That each map in a tabbed panel is WIRED to the helper, by reading the
 *    source. Structural, deliberately — the alternative would be a test that
 *    claims to see a canvas resize and cannot.
 */

const SRC = path.join(process.cwd(), "src");

/**
 * Every map surface that sits inside a URL tab. A map added to one of these
 * pages later gets added here; a map that never enters a tab does not need to
 * be — it is measured correctly at construction, which is why this list is
 * about tabs rather than about maps in general.
 */
const MAPS_INSIDE_TABS = [
  "components/rtp/rtp-cycle-project-map.tsx",
  "components/engagement/location-display-map.tsx",
  "components/engagement/geometry-picker-map.tsx",
];

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

describe("every map that can sit inside a closed tab is kept sized", () => {
  for (const file of MAPS_INSIDE_TABS) {
    it(`wires ${path.basename(file)} to the container observer`, () => {
      const source = stripSourceComments(readFileSync(path.join(SRC, file), "utf8"));

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
    });
  }
});
