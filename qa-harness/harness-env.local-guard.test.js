const assert = require('assert');
const {
  assertLocalTargetUrl,
  guardLocalMutationTargets,
  isLocalHostname,
  isSupabaseCloudHostname,
  isVercelHostname,
  parseTargetUrl,
} = require('./harness-env');

function assertThrowsUrl(value, expectedPattern, label = 'Guarded target') {
  assert.throws(() => assertLocalTargetUrl(value, label), expectedPattern);
}

assert.equal(parseTargetUrl('http://localhost:3000', 'app').origin, 'http://localhost:3000');
assert.equal(isLocalHostname('localhost'), true);
assert.equal(isLocalHostname('api.localhost'), true);
assert.equal(isLocalHostname('127.0.0.1'), true);
assert.equal(isLocalHostname('[::1]'), true);
assert.equal(isLocalHostname('example.com'), false);

assert.doesNotThrow(() => assertLocalTargetUrl('http://localhost:3000', 'app'));
assert.doesNotThrow(() => assertLocalTargetUrl('http://127.0.0.1:54321', 'supabase'));

assert.equal(isVercelHostname('openplan-natford.vercel.app'), true);
assert.equal(isSupabaseCloudHostname('abcd.supabase.co'), true);

assertThrowsUrl('https://openplan-natford.vercel.app', /refuses Vercel URLs/);
assertThrowsUrl('https://abcd.supabase.co', /refuses Supabase cloud URLs/);
assertThrowsUrl('https://example.com', /refuses non-local URLs/);
assertThrowsUrl('ftp://localhost:21', /must use http or https/);

const note = guardLocalMutationTargets({
  appUrl: 'http://localhost:3000',
  supabaseUrl: 'http://127.0.0.1:54321',
  scriptName: 'local guard test',
});
assert.match(note, /^Local guard passed for local guard test:/);
assert.match(note, /app=http:\/\/localhost:3000/);
assert.match(note, /supabase=http:\/\/127\.0\.0\.1:54321/);

console.log('harness-env local guard checks passed');
