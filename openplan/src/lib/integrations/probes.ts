/**
 * Live-validation probes: one cheap, real API call per integration provider,
 * used by the integration-keys routes to verify a key BEFORE it is stored and
 * to check the effective key on demand. Save-only-what-validates is the rule —
 * a dead key must never be persisted where it would silently break a tenant.
 *
 * Contract, uniform across providers:
 *   * takes the plaintext key as an argument (never reads env or context);
 *   * NEVER throws — every failure returns `{ ok: false, detail }`;
 *   * `detail` is honest, user-facing copy that names what actually happened
 *     (rejected vs unreachable vs unexpected answer) and NEVER contains the
 *     key, any request URL, or any response body beyond a provider error code;
 *   * bounded by an ~8s abort so a hung provider cannot hang the route.
 *
 * Adding a provider to the registry (providers.ts) requires adding its probe
 * here — the dispatch switch is exhaustive over IntegrationProviderId, so a
 * missing probe fails the typecheck rather than surfacing at runtime.
 */

import type { IntegrationProviderId } from "./providers";

export type IntegrationProbeResult = {
  ok: boolean;
  /** Honest, secret-free copy describing the outcome. */
  detail: string;
};

const PROBE_TIMEOUT_MS = 8_000;

type ProbeFetchOutcome =
  | { kind: "response"; status: number; bodyText: string }
  | { kind: "unreachable"; detail: string };

/**
 * One bounded fetch that cannot throw. `hostLabel` is the only thing from the
 * request that may appear in user-facing copy — never the URL, which for some
 * providers carries the key as a query parameter.
 */
async function probeFetch(
  url: string,
  hostLabel: string,
  init?: RequestInit
): Promise<ProbeFetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // A body read failure leaves bodyText empty; status alone still answers.
    }
    return { kind: "response", status: response.status, bodyText };
  } catch {
    return {
      kind: "unreachable",
      detail: controller.signal.aborted
        ? `${hostLabel} did not answer within ${PROBE_TIMEOUT_MS / 1000} seconds, so the key could not be verified. Try again shortly.`
        : `Could not reach ${hostLabel} from this deployment, so the key could not be verified. Check the deployment's network access and try again.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Anthropic: list models — free of side effects and answers 401 on a bad key. */
export async function probeAnthropicKey(key: string): Promise<IntegrationProbeResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, detail: "No Anthropic API key was provided." };

  const outcome = await probeFetch("https://api.anthropic.com/v1/models", "api.anthropic.com", {
    headers: { "x-api-key": trimmed, "anthropic-version": "2023-06-01" },
  });
  if (outcome.kind === "unreachable") return { ok: false, detail: outcome.detail };
  if (outcome.status === 200) return { ok: true, detail: "Anthropic accepted the key." };
  if (outcome.status === 401 || outcome.status === 403) {
    return { ok: false, detail: "The key was rejected by Anthropic." };
  }
  return {
    ok: false,
    detail: `Anthropic answered HTTP ${outcome.status}, so the key could not be verified. Try again shortly.`,
  };
}

/**
 * Census: one tiny ACS request. The Census API does not reject a missing or
 * invalid key with a clean error — it redirects to an HTML page or answers
 * with non-JSON text (see src/lib/data-sources/census-api-key.ts for the
 * history), so success is strictly "HTTP 200 AND the body parses as a JSON
 * array". The URL is built with URLSearchParams because the key being probed
 * is an explicit candidate, not the configured key `withCensusApiKey` appends.
 */
export async function probeCensusKey(key: string): Promise<IntegrationProbeResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, detail: "No Census API key was provided." };

  const url = new URL("https://api.census.gov/data/2023/acs/acs5");
  url.searchParams.set("get", "NAME");
  url.searchParams.set("for", "us:1");
  url.searchParams.set("key", trimmed);

  const outcome = await probeFetch(url.toString(), "api.census.gov");
  if (outcome.kind === "unreachable") return { ok: false, detail: outcome.detail };
  if (outcome.status !== 200) {
    return {
      ok: false,
      detail: `The Census API answered HTTP ${outcome.status} instead of data — the key looks invalid, or the service is temporarily unavailable.`,
    };
  }
  if (Array.isArray(parseJson(outcome.bodyText))) {
    return { ok: true, detail: "The Census API accepted the key." };
  }
  return {
    ok: false,
    detail:
      "The Census API did not answer with data. That is how it responds to an invalid or missing key — it redirects to an explanation page instead of returning an error.",
  };
}

/** Mapbox: the token-introspection endpoint names the problem in its `code`. */
export async function probeMapboxToken(key: string): Promise<IntegrationProbeResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, detail: "No Mapbox token was provided." };

  const url = new URL("https://api.mapbox.com/tokens/v2");
  url.searchParams.set("access_token", trimmed);

  const outcome = await probeFetch(url.toString(), "api.mapbox.com");
  if (outcome.kind === "unreachable") return { ok: false, detail: outcome.detail };

  const body = parseJson(outcome.bodyText);
  const code =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code
      : null;

  if (outcome.status === 200 && code === "TokenValid") {
    return { ok: true, detail: "Mapbox reports the token is valid." };
  }
  switch (code) {
    case "TokenMalformed":
      return {
        ok: false,
        detail: "Mapbox reports the token is malformed — check that the whole token was copied.",
      };
    case "TokenInvalid":
      return { ok: false, detail: "Mapbox rejected the token as invalid." };
    case "TokenExpired":
      return { ok: false, detail: "Mapbox reports the token has expired." };
    case "TokenRevoked":
      return { ok: false, detail: "Mapbox reports the token was revoked." };
    default:
      return code
        ? { ok: false, detail: `Mapbox did not validate the token (${code}).` }
        : {
            ok: false,
            detail: `Mapbox answered HTTP ${outcome.status}, so the token could not be verified. Try again shortly.`,
          };
  }
}

/** Dispatch by provider id — exhaustive, so a new provider cannot ship probeless. */
export async function probeIntegrationKey(
  provider: IntegrationProviderId,
  key: string
): Promise<IntegrationProbeResult> {
  switch (provider) {
    case "anthropic":
      return probeAnthropicKey(key);
    case "census":
      return probeCensusKey(key);
    case "mapbox":
      return probeMapboxToken(key);
  }
}
