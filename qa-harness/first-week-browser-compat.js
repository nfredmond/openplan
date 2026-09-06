const assert = require('node:assert/strict');

const MCP_VERSION = '0.0.79';
const PLAYWRIGHT_VERSION = '1.63.0-alpha-2026-08-05';

// The pinned MCP normalizer attempts script execution in scriptless frames.
// Keep its exact snapshot reference instead. Other targets use upstream behavior.
function installFrameReferenceCompatibility({ Tab, mcpVersion, playwrightVersion }) {
  assert.equal(mcpVersion, MCP_VERSION, 'Unreviewed MCP version');
  assert.equal(playwrightVersion, PLAYWRIGHT_VERSION, 'Unreviewed browser library');
  assert.equal(typeof Tab?.prototype?.targetLocators, 'function', 'MCP targetLocators contract changed');
  const original = Tab.prototype.targetLocators;
  Tab.prototype.targetLocators = async function (params) {
    await this._initializedPromise;
    return Promise.all(params.map(async (param) => {
      if (!/^f\d+e\d+$/.test(param.target)) return (await original.call(this, [param]))[0];
      const selector = `aria-ref=${param.target}`;
      let locator = this.page.locator(selector);
      if (param.element) locator = locator.describe(param.element);
      return { locator, resolved: `locator(${JSON.stringify(selector)})`, selector };
    }));
  };
}

module.exports = { installFrameReferenceCompatibility, MCP_VERSION, PLAYWRIGHT_VERSION };
