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
});
