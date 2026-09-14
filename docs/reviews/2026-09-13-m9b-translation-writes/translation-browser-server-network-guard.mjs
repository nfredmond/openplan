// This preload belongs only to the isolated synthetic browser acceptance server.
// Staff generation must queue work; any inline Anthropic request fails locally.
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === 'api.anthropic.com') {
    throw new Error('SYNTHETIC browser server cannot call Anthropic; use the local worker transport');
  }
  return originalFetch.call(this, input, init);
};
