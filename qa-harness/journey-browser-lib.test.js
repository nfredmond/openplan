// The proven jobs' screen check must read colour contrast on the whole screen,
// not only the first one (KI-2026-11-17-032). OpenPlan scrolls an inner pane
// inside a fixed surface, so the document is one screen tall and axe-core
// marks everything below it "inapplicable" for colour contrast. These tests
// open a local fixture page shaped like that shell in real Chrome, put
// low-contrast text below the first screen, and read it with the same
// function both journeys' screen steps call.
//
// Blind category: the fixture copies the shell's layout (a fixed surface with
// top and bottom set, a flex column, an overflow-y pane, a list with its own
// max-height). A screen whose content scrolls some other way, or that loads
// more content each time it grows, is proved only by a journey run on a local
// build, not here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appRoot } = require('./harness-env');
const { chromePath, readWholeScreen } = require('./journey-browser-lib');
const first = require('./first-job-journey-lib');

const puppeteer = require(require.resolve('puppeteer-core', { paths: [appRoot] }));
const axeSource = fs.readFileSync(path.join(appRoot, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

// #777777 on #808080 is about 1.2:1; #111111 on #ffffff passes.
const FAINT = 'color:#777777;background:#808080';

function shellPage({ paneRows = 60, listRows = 30, faintInPane = true, faintInList = true } = {}) {
  const rows = (count, prefix) => Array.from({ length: count }, (_, i) => `<p style="margin:0;padding:8px 0">${prefix} row ${i + 1}</p>`).join('');
  return `<!doctype html><html lang="en"><head><title>Fixture</title><style>
    html,body{margin:0;height:100%;background:#ffffff;color:#111111;font:16px sans-serif}
    .surface{position:fixed;top:84px;bottom:72px;left:16px;right:16px;overflow:hidden;display:flex;flex-direction:column;background:#ffffff}
    .surface__hd{flex-shrink:0;padding:14px 20px}
    main{flex:1;overflow-y:auto;padding:20px}
    .list{max-height:240px;overflow-y:auto;border:1px solid #111111}
  </style></head><body>
    <div class="surface"><div class="surface__hd"><h1 style="margin:0">Funding</h1></div>
      <main>
        ${rows(paneRows, 'Pane')}
        ${faintInPane ? `<span id="faint-pane" style="${FAINT}">Below the fold</span>` : ''}
        <div class="list">${rows(listRows, 'List')}${faintInList ? `<span id="faint-list" style="${FAINT}">Below the list's fold</span>` : ''}</div>
      </main>
    </div>
  </body></html>`;
}

function contrastTargets(results) {
  const rule = results.violations.find((violation) => violation.id === 'color-contrast');
  return rule ? rule.nodes.map((node) => node.target.join(' ')).sort() : [];
}

function pngHeight(file) {
  const buffer = fs.readFileSync(file);
  return buffer.readUInt32BE(20);
}

let browser;
test.before(async () => {
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (browser) await browser.close();
});

async function openFixture(html, width = 1440) {
  const tab = await browser.newPage();
  await tab.setViewport({ width, height: 900 });
  await tab.setContent(html, { waitUntil: 'load' });
  return tab;
}

test('the fixture reproduces the defect: axe on the first screen alone misses the low-contrast text below it', async () => {
  const tab = await openFixture(shellPage());
  await tab.evaluate(axeSource);
  const results = await tab.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), first.AXE_TAGS);
  assert.deepStrictEqual(contrastTargets(results), [], 'axe without the unroll reports neither faint element');
  await tab.close();
});

test('the whole-screen read finds low-contrast text below the first screen, in the pane and in a list with its own height', async () => {
  for (const width of first.SCREEN_WIDTHS) {
    const tab = await openFixture(shellPage(), width);
    const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unroll-')), 'screen.png');
    const { results, horizontalScroll } = await readWholeScreen(tab, { width, height: 900, axeSource, tags: first.AXE_TAGS, screenshotPath: shot });
    assert.deepStrictEqual(contrastTargets(results), ['#faint-list', '#faint-pane'], `both faint elements are reported at ${width} px`);
    assert.strictEqual(results.testEngine.version, first.AXE_VERSION);
    assert.strictEqual(horizontalScroll, false);
    assert.ok(pngHeight(shot) > 2000, `the screenshot holds the whole screen at ${width} px, not one 900 px screen`);
    const stillScrolls = await tab.evaluate(() => [...document.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).length);
    assert.strictEqual(stillScrolls, 0, 'nothing on the screen scrolls after the unroll');
    await tab.close();
  }
});

test('a whole screen with no faint text reports no contrast finding (negative control)', async () => {
  const tab = await openFixture(shellPage({ faintInPane: false, faintInList: false }));
  const { results } = await readWholeScreen(tab, { width: 1440, height: 900, axeSource, tags: first.AXE_TAGS });
  assert.deepStrictEqual(contrastTargets(results), []);
  await tab.close();
});

test('a screen too tall to unroll is refused, not read in part', async () => {
  const tab = await openFixture(shellPage({ paneRows: 1200 }));
  await assert.rejects(readWholeScreen(tab, { width: 1440, height: 900, axeSource, tags: first.AXE_TAGS }), /needs a viewport over 30000 px/);
  await tab.close();
});

test('every journey screen step reads screens through readWholeScreen and runs axe nowhere else', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const lib = read('journey-browser-lib.js');
  const scan = lib.slice(lib.indexOf('async function scanScreens('));
  assert.match(scan, /await readWholeScreen\(tab, \{ width, height: 900,/);
  assert.strictEqual((lib.match(/window\.axe\.run\(/g) || []).length, 1, 'the lib runs axe in readWholeScreen only');
  const engagement = read('engagement-job-journey.js');
  assert.match(engagement, /await readWholeScreen\(tab, \{ width, height: 900,/);
  assert.doesNotMatch(engagement, /window\.axe\.run\(/);
  for (const file of ['first-job-journey.js', 'atp-job-journey.js']) {
    const source = read(file);
    assert.match(source, /scanScreens\(\{ browser, context, origin, screens, out, secrets, axeSource, rows: state\.screens \}\)/, `${file} reads its screens with scanScreens`);
    assert.doesNotMatch(source, /window\.axe\.run\(/, `${file} runs axe only through the lib`);
  }
});
