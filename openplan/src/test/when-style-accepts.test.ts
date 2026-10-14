/**
 * A PAINT THAT ARRIVES WHILE TILES STREAM STILL DRAWS.
 *
 * The fake reproduces the race the repository measured on /safety (2 of 5 loads
 * never drew): `style.load` has fired, `isStyleLoaded()` still says false, and
 * no further `style.load` is coming. The old wait used `once` on `style.load`
 * and never ran. The fake renders nothing; it proves the wiring, not pixels.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { whenStyleAccepts } from "@/lib/maps/when-style-accepts";
import { FakeMapboxMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

afterEach(() => resetFakeMaps());

function newMap() {
  return new FakeMapboxMap({ style: "https://tiles.example.org/style.json" });
}

describe("whenStyleAccepts", () => {
  it("paints at once when the style is ready", () => {
    const map = newMap();
    map.loadStyle();
    const paint = vi.fn();
    whenStyleAccepts(map as never, paint);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it("paints once the tiles settle, after style.load has already fired", () => {
    const map = newMap();
    map.loadStyleWhileTilesStream();
    const paint = vi.fn();
    whenStyleAccepts(map as never, paint);
    expect(paint).not.toHaveBeenCalled();

    map.settleTiles();
    expect(paint).toHaveBeenCalledTimes(1);
    // Every listener came off with the win, so later events do not paint again.
    expect(map.listenerCount("styledata") + map.listenerCount("idle") + map.listenerCount("load")).toBe(0);
    map.settleTiles();
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it("the old wait never paints in the same race", () => {
    // The control: the pattern the guard forbids, run against the same fake.
    const map = newMap();
    map.loadStyleWhileTilesStream();
    const paint = vi.fn();
    if (map.isStyleLoaded()) paint();
    else map.once("style.load", paint);
    map.settleTiles();
    expect(paint).not.toHaveBeenCalled();
  });

  it("paints on the map's own load event when the style is up by then", () => {
    const map = newMap();
    const paint = vi.fn();
    whenStyleAccepts(map as never, paint);
    map.loadStyle();
    expect(paint).not.toHaveBeenCalled();
    map.emit("load");
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it("does not paint on an event that comes while the style is still not ready", () => {
    const map = newMap();
    map.loadStyleWhileTilesStream();
    const paint = vi.fn();
    whenStyleAccepts(map as never, paint);
    map.emit("styledata");
    map.emit("idle");
    expect(paint).not.toHaveBeenCalled();
  });

  it("cancels cleanly, so a torn-down effect leaves nothing waiting", () => {
    const map = newMap();
    map.loadStyleWhileTilesStream();
    const paint = vi.fn();
    const cancel = whenStyleAccepts(map as never, paint);
    cancel();
    expect(map.listenerCount("styledata") + map.listenerCount("idle") + map.listenerCount("load")).toBe(0);
    map.settleTiles();
    expect(paint).not.toHaveBeenCalled();
  });
});
