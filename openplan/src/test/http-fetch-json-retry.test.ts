import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearFetchJsonResponseCacheForTests,
  __fetchJsonResponseCacheSizeForTests,
  fetchJsonWithRetry,
} from "@/lib/data-sources/http";

describe("fetchJsonWithRetry", () => {
  beforeEach(() => {
    __clearFetchJsonResponseCacheForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("returns cached payload while cache TTL remains active", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/data",
      undefined,
      { cacheTtlMs: 30_000, cacheKey: "cache:active", retries: 0 }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/data",
      undefined,
      { cacheTtlMs: 30_000, cacheKey: "cache:active", retries: 0 }
    );

    expect(first).toEqual({ source: "network" });
    expect(second).toEqual({ source: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("isolates cached object payloads from caller mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        source: "network",
        nested: { status: "fresh" },
        list: ["a", "b"],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{
      source: string;
      nested: { status: string };
      list: string[];
    }>("https://example.com/data", undefined, {
      cacheTtlMs: 30_000,
      cacheKey: "cache:mutable",
      retries: 0,
    });

    expect(first).not.toBeNull();
    if (!first) {
      throw new Error("expected first payload");
    }

    first.nested.status = "mutated-first";
    first.list.push("first");

    const second = await fetchJsonWithRetry<{
      source: string;
      nested: { status: string };
      list: string[];
    }>("https://example.com/data", undefined, {
      cacheTtlMs: 30_000,
      cacheKey: "cache:mutable",
      retries: 0,
    });

    expect(second).toEqual({
      source: "network",
      nested: { status: "fresh" },
      list: ["a", "b"],
    });

    if (!second) {
      throw new Error("expected second payload");
    }

    second.nested.status = "mutated-second";
    second.list.push("second");

    const third = await fetchJsonWithRetry<{
      source: string;
      nested: { status: string };
      list: string[];
    }>("https://example.com/data", undefined, {
      cacheTtlMs: 30_000,
      cacheKey: "cache:mutable",
      retries: 0,
    });

    expect(third).toEqual({
      source: "network",
      nested: { status: "fresh" },
      list: ["a", "b"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("treats 204 responses as successful empty payloads and caches them", async () => {
    const jsonMock = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: jsonMock,
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry(
      "https://example.com/no-content",
      undefined,
      {
        cacheTtlMs: 30_000,
        cacheKey: "cache:no-content",
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry(
      "https://example.com/no-content",
      undefined,
      {
        cacheTtlMs: 30_000,
        cacheKey: "cache:no-content",
        retries: 0,
      }
    );

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonMock).not.toHaveBeenCalled();
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("treats HEAD responses as successful empty payloads and caches them", async () => {
    const jsonMock = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jsonMock,
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry(
      "https://example.com/head-check",
      { method: "HEAD" },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry(
      "https://example.com/head-check",
      { method: "HEAD" },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonMock).not.toHaveBeenCalled();
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("does not cache non-GET/HEAD requests without an explicit cache key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corridorId: "abc123" }),
    };

    await fetchJsonWithRetry<{ source: string }>("https://example.com/mutate", requestInit, {
      cacheTtlMs: 30_000,
      retries: 0,
    });

    await fetchJsonWithRetry<{ source: string }>("https://example.com/mutate", requestInit, {
      cacheTtlMs: 30_000,
      retries: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("does not implicitly cache authenticated GET requests without an explicit cache key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const requestInit: RequestInit = {
      headers: {
        Authorization: "Bearer test-token",
      },
    };

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      requestInit,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      requestInit,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("does not implicitly cache GET requests with x-* token auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-3" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-4" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-5" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-6" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      {
        headers: {
          "x-access-token": "access-token",
        },
      },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      {
        headers: {
          "x-auth-token": "auth-token",
        },
      },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      {
        headers: {
          "x-session-token": "session-token",
        },
      },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      {
        headers: {
          "X-Token": "token-value",
        },
      },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      {
        headers: {
          "x-id-token": "id-token-value",
        },
      },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      {
        headers: {
          "x-refresh-token": "refresh-token-value",
        },
      },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("handles malformed header init values without crashing implicit cache checks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const malformedHeaders = [["bad header", "value"]] as unknown as HeadersInit;

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      { headers: malformedHeaders },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data",
      { headers: malformedHeaders },
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("allows caching authenticated GET requests when an explicit cache key is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const requestInit: RequestInit = {
      headers: {
        Authorization: "Bearer test-token",
      },
    };

    await fetchJsonWithRetry<{ source: string }>("https://example.com/private-data", requestInit, {
      cacheTtlMs: 30_000,
      cacheKey: "workspace:private-data",
      retries: 0,
    });

    await fetchJsonWithRetry<{ source: string }>("https://example.com/private-data", requestInit, {
      cacheTtlMs: 30_000,
      cacheKey: "workspace:private-data",
      retries: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("does not implicitly cache GET requests containing sensitive query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?access_token=secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?access_token=secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("does not implicitly cache GET requests containing cloud signed-url query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?X-Amz-Signature=abc123&X-Amz-Credential=plan%2F20260306%2Fus-west-2%2Fs3%2Faws4_request",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?x-goog-signature=def456&x-goog-credential=openplan%40example.iam.gserviceaccount.com",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("allows caching sensitive-query GET requests when an explicit cache key is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?access_token=secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        cacheKey: "workspace:sensitive-query",
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?access_token=secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        cacheKey: "workspace:sensitive-query",
        retries: 0,
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("does not implicitly cache GET requests with URL-embedded credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://planner-user:planner-pass@example.com/private-data",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://planner-user:planner-pass@example.com/private-data",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("allows caching URL-credential GET requests when an explicit cache key is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    await fetchJsonWithRetry<{ source: string }>(
      "https://planner-user:planner-pass@example.com/private-data",
      undefined,
      {
        cacheTtlMs: 30_000,
        cacheKey: "workspace:url-credential",
        retries: 0,
      }
    );

    await fetchJsonWithRetry<{ source: string }>(
      "https://planner-user:planner-pass@example.com/private-data",
      undefined,
      {
        cacheTtlMs: 30_000,
        cacheKey: "workspace:url-credential",
        retries: 0,
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("treats jwt and refresh_token query params as sensitive for implicit caching", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?JWT=abc123",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?refresh_token=xyz789",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("treats oauth_token, id_token, client_secret, private_token, auth_token, api_token, secret, and password query params as sensitive for implicit caching", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-3" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-4" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-5" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-6" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-7" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-8" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?oauth_token=abc123",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?id_token=xyz789",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const third = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?client_secret=super-secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const fourth = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?private_token=private-secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const fifth = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?auth_token=bearer-token",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const sixth = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?api_token=api-bearer-token",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const seventh = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?secret=ultra-secret",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const eighth = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/private-data?password=correct-horse-battery-staple",
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(third).toEqual({ source: "network-3" });
    expect(fourth).toEqual({ source: "network-4" });
    expect(fifth).toEqual({ source: "network-5" });
    expect(sixth).toEqual({ source: "network-6" });
    expect(seventh).toEqual({ source: "network-7" });
    expect(eighth).toEqual({ source: "network-8" });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("treats JWT-like query values as sensitive for implicit caching", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network-2" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const jwtLikeToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbg";

    const first = await fetchJsonWithRetry<{ source: string }>(
      `https://example.com/private-data?session=${jwtLikeToken}`,
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      `https://example.com/private-data?session=${jwtLikeToken}`,
      undefined,
      {
        cacheTtlMs: 30_000,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network-1" });
    expect(second).toEqual({ source: "network-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("does not retry retriable HTTP responses for non-idempotent methods by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: "temporarily unavailable" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry("https://example.com/post-no-retry", { method: "POST" }, {
      retries: 3,
      retryDelayMs: 0,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry network failures for non-idempotent methods by default", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry("https://example.com/post-network-no-retry", { method: "POST" }, {
      retries: 3,
      retryDelayMs: 0,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows retrying non-idempotent methods when explicitly enabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({ error: "temporarily unavailable" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/post-retry-opt-in",
      { method: "POST" },
      {
        retries: 1,
        retryDelayMs: 0,
        retryNonIdempotentMethods: true,
      }
    );

    expect(result).toEqual({ source: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows caching non-GET requests when an explicit cache key is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=%5Bout%3Ajson%5D",
    };

    await fetchJsonWithRetry<{ source: string }>("https://example.com/overpass", requestInit, {
      cacheTtlMs: 30_000,
      cacheKey: "overpass:bbox:1",
      retries: 0,
    });

    await fetchJsonWithRetry<{ source: string }>("https://example.com/overpass", requestInit, {
      cacheTtlMs: 30_000,
      cacheKey: "overpass:bbox:1",
      retries: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
  });

  it("prunes expired cache entries before setting new cache values", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: "first" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: "second" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    vi.setSystemTime(new Date("2026-03-06T08:00:00.000Z"));
    await fetchJsonWithRetry("https://example.com/one", undefined, {
      cacheTtlMs: 10,
      cacheKey: "cache:one",
      retries: 0,
    });

    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);

    vi.setSystemTime(new Date("2026-03-06T08:00:01.000Z"));
    await fetchJsonWithRetry("https://example.com/two", undefined, {
      cacheTtlMs: 10,
      cacheKey: "cache:two",
      retries: 0,
    });

    expect(__fetchJsonResponseCacheSizeForTests()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("short-circuits when caller abort signal is already aborted", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const controller = new AbortController();
    controller.abort("caller_cancelled");

    const result = await fetchJsonWithRetry(
      "https://example.com/cancel",
      {
        signal: controller.signal,
      },
      {
        retries: 2,
      }
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry when caller aborts during an in-flight request", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });

    const fetchMock = vi.fn().mockImplementation(async () => {
      controller.abort("caller_cancelled");
      throw abortError;
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry(
      "https://example.com/cancel-during-request",
      {
        signal: controller.signal,
      },
      {
        retries: 3,
        retryDelayMs: 1,
      }
    );

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respects caller aborts even when AbortSignal.any is unavailable", async () => {
    const originalAbortSignalAny = AbortSignal.any;
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: undefined,
    });

    const controller = new AbortController();
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    let requestSignal: AbortSignal | null = null;

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? null;

      return new Promise((_, reject) => {
        if (requestSignal?.aborted) {
          reject(abortError);
          return;
        }

        requestSignal?.addEventListener("abort", () => reject(abortError), {
          once: true,
        });
      });
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    try {
      const resultPromise = fetchJsonWithRetry(
        "https://example.com/cancel-during-request-no-any",
        {
          signal: controller.signal,
        },
        {
          retries: 2,
          retryDelayMs: 1,
        }
      );

      await Promise.resolve();
      const activeRequestSignal: AbortSignal | null = requestSignal;
      expect(activeRequestSignal).not.toBeNull();
      expect((activeRequestSignal as AbortSignal).aborted).toBe(false);

      controller.abort("caller_cancelled");

      const result = await resultPromise;

      expect(result).toBeNull();
      expect((activeRequestSignal as AbortSignal).aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(AbortSignal, "any", {
        configurable: true,
        value: originalAbortSignalAny,
      });
    }
  });

  it("uses a manual timeout signal fallback when AbortSignal.timeout is unavailable", async () => {
    vi.useFakeTimers();

    const originalAbortSignalTimeout = AbortSignal.timeout;
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    });

    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    let requestSignal: AbortSignal | null = null;

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? null;

      return new Promise((_, reject) => {
        if (requestSignal?.aborted) {
          reject(abortError);
          return;
        }

        requestSignal?.addEventListener("abort", () => reject(abortError), {
          once: true,
        });
      });
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    try {
      const resultPromise = fetchJsonWithRetry(
        "https://example.com/timeout-fallback",
        undefined,
        {
          timeoutMs: 50,
          retries: 0,
        }
      );

      await Promise.resolve();
      const activeRequestSignal: AbortSignal | null = requestSignal;
      expect(activeRequestSignal).not.toBeNull();
      expect((activeRequestSignal as AbortSignal).aborted).toBe(false);

      vi.advanceTimersByTime(50);
      await Promise.resolve();

      const result = await resultPromise;

      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((activeRequestSignal as AbortSignal).aborted).toBe(true);
    } finally {
      Object.defineProperty(AbortSignal, "timeout", {
        configurable: true,
        value: originalAbortSignalTimeout,
      });
      vi.useRealTimers();
    }
  });

  it("cleans up fallback timeout timers after successful requests", async () => {
    vi.useFakeTimers();

    const originalAbortSignalTimeout = AbortSignal.timeout;
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    });

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    try {
      const clearCallsBefore = clearTimeoutSpy.mock.calls.length;

      const result = await fetchJsonWithRetry<{ source: string }>(
        "https://example.com/timeout-cleanup",
        undefined,
        {
          timeoutMs: 10_000,
          retries: 0,
        }
      );

      expect(result).toEqual({ source: "network" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearCallsBefore);
    } finally {
      Object.defineProperty(AbortSignal, "timeout", {
        configurable: true,
        value: originalAbortSignalTimeout,
      });
      vi.useRealTimers();
    }
  });

  it("exits retry backoff immediately when caller aborts between attempts", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: "temporarily unavailable" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const resultPromise = fetchJsonWithRetry(
      "https://example.com/cancel-during-backoff",
      {
        signal: controller.signal,
      },
      {
        retries: 3,
        retryDelayMs: 5_000,
      }
    );

    await Promise.resolve();
    controller.abort("caller_cancelled");

    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes invalid timeout and cache TTL options without crashing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ source: "network" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/invalid-options",
      undefined,
      {
        timeoutMs: -25,
        cacheTtlMs: -500,
        retries: 0,
      }
    );

    const second = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/invalid-options",
      undefined,
      {
        timeoutMs: -25,
        cacheTtlMs: -500,
        retries: 0,
      }
    );

    expect(first).toEqual({ source: "network" });
    expect(second).toEqual({ source: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });

  it("clamps negative retries to a single request attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: "temporarily unavailable" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry("https://example.com/retry-clamp", undefined, {
      retries: -3,
      retryDelayMs: -100,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps oversized retry counts to prevent runaway retry loops", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: "temporarily unavailable" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry("https://example.com/retry-max", undefined, {
      retries: 999,
      retryDelayMs: 0,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("retries transient 408 responses and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 408,
        json: vi.fn().mockResolvedValue({ error: "request timeout" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/retry-408",
      undefined,
      {
        retries: 1,
        retryDelayMs: 0,
      }
    );

    expect(result).toEqual({ source: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient 425 responses and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 425,
        json: vi.fn().mockResolvedValue({ error: "too early" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ source: "network" }),
      });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry<{ source: string }>(
      "https://example.com/retry-425",
      undefined,
      {
        retries: 1,
        retryDelayMs: 0,
      }
    );

    expect(result).toEqual({ source: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses retry-after header delays for throttled 429 responses", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "7" }),
      json: vi.fn().mockResolvedValue({ error: "too many requests" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const resultPromise = fetchJsonWithRetry(
      "https://example.com/retry-after-seconds",
      {
        signal: controller.signal,
      },
      {
        retries: 1,
        retryDelayMs: 100,
      }
    );

    await Promise.resolve();

    const latestDelay = Number(setTimeoutSpy.mock.calls.at(-1)?.[1]);
    expect(latestDelay).toBe(7_000);

    controller.abort("test_complete");
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to exponential backoff when retry-after is invalid", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "not-a-date" }),
      json: vi.fn().mockResolvedValue({ error: "too many requests" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const resultPromise = fetchJsonWithRetry(
      "https://example.com/retry-after-invalid",
      {
        signal: controller.signal,
      },
      {
        retries: 1,
        retryDelayMs: 250,
      }
    );

    await Promise.resolve();

    const latestDelay = Number(setTimeoutSpy.mock.calls.at(-1)?.[1]);
    expect(latestDelay).toBe(250);

    controller.abort("test_complete");
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when a successful response has invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await fetchJsonWithRetry("https://example.com/invalid-json", undefined, {
      retries: 3,
      retryDelayMs: 0,
      cacheTtlMs: 30_000,
      cacheKey: "cache:invalid-json",
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__fetchJsonResponseCacheSizeForTests()).toBe(0);
  });

  it("caps retry backoff delay to one minute", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: "temporarily unavailable" }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const resultPromise = fetchJsonWithRetry(
      "https://example.com/retry-delay-cap",
      {
        signal: controller.signal,
      },
      {
        retries: 1,
        retryDelayMs: 120_000,
      }
    );

    await Promise.resolve();

    const latestDelay = Number(setTimeoutSpy.mock.calls.at(-1)?.[1]);
    expect(latestDelay).toBe(60_000);

    controller.abort("test_complete");
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
