const { createRequire } = require('node:module');
const { installFrameReferenceCompatibility } = require('./first-week-browser-compat');

// Resolve from MCP, not the separate stable Playwright used by other QA scripts.
function configureMcp() {
  const dependency = createRequire(require.resolve('@playwright/mcp/package.json'));
  const pkg = dependency('@playwright/mcp/package.json');
  const { tools } = dependency('playwright-core/lib/coreBundle');
  const { program } = dependency('playwright-core/lib/utilsBundle');
  installFrameReferenceCompatibility({
    Tab: tools.Tab,
    mcpVersion: pkg.version,
    playwrightVersion: dependency('playwright/package.json').version,
  });
  const cli = program.version(pkg.version).name('Playwright MCP');
  tools.decorateMCPCommand(cli, pkg.version);
  return cli;
}

module.exports = { configureMcp };
if (require.main === module) void configureMcp().parseAsync(process.argv);
