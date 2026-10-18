// Diagnostic fixture only. Behavior assertions live in the scoped Vitest tests.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const app = path.join(root, 'openplan');
const dependencies = createRequire(path.join(app, 'package.json'));
const ts = dependencies('typescript');
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} }; modules.set(file, mod);
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) { mod.exports = JSON.parse(source); return mod.exports; }
  const request = id => {
    if (!id.startsWith('@/') && !id.startsWith('.')) return dependencies(id);
    const base = id.startsWith('@/') ? path.join(app, 'src', id.slice(2)) : path.resolve(path.dirname(file), id);
    for (const suffix of ['', '.ts', '.tsx', '.json']) {
      const target = base + suffix;
      if (fs.existsSync(target) && fs.statSync(target).isFile()) return load(target);
    }
    throw new Error('Missing diagnostic import ' + id);
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', 'module', compiled)(request, mod.exports, mod);
  return mod.exports;
}
const { exportProject } = load(path.join(app, 'src/test/project-jurisdiction-export-fixture.ts'));
const { buildProjectJurisdictionReadinessPayload, buildProjectJurisdictionReadinessExportPayload } = load(path.join(app, 'src/lib/jurisdiction-readiness/payload.ts'));
const { jurisdictionReadinessRegistrySha256 } = load(path.join(app, 'src/lib/jurisdiction-readiness/custody.ts'));
const registry = jurisdictionReadinessRegistrySha256();
const internal = buildProjectJurisdictionReadinessPayload(exportProject, registry);
const external = buildProjectJurisdictionReadinessExportPayload(exportProject, registry);
process.stdout.write(JSON.stringify({ internalSchema: internal.schema, internalPayloadSha256: internal.payloadSha256, external }, null, 2) + '\n');
