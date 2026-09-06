const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createRequire } = require('node:module');
const { installFrameReferenceCompatibility, MCP_VERSION, PLAYWRIGHT_VERSION } = require('./first-week-browser-compat');

function fixture() {
  const calls = [];
  class Tab {
    constructor() {
      this._initializedPromise = Promise.resolve();
      this.page = {
        locator(selector) {
          calls.push({ selector });
          return {
            selector,
            describe(description) { return { ...this, description }; },
            normalize() { throw new Error('Unsafe normalization'); },
          };
        },
      };
    }
    async targetLocators(params) {
      calls.push({ params, receiver: this });
      return params.map((param) => ({ original: param }));
    }
  }
  const config = { Tab, mcpVersion: MCP_VERSION, playwrightVersion: PLAYWRIGHT_VERSION };
  return { Tab, config, calls };
}

test('only reviewed dependency versions and the exported method contract are accepted', () => {
  assert.equal(MCP_VERSION, '0.0.79');
  assert.equal(PLAYWRIGHT_VERSION, '1.63.0-alpha-2026-08-05');
  for (const [key, value, reason] of [
    ['mcpVersion', '0.0.80', /Unreviewed MCP version/],
    ['playwrightVersion', '1.58.2', /Unreviewed browser library/],
    ['Tab', undefined, /MCP targetLocators contract changed/],
    ['Tab', class {}, /MCP targetLocators contract changed/],
  ]) {
    const { config } = fixture();
    const original = config.Tab.prototype.targetLocators;
    assert.throws(() => installFrameReferenceCompatibility({ ...config, [key]: value }), reason);
    assert.equal(config.Tab.prototype.targetLocators, original, 'refusal must not install the patch');
  }
});

test('frame references preserve the exact target and description without normalization', async () => {
  const { Tab, config, calls } = fixture();
  installFrameReferenceCompatibility(config);
  const results = await new Tab().targetLocators([{ target: 'f12e345', element: 'Project record' }, { target: 'f2e9' }]);
  assert.deepEqual(calls, [{ selector: 'aria-ref=f12e345' }, { selector: 'aria-ref=f2e9' }]);
  assert.equal(results[0].locator.description, 'Project record');
  assert.equal(results[1].locator.description, undefined);
  assert.deepEqual(results.map(({ locator, resolved, selector }) => [locator.selector, resolved, selector]), [
    ['aria-ref=f12e345', 'locator("aria-ref=f12e345")', 'aria-ref=f12e345'],
    ['aria-ref=f2e9', 'locator("aria-ref=f2e9")', 'aria-ref=f2e9'],
  ]);
});

test('main-frame references, selectors, malformed refs and unknown parameters stay upstream in input order', async () => {
  const { Tab, config, calls } = fixture();
  installFrameReferenceCompatibility(config);
  const tab = new Tab();
  const targets = ['e12', '#project', 'getByRole("link")', 'xf1e2', 'f1e2suffix', 'f1e', 'f1e2'];
  const params = targets.map((target) => ({ target, element: 'description', futureOption: 'unchanged' }));
  const results = await tab.targetLocators(params);
  assert.deepEqual(results.slice(0, -1), params.slice(0, -1).map((original) => ({ original })));
  assert.equal(results.at(-1).selector, 'aria-ref=f1e2');
  assert.deepEqual(calls.slice(0, -1), params.slice(0, -1).map((param) => ({ params: [param], receiver: tab })));
});

test('no target access happens until the tab is initialized and initialization failure propagates', async () => {
  const { Tab, config, calls } = fixture();
  installFrameReferenceCompatibility(config);
  const tab = new Tab();
  let release;
  tab._initializedPromise = new Promise((resolve) => { release = resolve; });
  const pending = tab.targetLocators([{ target: 'f1e2' }, { target: 'e3' }]);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  release();
  assert.equal((await pending).length, 2);
  const failure = new Error('Tab initialization failed');
  tab._initializedPromise = Promise.reject(failure);
  await assert.rejects(tab.targetLocators([{ target: 'f1e4' }]), (error) => error === failure);
  assert.equal(calls.length, 2);
});

test('the installed MCP launcher wires the adapter into the actual single-target browser method', async () => {
  require('./first-week-browser-mcp').configureMcp();
  const dependency = createRequire(require.resolve('@playwright/mcp/package.json'));
  const { tools } = dependency('playwright-core/lib/coreBundle');
  const { Tab, calls } = fixture();
  const tab = new Tab();
  tab.targetLocators = tools.Tab.prototype.targetLocators;
  const result = await tools.Tab.prototype.targetLocator.call(tab, { target: 'f1e267' });
  assert.equal(result.selector, 'aria-ref=f1e267');
  assert.deepEqual(calls, [{ selector: 'aria-ref=f1e267' }]);
});

test('the installed MCP launcher exposes the original CLI', () => {
  const launcher = path.join(__dirname, 'first-week-browser-mcp.js');
  const result = spawnSync(process.execPath, [launcher, '--help'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: Playwright MCP/);
  assert.match(result.stdout, /--isolated/);
  assert.match(result.stdout, /--output-dir/);
});
