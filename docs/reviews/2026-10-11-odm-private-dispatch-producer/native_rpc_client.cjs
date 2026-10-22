// Run the bound application helper against an owned real PostgREST fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createHash } = require('node:crypto');

async function main() {
  const [configPath, variant, operation] = process.argv.slice(2);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const app = config.application;
  const fromApp = Module.createRequire(path.join(app, 'package.json'));
  const ts = fromApp('typescript');
  const { PostgrestClient } = fromApp('@supabase/postgrest-js');
  const sources = {};
  function load(relative, transform = (source) => source) {
    const file = path.join(app, relative);
    const source = fs.readFileSync(file, 'utf8');
    sources[relative] = createHash('sha256').update(source).digest('hex');
    const compiled = ts.transpileModule(transform(source), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    }, fileName: file }).outputText;
    const module = new Module(file);
    module.filename = file;
    module.paths = Module._nodeModulePaths(path.dirname(file));
    const originalRequire = module.require;
    module.require = function (name) {
      if (name === '@/lib/aerial/processing-contract') return contract;
      return originalRequire.call(this, name);
    };
    module._compile(compiled, file);
    return module.exports;
  }
  const contract = load('src/lib/aerial/processing-contract.ts');
  const helper = load('src/lib/aerial/original-dispatch.ts', (source) => {
    if (variant === 'harmless') return '// Harmless actual RPC control.\n' + source;
    if (variant === 'missing-abort') {
      assert.equal(source.split('AbortSignal.timeout(RPC_TIMEOUT_MS)').length - 1, 2);
      return source.replaceAll('AbortSignal.timeout(RPC_TIMEOUT_MS)', 'new AbortController().signal');
    }
    if (variant === 'authorize-revoked') {
      const original = 'return { ...receipt, authorizedNow, authorityObservedAt };';
      assert.equal(source.split(original).length - 1, 1);
      return source.replace(original, 'return { ...receipt, authorizedNow: true, authorityObservedAt };');
    }
    assert.ok(['baseline', 'restored'].includes(variant));
    return source;
  });
  const client = new PostgrestClient(config.endpoint, { headers: {
    Authorization: 'Bearer ' + config.serviceToken,
  } });
  const args = [client, config.scope, config.job, config.payloadText];
  const started = performance.now();
  const rows = [];
  if (operation === 'ordinary') {
    const original = await helper.recordOriginalDispatch(...args);
    const current = await helper.readOriginalDispatch(...args);
    assert.equal(original.payloadText, config.payloadText, 'Actual RPC exact original text');
    assert.equal(current.authorizedNow, true, 'Actual RPC original actor is current');
    assert.equal(current.engineTransportPermission, false, 'Actual RPC withholds engine permission');
    const replay = await helper.recordOriginalDispatch(...args);
    assert.deepEqual(replay, original, 'Actual RPC identical replay');
    for (const role of ['anon', 'authenticated']) {
      const forbidden = new PostgrestClient(config.endpoint, { headers: {
        Authorization: 'Bearer ' + config[role + 'Token'],
      } });
      const result = await forbidden.rpc('read_aerial_original_dispatch', {
        p_request: config.job.request_id, p_installation: config.scope.installationId,
        p_target: config.scope.targetId,
      });
      assert.equal(result.error?.code, '42501', 'Actual RPC refuses ' + role);
    }
    const hidden = await client.schema('openplan_odm_private').from('original_dispatches').select('*');
    assert.equal(hidden.error?.code, 'PGRST106', 'Private schema stays unexposed');
    rows.push('exact-original', 'current-original-scope', 'no-engine-permission', 'identical-replay',
      'anon-refused', 'authenticated-refused', 'private-schema-unexposed');
  } else if (operation === 'revoked') {
    const current = await helper.readOriginalDispatch(...args);
    assert.equal(current.authorizedNow, false, 'Actual RPC refuses revoked original scope');
    assert.equal(current.payloadText, config.payloadText, 'Revocation preserves the original text');
    assert.equal(current.engineTransportPermission, false, 'Revocation withholds engine permission');
    await assert.rejects(helper.recordOriginalDispatch(...args),
      /^Error: Original aerial dispatch custody is unavailable$/);
    rows.push('revoked-scope', 'immutable-original-readback', 'revoked-record-refused');
  } else if (operation === 'record-abort' || operation === 'read-abort') {
    const invoke = operation === 'record-abort' ? helper.recordOriginalDispatch : helper.readOriginalDispatch;
    // This is the test's deadline. It does not replace the helper's real signal.
    let timer;
    const limit = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), 12_000); });
    const outcome = await Promise.race([invoke(...args).then(() => ({ returned: true }), (error) => ({ message: error.message })), limit]);
    clearTimeout(timer);
    assert.deepEqual(outcome, { message: 'Original aerial dispatch custody is unavailable' },
      'Actual RPC deadline refuses a stalled command');
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 9_000 && elapsed < 12_000, 'Actual RPC uses its ten-second abort');
    rows.push(operation, 'static-refusal', 'ten-second-client-abort');
  } else {
    throw new Error('Unknown owned RPC operation');
  }
  fs.writeFileSync(config.result, JSON.stringify({ variant, operation, observations: rows,
    wallMilliseconds: Math.round(performance.now() - started), sourceSha256: sources }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ variant, operation, observations: rows.length }));
}
main().catch((error) => {
  console.error(error.stack);
  process.exit(1);
});
