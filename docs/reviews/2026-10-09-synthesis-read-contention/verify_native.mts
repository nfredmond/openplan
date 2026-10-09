/** Native request locking through the production adapter using psql, not HTTP.
 * Requires a separately seeded proof-owned database; preserves all its rows.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readSynthesisGenerationRequest } from '../../../openplan/src/lib/engagement/synthesis-generation-requests-server';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { container: string; database: string };
assert.match(config.database, /^openplan_synthesis_read_[a-f0-9]{32}$/);
assert.equal(config.container, 'supabase_db_openplan-restore-target-2026091050');
const command = ['exec', '-i', config.container, 'psql', '-U', 'postgres', '-d', config.database,
  '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const scope = { campaignId: '10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',
  workspaceId: 'd51d566d-28c6-49d2-95d2-3a7a2f0902e1', requestId: 'f0000000-0000-4000-8000-000000000001' };
const owner = '13466ed2-dcb7-4861-a528-68cc5579eea9', viewer = '7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
function query(sql: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', command, { signal });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(sql);
  });
}
async function hold() {
  const child = spawn('docker', command);
  let output = '', error = '';
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  });
  child.stderr.on('data', chunk => { error += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native lock holder not ready')), 5000);
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('LOCK_READY')) { clearTimeout(timer); resolve(); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdin.write(`BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';
        SELECT pg_advisory_xact_lock(hashtextextended('synthesis-generation-request:${scope.requestId}',0));
        SELECT 'LOCK_READY';\n`);
    });
  } catch (error) { child.stdin.end('ROLLBACK;\n'); await done; throw error; }
  let released = false;
  return async () => {
    if (!released) { released = true; child.stdin.end('ROLLBACK;\n'); }
    await done;
  };
}
function client(actor = owner, afterBusy?: () => Promise<void>) {
  const codes: (string | null)[] = [];
  const rpc = (name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    assert.equal(name, 'read_engagement_synthesis_generation_request');
    assert.deepEqual(args, { p_campaign: scope.campaignId, p_request: scope.requestId });
    const output = await query(`BEGIN; SET LOCAL statement_timeout='5s';
      CREATE FUNCTION pg_temp.read_probe() RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN RETURN jsonb_build_object('data',public.read_engagement_synthesis_generation_request('${scope.campaignId}','${scope.requestId}'),'error',NULL);
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('code',SQLSTATE)); END $$;
      SET LOCAL request.jwt.claim.sub='${actor}'; SET LOCAL ROLE authenticated;
      SELECT pg_temp.read_probe(); ROLLBACK;`, signal);
    const result = JSON.parse(output) as { data: unknown; error: { code: string } | null };
    codes.push(result.error?.code ?? null);
    if (result.error?.code === 'PT503' && afterBusy) await afterBusy();
    return result;
  } });
  return { db: { rpc } as unknown as Parameters<typeof readSynthesisGenerationRequest>[0], codes };
}
assert.equal(await query(`SELECT role FROM workspace_members WHERE workspace_id='${scope.workspaceId}' AND user_id='${viewer}';`), 'viewer', 'Proof fixture must retain viewer authority');
const baseline = client();
const saved = await readSynthesisGenerationRequest(baseline.db, scope, new AbortController().signal);
assert.deepEqual(baseline.codes, [null]);
const releaseShort = await hold();
const short = client(owner, releaseShort);
try {
  const recovered = await readSynthesisGenerationRequest(short.db, scope, new AbortController().signal);
  assert.deepEqual(recovered, saved, 'Recovered native custody differs');
  assert.deepEqual(short.codes, ['PT503', null], 'Native contention did not recover on exact retry');
} finally { await releaseShort(); }
const releasePersistent = await hold();
const persistent = client();
try {
  await assert.rejects(readSynthesisGenerationRequest(persistent.db, scope, new AbortController().signal), { kind: 'unavailable', status: 503 });
  assert.deepEqual(persistent.codes, ['PT503', 'PT503', 'PT503']);
} finally { await releasePersistent(); }
const forbidden = client(viewer);
await assert.rejects(readSynthesisGenerationRequest(forbidden.db, scope, new AbortController().signal), { kind: 'forbidden', status: 403 });
assert.deepEqual(forbidden.codes, ['42501']);
const restored = client();
assert.deepEqual(await readSynthesisGenerationRequest(restored.db, scope, new AbortController().signal), saved);
console.log(JSON.stringify({ database: config.database, transport: 'psql', cases: {
  baseline: baseline.codes, releasedContention: short.codes, persistentContention: persistent.codes,
  viewerRefused: forbidden.codes, restored: restored.codes }, requestSha256: saved.state.request?.intentSha256 }, null, 2));
