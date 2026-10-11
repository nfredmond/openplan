import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const source = await readFile(new URL('replay.mts', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const originalFetch ='), source.indexOf('const identity ='));
const fixture = { target: 'http://127.74.9.10:29941', bridge: 'http://127.0.0.1:12345' };
const path = '/rest/v1/rpc/complete_gtfs_ingest';
const records = [];
async function invoke(config, input, init, variant = code) {
  const saved = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (mapped, options) => {
      calls++;
      const request = mapped instanceof Request ? new Request(mapped, options) : new Request(mapped, options);
      assert.equal(new URL(request.url).origin, new URL(config.bridge).origin);
      assert.equal(new URL(request.url).pathname, new URL(typeof input === 'string' ? input : input.url ?? input.href).pathname);
      assert.equal(request.method, 'POST');
      assert.equal(await request.text(), '{"original":"bytes"}');
      assert.equal(request.headers.get('authorization'), 'Bearer synthetic-private');
      return new Response('{}');
    };
    new Function('config', variant)(config);
    await globalThis.fetch(input, init);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = saved; }
}
const options = { method: 'POST', headers: { authorization: 'Bearer synthetic-private' }, body: '{"original":"bytes"}' };
for (const label of ['baseline', 'harmless', 'restored', 'url-input', 'request-input']) {
  const config = { ...fixture };
  if (label === 'harmless') config.reviewerNote = 'Unrelated';
  const input = label === 'url-input' ? new URL(fixture.target + path) : label === 'request-input' ? new Request(fixture.target + path, options) : fixture.target + path;
  await invoke(config, input, label === 'request-input' ? undefined : options);
  records.push({ case: label, passed: true });
}
const variants = [
  ['foreign-origin', 'coordinated-transport-scope', c => c, 'http://127.74.9.11:29941' + path],
  ['foreign-rpc', 'coordinated-transport-scope', c => c, fixture.target + '/rest/v1/rpc/delete_anything'],
  ['query', 'coordinated-transport-scope', c => c, fixture.target + path + '?changed=1'],
  ['fragment', 'coordinated-transport-scope', c => c, fixture.target + path + '#changed'],
  ['bridge-host', 'coordinated-bridge-scope', c => ({ ...c, bridge: 'http://example.invalid/' })],
  ['bridge-protocol', 'coordinated-bridge-scope', c => ({ ...c, bridge: 'https://127.0.0.1/' })],
  ['bridge-credentials', 'coordinated-bridge-scope', c => ({ ...c, bridge: 'http://secret@127.0.0.1/' })],
  ['bridge-query', 'coordinated-bridge-scope', c => ({ ...c, bridge: c.bridge + '/?changed=1' })],
  ['bridge-fragment', 'coordinated-bridge-scope', c => ({ ...c, bridge: c.bridge + '/#changed' })],
  ['bridge-path', 'coordinated-bridge-scope', c => ({ ...c, bridge: c.bridge + '/other' })],
  ['method', 'coordinated-transport-method', c => c, undefined, { ...options, method: 'PUT' }],
];
for (const [label, reason, change, url, opts] of variants) {
  const input = url ?? fixture.target + path;
  const config = change({ ...fixture });
  await assert.rejects(invoke(config, input, opts ?? options), error => error.message === reason);
  const omitted = code.split('\n').filter(line => !line.includes("throw new Error('" + reason + "')")).join('\n');
  // Broken behavior must fail the refusal oracle, rather than survive a false green.
  await assert.rejects(async () => {
    await assert.rejects(invoke(config, input, opts ?? options, omitted), error => error.message === reason);
  }, error => error.code === 'ERR_ASSERTION');
  records.push({ case: label, reason, refused: true, omittedGuardFailsOracle: true });
}
await writeFile(new URL('mapping-controls.json', import.meta.url), JSON.stringify({ records, sourceSha256: createHash('sha256').update(source).digest('hex'), limits: 'Exact extracted mapping, synthetic authorization and mock fetch only. No network or native database writes. Fetch is restored in finally.' }, null, 2) + '\n');
console.log('5 positive mappings, 11 broken cases and 11 omitted-guard oracles pass.');
