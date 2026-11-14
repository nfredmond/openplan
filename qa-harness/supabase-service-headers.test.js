// Service-key headers for a legacy JWT key and a Supabase secret key, plus a
// scan that no harness script builds a service Bearer header by hand.
// Blind category: does not reach Supabase or prove a gateway accepts either key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { isLegacyJwtKey, serviceKeyHeaders } = require('./supabase-service-headers');

// Synthetic values: a JWT-shaped string with a made-up signature and a string
// that only borrows the documented secret-key prefix.
const LEGACY_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c3ludGhldGljLXNpZ25hdHVyZQ';
const SECRET_KEY = 'sb_secret_synthetic-unit-test-only_0000';

test('a legacy JWT key keeps apikey and Bearer', () => {
  assert.deepEqual(serviceKeyHeaders(LEGACY_JWT), { apikey: LEGACY_JWT, Authorization: `Bearer ${LEGACY_JWT}` });
});

test('a secret key goes only on apikey', () => {
  assert.deepEqual(serviceKeyHeaders(SECRET_KEY), { apikey: SECRET_KEY });
});

test('only a whole three-part JWT counts as legacy', () => {
  for (const nearMiss of [`${LEGACY_JWT}.extra`, `${LEGACY_JWT}\n`, ` ${LEGACY_JWT}`, 'eyJa.b', 'xeyJa.b.c', '', undefined]) {
    assert.equal(isLegacyJwtKey(nearMiss), false, String(nearMiss));
  }
});

test('no harness script builds a service Bearer header by hand', () => {
  const files = [
    ...fs.readdirSync(__dirname).filter((name) => name.endsWith('.js')),
    ...fs.readdirSync(path.join(__dirname, 'fixtures')).filter((name) => name.endsWith('.js')).map((name) => `fixtures/${name}`),
  ];
  const offenders = files
    .filter((name) => !name.startsWith('supabase-service-headers'))
    .filter((name) => /Bearer \$\{serviceRoleKey\}/.test(fs.readFileSync(path.join(__dirname, name), 'utf8')));
  assert.deepEqual(offenders, []);
});
