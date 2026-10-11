import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createServiceRoleClient } from '/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011/openplan/src/lib/supabase/server.ts';
import { runGtfsOwnedAttempt } from '/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011/openplan/src/lib/gtfs/managed-worker-attempt.ts';
import { decodeGtfsParsedArtifact } from '/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011/openplan/src/lib/gtfs/parsed-artifact.ts';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const mode = process.argv[3];
const identity = JSON.parse(await readFile(join(config.commands, 'pending.json'), 'utf8'));
const artifact = JSON.parse(await readFile(join(config.artifact, 'pending.json'), 'utf8'));
const calls: Array<{ name: string; argumentsSha256: string }> = [];
let computations = 0;
function requireValue(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
async function verifiedBytes(path: string, expected: { bytes: number; sha256: string }) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    requireValue(before.isFile() && before.uid === process.getuid?.() && !(before.mode & 0o077), 'replay-file-private');
    requireValue(before.size === expected.bytes, 'replay-file-size');
    const data = await file.readFile();
    const after = await file.stat();
    requireValue(after.size === before.size && after.mtimeMs === before.mtimeMs && createHash('sha256').update(data).digest('hex') === expected.sha256, 'replay-file-bytes');
    return data;
  } finally { await file.close(); }
}
try {
  requireValue(identity.target === config.target && identity.installationId === config.installationId && identity.versionId === config.versionId, 'replay-original-identity');
  requireValue(artifact.binding.target === identity.target && artifact.binding.installationId === identity.installationId && artifact.binding.versionId === identity.versionId && artifact.binding.token === identity.token, 'replay-artifact-identity');
  requireValue(artifact.binding.workspaceId === config.workspaceId && artifact.binding.feedId === config.feedId && artifact.binding.actorId === config.actorId, 'replay-original-actor');
  await verifiedBytes(join(config.artifact, 'archive.zip'), artifact.binding.archive);
  const receipt = artifact.output.receipt;
  const bytes = await verifiedBytes(join(config.artifact, artifact.output.name), { bytes: receipt.byteSize, sha256: receipt.sha256 });
  const parsed = decodeGtfsParsedArtifact(JSON.parse(bytes.toString('utf8')), { parsed: receipt.parsed, archiveBytes: artifact.binding.archive.bytes });
  requireValue(parsed.ok && parsed.feed.routes.length === 132 && parsed.feed.stops.length === 11138 && parsed.feed.stats.stopTimesRows === 5920320, 'replay-parser-counts');
  const client = createServiceRoleClient();
  const service = new Proxy(client, { get(target, property, receiver) {
    if (property === 'rpc') return (name: string, args: Record<string, unknown>) => {
      requireValue(['claim_gtfs_ingest', 'read_gtfs_ingest_attempt', 'complete_gtfs_ingest'].includes(name), 'replay-unexpected-rpc');
      calls.push({ name, argumentsSha256: createHash('sha256').update(JSON.stringify(args)).digest('hex') });
      return target.rpc(name, args);
    };
    return Reflect.get(target, property, receiver);
  } });
  const result = await runGtfsOwnedAttempt({ directory: config.commands, target: mode === 'wrong-target' ? 'http://127.74.9.11:29941' : config.target,
    installationId: mode === 'wrong-installation' ? '00000000-0000-4000-8000-000000000000' : config.installationId,
    versionId: config.versionId, maxCommandBytes: 4 * 1024 * 1024, signal: AbortSignal.timeout(30000), service,
    work: async () => { computations++; throw new Error('replay-recomputation-refused'); } });
  requireValue(result.state === 'recovered_terminal' && result.operation === 'complete', 'replay-terminal-outcome');
  requireValue(computations === 0, 'replay-computation-repeated');
  requireValue(result.snapshotBeforeDelivery.state === 'ready' && !result.snapshotBeforeDelivery.active && result.snapshotBeforeDelivery.actorId === config.actorId, 'replay-native-snapshot');
  const terminal = JSON.parse(await readFile(join(config.commands, 'command-terminal/pending.json'), 'utf8'));
  requireValue(isDeepStrictEqual(terminal, config.expectedTerminal), 'replay-exact-terminal-receipt');
  const expectedCalls = mode === 'uncertain' ? ['claim_gtfs_ingest', 'read_gtfs_ingest_attempt', 'complete_gtfs_ingest'] : ['claim_gtfs_ingest', 'read_gtfs_ingest_attempt'];
  requireValue(isDeepStrictEqual(calls.map(row => row.name), expectedCalls), 'replay-native-call-sequence');
  requireValue(result.result.retained === (mode !== 'uncertain'), 'replay-receipt-origin');
  console.log(JSON.stringify({ mode, state: result.state, computations, calls, terminalEqual: true, retainedReceipt: result.result.retained, routes: 132, stops: 11138, stopTimeRows: 5920320 }));
} catch (error) {
  console.log(JSON.stringify({ mode, refused: true, reason: error instanceof Error ? error.message : 'Unknown', computations, calls }));
  process.exitCode = 2;
}
