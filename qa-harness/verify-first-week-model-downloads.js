const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STUDY_RESULT = path.resolve(
  __dirname,
  '..',
  'data/modeling/distributed-work-loading-study-2026-08-31/study-result.json',
);

function expectedDistributedWorkLoadingArtifacts(studyPath = STUDY_RESULT) {
  const study = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
  if (
    study.schema !== 'openplan.distributed-work-loading-study-result.v1' ||
    study.method_aggregation !== 'separate' ||
    study.method_records !== 14 ||
    !Array.isArray(study.counties)
  ) {
    throw new Error('The published distributed work-loading study contract is invalid.');
  }

  const artifacts = [];
  for (const county of study.counties) {
    for (const method of ['aequilibrae', 'activitysim']) {
      const record = county.methods?.[method];
      for (const [key, name] of [
        ['input', 'distributed-work-loading-input-v1.json'],
        ['audit', 'pre-output-audit-v1.json'],
        ['comparison', 'development-comparison-v1.json'],
      ]) {
        const artifact = record?.[key];
        if (!artifact || !/^[0-9a-f]{64}$/.test(artifact.sha256) || !Number.isInteger(artifact.bytes)) {
          throw new Error(`The study omitted exact custody for ${county.geography_id}/${method}/${name}.`);
        }
        artifacts.push({
          filename: `${county.geography_id}-${method}-${name}`,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
        });
      }
    }
  }
  if (artifacts.length !== 42) {
    throw new Error(`Expected 42 distributed work-loading artifacts; found ${artifacts.length}.`);
  }
  return artifacts;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

async function verifyDownloadedArtifacts(downloadDir, expectedArtifacts) {
  const partials = fs.readdirSync(downloadDir).filter((name) => name.endsWith('.crdownload'));
  if (partials.length > 0) {
    throw new Error(`Incomplete browser downloads remain: ${partials.join(', ')}`);
  }

  const verified = [];
  for (const expected of expectedArtifacts) {
    const filePath = path.join(downloadDir, expected.filename);
    if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing downloaded artifact: ${expected.filename}`);
    }
    const bytes = fs.statSync(filePath).size;
    if (bytes !== expected.bytes) {
      throw new Error(`${expected.filename} byte count changed: expected ${expected.bytes}, found ${bytes}.`);
    }
    const sha256 = await sha256File(filePath);
    if (sha256 !== expected.sha256) {
      throw new Error(`${expected.filename} SHA-256 changed: expected ${expected.sha256}, found ${sha256}.`);
    }
    verified.push({ filename: expected.filename, bytes, sha256 });
  }
  return verified;
}

async function main() {
  const downloadDir = process.argv[2];
  if (!downloadDir) {
    throw new Error('Usage: node verify-first-week-model-downloads.js <browser-download-directory>');
  }
  const verified = await verifyDownloadedArtifacts(
    path.resolve(downloadDir),
    expectedDistributedWorkLoadingArtifacts(),
  );
  process.stdout.write(`${JSON.stringify({ verified: verified.length, artifacts: verified }, null, 2)}\n`);
}

module.exports = {
  expectedDistributedWorkLoadingArtifacts,
  sha256File,
  verifyDownloadedArtifacts,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
