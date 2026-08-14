/**
 * WHAT A REGRESSION RESULT MEANS. Run with `node first-week-regression.test.js`.
 * No browser, no server — this is the decision the runner makes after a script
 * has already thrown or not thrown, and it is the part that gates.
 *
 * The reason it is worth testing at all: the `open` half of this design is
 * counter-intuitive, and getting it backwards produces the most dangerous
 * possible outcome — a suite that goes green when somebody quietly undoes a
 * fix, or one that stays silent forever on a dead end nobody ever fixed. Two
 * cases below are the ones a careless refactor gets wrong: an `open` script
 * that starts passing must FAIL the run, and an `open` script that fails for
 * the wrong reason must not be mistaken for the dead end still being there.
 *
 * It also checks the loader's own refusals, because a regression that does not
 * say where it came from, or does not say whether a pass is good news, is worse
 * than no regression: it looks like coverage.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { classifyResult, GATING_OUTCOMES, loadRegressions } = require('./first-week-regression');

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

const fixed = { status: 'fixed' };
const open = { status: 'open', expectedFailure: /header still names/ };
const reported = new Error('The panel says X but the header still names Y.');
const unrelated = new Error('locator.click: Timeout 30000ms exceeded.');

console.log('first-week regression outcomes');

check('a fixed dead end that still passes is good news and does not gate', () => {
  assert.strictEqual(classifyResult(fixed, null), 'still-fixed');
  assert.ok(!GATING_OUTCOMES.has('still-fixed'));
});

check('a fixed dead end that fails has come back, and gates', () => {
  assert.strictEqual(classifyResult(fixed, reported), 'regressed');
  assert.ok(GATING_OUTCOMES.has('regressed'));
});

check('an open dead end failing for its recorded reason is known work, and does not gate', () => {
  assert.strictEqual(classifyResult(open, reported), 'still-open');
  assert.ok(!GATING_OUTCOMES.has('still-open'));
});

/**
 * The counter-intuitive one. Passing is not success here — it means the
 * behaviour changed and nobody wrote it down, and the next lane can undo it
 * with nothing to notice.
 */
check('an open dead end that starts PASSING gates, so the fix gets recorded', () => {
  assert.strictEqual(classifyResult(open, null), 'unrecorded-fix');
  assert.ok(GATING_OUTCOMES.has('unrecorded-fix'));
});

/**
 * The one that keeps `status: 'open'` honest. A timeout, a renamed button and a
 * missing fixture all throw, and without this they would all read as "the dead
 * end is still there" — a script that can never tell you anything, quietly.
 */
check('an open dead end failing for an UNRELATED reason is a broken script, not evidence', () => {
  assert.strictEqual(classifyResult(open, unrelated), 'wrong-failure');
  assert.ok(GATING_OUTCOMES.has('wrong-failure'));
});

check('the loader refuses a regression that does not say where it came from', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-week-regressions-'));
  fs.writeFileSync(
    path.join(dir, 'nameless.regression.js'),
    "module.exports = { id: 'x', status: 'fixed', why: 'w', run: async () => {} };\n",
  );
  assert.throws(() => loadRegressions(dir), /finding/);
});

check('the loader refuses a regression that does not say whether a pass is good news', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-week-regressions-'));
  fs.writeFileSync(
    path.join(dir, 'statusless.regression.js'),
    "module.exports = { id: 'x', finding: 'a run and a job', why: 'w', run: async () => {} };\n",
  );
  assert.throws(() => loadRegressions(dir), /status/);
});

check('the loader refuses an open regression with no expectedFailure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-week-regressions-'));
  fs.writeFileSync(
    path.join(dir, 'vague.regression.js'),
    "module.exports = { id: 'x', status: 'open', finding: 'a run and a job', why: 'w', run: async () => {} };\n",
  );
  assert.throws(() => loadRegressions(dir), /expectedFailure/);
});

check('the recorded regressions all load, so the suite is runnable', () => {
  const loaded = loadRegressions();
  assert.ok(loaded.length > 0, 'no regressions are recorded');
  for (const regression of loaded) {
    assert.ok(/^[a-z0-9-]+$/.test(regression.id), `${regression.id} is not a kebab-case id`);
    assert.ok(regression.finding.length > 20, `${regression.id} does not really name its origin`);
  }
});

console.log(failures === 0 ? '\nOutcome rules hold in both directions.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
