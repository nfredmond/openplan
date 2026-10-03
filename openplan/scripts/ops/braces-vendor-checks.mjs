import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { verifyBracesVendor } from './verify-braces-vendor.mjs';
import { checkBracesDepth } from './braces-depth-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const rewrite = (path, change) => writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')))));

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'openplan-braces-test-'));
  try {
    cpSync(join(root, 'vendor/braces'), join(directory, 'vendor/braces'), { recursive: true });
    cpSync(join(root, 'node_modules/braces'), join(directory, 'node_modules/braces'), { recursive: true });
    const bracesMetadata = JSON.parse(readFileSync(require.resolve('braces/package.json'), 'utf8'));
    const bracesRequire = createRequire(require.resolve('braces/package.json'));
    for (const dependency of Object.keys(bracesMetadata.dependencies)) {
      symlinkSync(dirname(bracesRequire.resolve(`${dependency}/package.json`)), join(directory, 'node_modules', dependency));
    }
    const original = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      devDependencies: { braces: original.devDependencies.braces }, overrides: { braces: original.overrides.braces },
    }));
    const locked = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/braces'];
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/braces': locked } }));
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the real installed patch passes behavior and byte checks', () => {
  assert.equal(verifyBracesVendor(root).fileHashes, 10);
});

test('harmless app metadata changes survive the guard', () => fixture((directory) => {
  rewrite(join(directory, 'package.json'), (data) => ({ ...data, description: 'A harmless control' }));
  assert.equal(verifyBracesVendor(directory).installedCopies, 1);
}));

for (const [label, mutate, expected] of [
  ['direct dependency', (d) => rewrite(join(d, 'package.json'), (p) => ({ ...p, devDependencies: { braces: '3.0.3' } })), /direct local dependency/],
  ['override', (d) => rewrite(join(d, 'package.json'), (p) => ({ ...p, overrides: {} })), /all transitive copies/],
  ['archive', (d) => writeFileSync(join(d, 'vendor/braces/braces-3.0.4-openplan.1.tgz'), 'corrupt'), /vendor hash/],
  ['patch', (d) => writeFileSync(join(d, 'vendor/braces/depth-limit.patch'), 'corrupt'), /vendor hash/],
  ['source archive', (d) => writeFileSync(join(d, 'vendor/braces/braces-3.0.3.tgz'), 'corrupt'), /vendor hash/],
  ['lock version', (d) => rewrite(join(d, 'package-lock.json'), (p) => {
    p.packages['node_modules/braces'].version = '3.0.3'; return p;
  }), /locked version/],
  ['lock identity', (d) => rewrite(join(d, 'package-lock.json'), (p) => {
    p.packages['node_modules/braces'].resolved = 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz'; return p;
  }), /locked local archive/],
  ['lock integrity', (d) => rewrite(join(d, 'package-lock.json'), (p) => {
    p.packages['node_modules/braces'].integrity = 'sha512-wrong'; return p;
  }), /locked archive integrity/],
  ['nested locked copy', (d) => rewrite(join(d, 'package-lock.json'), (p) => {
    p.packages['node_modules/micromatch/node_modules/braces'] = p.packages['node_modules/braces']; return p;
  }), /one locked braces package/],
  ['nested installed copy absent from lock', (d) => {
    const nested = join(d, 'node_modules/@test/parent/node_modules/braces');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'package.json'), '{"name":"braces","version":"3.0.3"}');
  }, /one installed braces package/],
  ['installed license', (d) => writeFileSync(join(d, 'node_modules/braces/LICENSE'), 'corrupt'), /installed hash: LICENSE/],
  ['installed parser with unchanged version', (d) => writeFileSync(join(d, 'node_modules/braces/lib/parse.js'), 'module.exports = () => {};'), /installed hash: lib\/parse.js/],
]) {
  test(`rejects ${label} corruption for its stated reason`, () => fixture((directory) => {
    mutate(directory);
    assert.throws(() => verifyBracesVendor(directory), expected);
  }));
}

test('behavior checks detect a removed parser depth guard independently of hashes', () => fixture((directory) => {
  const parser = join(directory, 'node_modules/braces/lib/parse.js');
  writeFileSync(parser, readFileSync(parser, 'utf8').replaceAll('nesting >= maxDepth', 'false'));
  const braces = createRequire(join(directory, 'package.json'))('braces');
  assert.throws(() => checkBracesDepth(braces), /parse: depth 101/);
}));

for (const method of ['compile', 'expand', 'stringify']) {
  test(`behavior checks detect a removed ${method} AST depth guard independently of hashes`, () => fixture((directory) => {
    const path = join(directory, `node_modules/braces/lib/${method}.js`);
    writeFileSync(path, readFileSync(path, 'utf8').replace('node.nodes && depth > maxDepth', 'false'));
    const braces = createRequire(join(directory, 'package.json'))('braces');
    assert.throws(() => checkBracesDepth(braces), new RegExp(`${method}: direct AST`));
  }));
}
