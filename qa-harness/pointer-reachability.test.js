/**
 * THE JUDGEMENT BEHIND "no visible way off this page".
 *
 * Run with `node pointer-reachability.test.js`. No browser, no server, no
 * database — the samples are written out by hand in the shape
 * `sampleControls()` returns from a real page.
 *
 * This file exists because the browser audit that uses `classify()` needs its
 * verdict to have been shown capable of failing. The live run supplies numbers;
 * whether those numbers mean "a planner can leave" is decided here, where it can
 * be checked cheaply and every hiding trick can be written down at once.
 *
 * THE FOUR SPELLINGS ARE NOT THE POINT. The guard this replaces enumerated
 * `display: none` and `visibility: hidden` and lost to `opacity: 0;
 * pointer-events: none`. What is asserted below is the PROPERTY — painted, big
 * enough, inside the window, and the browser delivers a click at its centre to
 * it — and the spellings are only the cases that happen to have bitten us.
 */

const assert = require('node:assert');
const { classify, MIN_OPACITY, MIN_SIZE } = require('./pointer-reachability');

/** A perfectly ordinary rail link, as measured in Chrome at 1600x900. */
function ok(overrides = {}) {
  return {
    rect: { left: 24, top: 200, width: 44, height: 44 },
    visibleFraction: 1,
    display: 'block',
    visibility: 'visible',
    pointerEvents: 'auto',
    effectiveOpacity: 1,
    hitTopIsSelfOrDescendant: true,
    hitTopDescription: 'svg',
    ...overrides,
  };
}

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

console.log('pointer reachability');

/**
 * NEGATIVE CONTROL, and the most important check in the file. If `classify()`
 * ever became "everything fails", every hiding case below would pass for the
 * wrong reason and the audit would cry wolf on a healthy page.
 */
check('an ordinary painted link is reachable', () => {
  const verdict = classify(ok());
  assert.strictEqual(verdict.reachable, true, verdict.reason || '');
  assert.strictEqual(verdict.visible, true);
  assert.strictEqual(verdict.hitTestable, true);
  assert.strictEqual(verdict.reason, null);
});

check('display: none is not reachable', () => {
  // Chrome reports a zero rect with it, so pass the honest pairing.
  const verdict = classify(ok({ display: 'none', rect: { left: 0, top: 0, width: 0, height: 0 } }));
  assert.strictEqual(verdict.reachable, false);
  assert.match(verdict.reason, /display: none/);
});

check('visibility: hidden is not reachable', () => {
  const verdict = classify(ok({ visibility: 'hidden' }));
  assert.strictEqual(verdict.reachable, false);
  assert.match(verdict.reason, /visibility: hidden/);
});

/**
 * THE SPELLING THAT DEFEATED THE OLD GUARD. Both halves are needed to make a
 * rail truly unusable, and each half alone must already fail here.
 */
check('opacity: 0 with pointer-events: none is not reachable', () => {
  const verdict = classify(ok({ effectiveOpacity: 0, pointerEvents: 'none' }));
  assert.strictEqual(verdict.reachable, false);
  assert.match(verdict.reason, /opacity/);
  assert.match(verdict.reason, /pointer-events: none/);
});

check('opacity: 0 alone is not reachable, even though the click would land', () => {
  const verdict = classify(ok({ effectiveOpacity: 0 }));
  assert.strictEqual(verdict.reachable, false);
  assert.strictEqual(verdict.hitTestable, true, 'the click still lands — it is the SEEING that fails');
  assert.match(verdict.reason, /opacity/);
});

check('pointer-events: none alone is not reachable, even though it is painted', () => {
  const verdict = classify(ok({ pointerEvents: 'none' }));
  assert.strictEqual(verdict.reachable, false);
  assert.strictEqual(verdict.visible, true, 'it is painted — it is the PRESSING that fails');
  assert.match(verdict.reason, /pointer-events: none/);
});

/** An ancestor's opacity, which `getComputedStyle(node).opacity` never reports. */
check('a transparent ANCESTOR makes a fully opaque link unreachable', () => {
  const verdict = classify(ok({ effectiveOpacity: 0 }));
  assert.strictEqual(verdict.reachable, false);
  assert.match(verdict.reason, /ancestor/);
});

check('a nearly-transparent link is not reachable', () => {
  assert.ok(MIN_OPACITY > 0, 'a zero floor would make this vacuous');
  const verdict = classify(ok({ effectiveOpacity: MIN_OPACITY / 2 }));
  assert.strictEqual(verdict.reachable, false);
});

/** `transform: translateX(-999px)` on a fixed rail: painted, pressable, gone. */
check('a control parked outside the window is not reachable', () => {
  const verdict = classify(
    ok({
      rect: { left: -999, top: 200, width: 44, height: 44 },
      visibleFraction: 0,
      hitTopIsSelfOrDescendant: null,
      hitTopDescription: null,
    }),
  );
  assert.strictEqual(verdict.reachable, false);
  assert.match(verdict.reason, /outside the window/);
});

/** The overlay case — lane 1's question, same primitive. */
check('a control covered by an overlay is not reachable', () => {
  const verdict = classify(
    ok({ hitTopIsSelfOrDescendant: false, hitTopDescription: 'div.op-modal-scrim' }),
  );
  assert.strictEqual(verdict.reachable, false);
  assert.strictEqual(verdict.visible, true, 'a covered control is still painted');
  assert.match(verdict.reason, /covered at its own centre by div\.op-modal-scrim/);
});

check('a control too small to aim at is not reachable', () => {
  assert.ok(MIN_SIZE >= 4, 'a zero floor would make this vacuous');
  const verdict = classify(ok({ rect: { left: 24, top: 200, width: 1, height: 1 } }));
  assert.strictEqual(verdict.reachable, false);
  assert.match(verdict.reason, /too small/);
});

/** A descendant under the cursor is the NORMAL case: the icon inside the link. */
check('a click landing on the link’s own icon counts as landing on the link', () => {
  const verdict = classify(ok({ hitTopIsSelfOrDescendant: true, hitTopDescription: 'svg.lucide' }));
  assert.strictEqual(verdict.reachable, true);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll pointer-reachability checks passed.');
