// Request headers for a Supabase service key. A Supabase secret key
// (sb_secret_...) is a short string, not a JWT, and belongs only on apikey.
// A legacy service_role key is a JWT and keeps both headers as before.

// Three base64url segments, the first an encoded JSON object ("{" -> "eyJ").
const LEGACY_JWT = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isLegacyJwtKey(key) {
  return typeof key === 'string' && LEGACY_JWT.test(key);
}

function serviceKeyHeaders(key) {
  return isLegacyJwtKey(key) ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

module.exports = { isLegacyJwtKey, serviceKeyHeaders };
