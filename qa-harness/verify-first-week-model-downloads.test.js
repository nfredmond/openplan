const assert = require('node:assert');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  expectedDistributedWorkLoadingArtifacts,
  verifyDownloadedArtifacts,
} = require('./verify-first-week-model-downloads');

async function main() {
  const expected = expectedDistributedWorkLoadingArtifacts();
  assert.strictEqual(expected.length, 42);
  assert.strictEqual(new Set(expected.map((artifact) => artifact.filename)).size, 42);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openplan-model-downloads-'));
  const bytes = Buffer.from('mutation-proof artifact\n');
  const fixture = {
    filename: 'fixture.json',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  fs.writeFileSync(path.join(dir, fixture.filename), bytes);
  assert.strictEqual((await verifyDownloadedArtifacts(dir, [fixture])).length, 1);

  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  fs.writeFileSync(path.join(dir, fixture.filename), changed);
  await assert.rejects(verifyDownloadedArtifacts(dir, [fixture]), /SHA-256 changed/);
  process.stdout.write('Model download verifier accepts exact bytes and rejects a surviving mutation.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
