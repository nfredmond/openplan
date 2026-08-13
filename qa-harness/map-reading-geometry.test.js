/**
 * The arithmetic behind "only 14% of the screen is map".
 *
 * Run with `node map-reading-geometry.test.js`. No browser, no server, no
 * database — the rectangles are the shell's own CSS box geometry at 1920x1080,
 * written out by hand from `src/app/cartographic.css`:
 *
 *   .op-cart-surface   top 84, bottom 16, left 92, right 272   → 1556 x 980
 *   .op-cart-rail      top 16, bottom 16, left 16, width 60    →   60 x 1048
 *   .op-cart-hdr       the 84px band the surface starts below
 *   .op-cart-mapdock   top 16, bottom 16, right 16, width 240  → two panels
 *
 * The dock's own box is NOT covering — it is `pointer-events: none` and mostly
 * empty; only the layers panel and the legend inside it paint. Their heights
 * vary with how many coverage notes a workspace has, so they are the estimated
 * part of the figure and the reason the audit reports a measured number rather
 * than trusting this one.
 */

const assert = require('node:assert');
const { uncoveredMapFraction } = require('./map-reading-geometry');

const VIEWPORT = { width: 1920, height: 1080 };

const RAIL = { left: 16, top: 16, width: 60, height: 1048 };
const HEADER = { left: 92, top: 16, width: 1556, height: 52 };
const LAYERS_PANEL = { left: 1664, top: 16, width: 240, height: 380 };
const LEGEND = { left: 1664, top: 406, width: 240, height: 150 };
const SURFACE = { left: 92, top: 84, width: 1556, height: 980 };

const CHROME = [RAIL, HEADER, LAYERS_PANEL, LEGEND];

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log('map-reading geometry');

/**
 * THE COMPLAINT, AS A NUMBER. With the page panel on, the map is a frame around
 * the outside of the window — four thin gutters and one rectangle below the
 * dock. This is the state a planner saw when they said their layer was
 * invisible.
 */
check('with the page panel showing, well under a quarter of the window is map', () => {
  const fraction = uncoveredMapFraction({ viewport: VIEWPORT, covering: [...CHROME, SURFACE] });
  assert.ok(
    fraction < 0.25,
    `expected under 25% of the viewport to be map, got ${(fraction * 100).toFixed(1)}%`,
  );
  // And it is not near zero either — the gutters are real, which is exactly why
  // the layer looked like it was "only in the margins" rather than absent.
  assert.ok(fraction > 0.05, `expected some map, got ${(fraction * 100).toFixed(1)}%`);
});

/** THE FIX, AS THE SAME NUMBER. Same chrome, no page panel. */
check('with the page panel out of the way, most of the window is map', () => {
  const fraction = uncoveredMapFraction({ viewport: VIEWPORT, covering: CHROME });
  assert.ok(
    fraction > 0.6,
    `expected over 60% of the viewport to be map, got ${(fraction * 100).toFixed(1)}%`,
  );
});

/**
 * NEGATIVE CONTROL. If `uncoveredMapFraction` ever stopped counting the panels
 * it is given, both checks above would pass for the wrong reason — the first by
 * being large, the second by being large. This pins the two ends.
 */
check('reports a fully covered viewport as no map at all', () => {
  const fraction = uncoveredMapFraction({
    viewport: VIEWPORT,
    covering: [{ left: 0, top: 0, width: 1920, height: 1080 }],
  });
  assert.strictEqual(fraction, 0);
});

check('reports an empty viewport as all map', () => {
  assert.strictEqual(uncoveredMapFraction({ viewport: VIEWPORT, covering: [] }), 1);
});

check('does not double-count two panels that overlap', () => {
  const half = { left: 0, top: 0, width: 960, height: 1080 };
  const fraction = uncoveredMapFraction({ viewport: VIEWPORT, covering: [half, half] });
  assert.strictEqual(fraction, 0.5);
});

check('ignores the parts of a panel that hang off the window', () => {
  const overhanging = { left: -500, top: -500, width: 1000, height: 1000 };
  const fraction = uncoveredMapFraction({ viewport: VIEWPORT, covering: [overhanging] });
  // Only the 500x500 corner inside the viewport counts.
  assert.strictEqual(fraction, 1 - (500 * 500) / (1920 * 1080));
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll geometry checks passed.');
