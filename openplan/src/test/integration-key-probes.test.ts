import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeAnthropicKey,
  probeCensusKey,
  probeIntegrationKey,
  probeMapboxToken,
} from "@/lib/integrations/probes";

/**
 * The probes' contract: one cheap real call, never throws, honest secret-free
 * copy. Fetch is stubbed here; the shapes mirror how each provider actually
 * answers (Anthropic clean 401s; Census redirects to HTML instead of erroring;
 * Mapbox names the problem in a `code` field).
 */

const fetchMock = vi.fn();

function response(status: number, bodyText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bodyText,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("anthropic probe", () => {
  it("accepts on 200 and sends the documented headers", async () => {
    fetchMock.mockResolvedValue(response(200, "{}"));
    const result = await probeAnthropicKey("sk-ant-test-key");

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/models");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("reports a rejected key on 401/403 without echoing it", async () => {
    for (const status of [401, 403]) {
      fetchMock.mockResolvedValue(response(status, "{}"));
      const result = await probeAnthropicKey("sk-ant-bad-key");
      expect(result).toEqual({ ok: false, detail: "The key was rejected by Anthropic." });
      expect(result.detail).not.toContain("sk-ant-bad-key");
    }
  });

  it("is transport-honest about other statuses", async () => {
    fetchMock.mockResolvedValue(response(529, ""));
    const result = await probeAnthropicKey("sk-ant-test-key");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("529");
  });

  it("never throws on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const result = await probeAnthropicKey("sk-ant-test-key");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/could not reach/i);
    expect(result.detail).not.toContain("sk-ant-test-key");
  });
});

describe("census probe", () => {
  it("accepts only a 200 that parses as a JSON array", async () => {
    fetchMock.mockResolvedValue(response(200, '[["NAME","us"],["United States","1"]]'));
    const result = await probeCensusKey("census-key-123");

    expect(result.ok).toBe(true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.census.gov");
    expect(url).toContain("key=census-key-123");
  });

  it("treats a 200 HTML answer as an invalid or missing key — the Census failure mode", async () => {
    fetchMock.mockResolvedValue(response(200, "<html>Invalid Key</html>"));
    const result = await probeCensusKey("bad-census-key");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/invalid or missing key/i);
    expect(result.detail).not.toContain("bad-census-key");
  });

  it("is transport-honest about a non-200", async () => {
    fetchMock.mockResolvedValue(response(400, "A valid key must be included"));
    const result = await probeCensusKey("census-key-123");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("400");
  });

  it("never throws on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const result = await probeCensusKey("census-key-123");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/could not reach/i);
  });
});

describe("mapbox probe", () => {
  it("accepts on 200 + TokenValid", async () => {
    fetchMock.mockResolvedValue(response(200, JSON.stringify({ code: "TokenValid" })));
    const result = await probeMapboxToken("pk.valid-token");

    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.mapbox.com/tokens/v2");
  });

  it("maps the named token failures to honest copy", async () => {
    const cases: Array<[string, RegExp]> = [
      ["TokenMalformed", /malformed/i],
      ["TokenInvalid", /invalid/i],
      ["TokenExpired", /expired/i],
      ["TokenRevoked", /revoked/i],
    ];
    for (const [code, pattern] of cases) {
      fetchMock.mockResolvedValue(response(401, JSON.stringify({ code })));
      const result = await probeMapboxToken("pk.some-token");
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(pattern);
      expect(result.detail).not.toContain("pk.some-token");
    }
  });

  it("is transport-honest when the answer has no code", async () => {
    fetchMock.mockResolvedValue(response(500, "upstream error"));
    const result = await probeMapboxToken("pk.some-token");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("500");
  });

  it("never throws on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const result = await probeMapboxToken("pk.some-token");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/could not reach/i);
  });
});

describe("probeIntegrationKey dispatch", () => {
  it("routes each provider id to its own probe", async () => {
    fetchMock.mockResolvedValue(response(200, '[["NAME"]]'));
    await probeIntegrationKey("census", "census-key-123");
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.census.gov");

    fetchMock.mockResolvedValue(response(200, "{}"));
    await probeIntegrationKey("anthropic", "sk-ant-test-key");
    expect(String(fetchMock.mock.calls[1][0])).toContain("api.anthropic.com");
  });

  it("refuses an empty key without making a network call", async () => {
    for (const provider of ["anthropic", "census", "mapbox"] as const) {
      const result = await probeIntegrationKey(provider, "   ");
      expect(result.ok).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
