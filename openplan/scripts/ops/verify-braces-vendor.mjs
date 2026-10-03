import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkBracesDepth } from './braces-depth-checks.mjs';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path, algorithm = 'sha256') => createHash(algorithm).update(readFileSync(path)).digest(algorithm === 'sha512' ? 'base64' : 'hex');

// Inventory actual npm package directories so an extra nested copy cannot evade the lock check.
function installedCopies(modules, found = [], visited = new Set()) {
  if (!existsSync(modules)) return found;
  const actual = realpathSync(modules);
  if (visited.has(actual)) return found;
  visited.add(actual);
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(modules, entry.name);
    if (entry.name.startsWith('@')) installedCopies(path, found, visited);
    else if (entry.isDirectory() || entry.isSymbolicLink()) {
      const metadata = join(path, 'package.json');
      if (existsSync(metadata) && json(metadata).name === 'braces') found.push(realpathSync(path));
      installedCopies(join(path, 'node_modules'), found, visited);
    }
  }
  return found;
}

export function verifyBracesVendor(root) {
  const vendor = join(root, 'vendor/braces');
  const manifest = json(join(vendor, 'manifest.json'));
  const spec = `file:vendor/braces/${manifest.archive}`;
  const app = json(join(root, 'package.json'));
  assert.equal(app.devDependencies.braces, spec, 'direct local dependency');
  assert.equal(app.overrides.braces, '$braces', 'all transitive copies use the local dependency');
  for (const [name, digest] of [
    [manifest.upstreamArchive, manifest.upstreamSha256],
    [manifest.patchFile, manifest.patchSha256], [manifest.archive, manifest.archiveSha256],
  ]) assert.equal(hash(join(vendor, name)), digest, `vendor hash: ${name}`);
  const lock = json(join(root, 'package-lock.json'));
  const copies = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/braces$/.test(path));
  assert.deepEqual(copies.map(([path]) => path), ['node_modules/braces'], 'one locked braces package');
  const locked = copies[0][1];
  assert.equal(locked.version, manifest.localVersion, 'locked version');
  assert.equal(locked.resolved, spec, 'locked local archive');
  assert.equal(locked.integrity, `sha512-${hash(join(vendor, manifest.archive), 'sha512')}`, 'locked archive integrity');
  const installed = realpathSync(join(root, 'node_modules/braces'));
  assert.deepEqual(installedCopies(join(root, 'node_modules')), [installed], 'one installed braces package');
  for (const [name, digest] of Object.entries(manifest.files)) {
    assert.equal(hash(join(installed, name)), digest, `installed hash: ${name}`);
  }
  const require = createRequire(join(root, 'package.json'));
  assert.equal(realpathSync(dirname(require.resolve('braces/package.json'))), installed, 'resolved package identity');
  checkBracesDepth(require('braces'));
  return { package: manifest.localVersion, installedCopies: 1, fileHashes: Object.keys(manifest.files).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(verifyBracesVendor(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))));
}
