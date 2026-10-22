import { cleanup, render } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BROWSER ERRORS USED TO STOP AT console.error.
 *
 * Every error page logged to the visitor's own console and nowhere else, so a
 * page that failed for a resident on the public site left no trace an operator
 * could see (OPS-04 of the October 12 review). The error pages now send one
 * scrubbed report to this deployment, which logs it and, only when
 * OPENPLAN_SENTRY_DSN is set, forwards it to Sentry.
 *
 * Blind spots, stated: jsdom has no server, so the browser half proves the
 * report that would be sent, and the route half proves what is logged and
 * forwarded; no real Sentry project receives an event here.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn<() => void>(), push: vi.fn<(href: string) => void>() }),
}));

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => cb() };
});

const { normalizeErrorReport, scrubPath, scrubText } = await import("@/lib/observability/error-report");
const { buildSentryEnvelope, forwardToSentry, parseSentryDsn } = await import("@/lib/observability/sentry-envelope");
const { ModuleError } = await import("@/components/ui/module-error");

const MAPBOX_TOKEN = "pk.eyJ1IjoiZXhhbXBsZSIsImEiOiJjbGZha2UifQ.c2lnbmF0dXJlLXBhcnQ";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop";
const SHARE_TOKEN = "0f3c9a1b2d4e5f60718293a4b5c6d7e8";

describe("scrubbing", () => {
  it("replaces share and invitation tokens in a path and drops the query", () => {
    expect(scrubPath(`/engage/${SHARE_TOKEN}/about?lang=es#map`)).toBe("/engage/[token]/about");
    expect(scrubPath(`/invitations/abcDEF_ghi-jkl`)).toBe("/invitations/[token]");
    expect(scrubPath(`/review/land-use-plans/${SHARE_TOKEN}`)).toBe("/review/land-use-plans/[token]");
    // A long opaque segment under a route nobody listed is still treated as a token.
    expect(scrubPath(`/somewhere/${SHARE_TOKEN}`)).toBe("/somewhere/[token]");
  });

  it("keeps page names and record ids, which carry no secret", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(scrubPath(`/projects/${id}/land-use-plans`)).toBe(`/projects/${id}/land-use-plans`);
    expect(scrubPath("/published-plans")).toBe("/published-plans");
  });

  it("removes the map token, keys, addresses and query strings from free text", () => {
    const text = scrubText(
      `GET https://api.mapbox.com/styles/v1/x?access_token=${MAPBOX_TOKEN} failed for planner@agency.gov ` +
        `with ${JWT} and Bearer abc.def and sk-ant-api03-ABCDEFGHIJKLMNOP at /plan/${SHARE_TOKEN}/document`,
      2000,
    );
    expect(text).not.toContain(MAPBOX_TOKEN);
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("planner@agency.gov");
    expect(text).not.toContain(JWT);
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain("ABCDEFGHIJKLMNOP");
    expect(text).not.toContain(SHARE_TOKEN);
    expect(text).toContain("https://api.mapbox.com/styles/v1/x");
    expect(text).toContain("/plan/[token]/document");
  });

  it("keeps a stack frame's line and column after dropping its query string", () => {
    expect(scrubText("at f (https://site.example/_next/static/chunks/a.js?dpl=dpl_123:4:56)", 500)).toBe(
      "at f (https://site.example/_next/static/chunks/a.js:4:56)",
    );
  });

  it("refuses input that is not a report", () => {
    expect(normalizeErrorReport(null)).toBeNull();
    expect(normalizeErrorReport({ boundary: "Bad Tag!" })).toBeNull();
    const report = normalizeErrorReport({ boundary: "maps-error", message: "x", digest: "not a digest!", userId: "u1" });
    expect(report).toEqual({ boundary: "maps-error", name: "Error", message: "x", digest: null, stack: null, path: "/" });
  });
});

describe("the error pages send a report", () => {
  const beacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);

  beforeEach(() => {
    beacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
    window.history.replaceState({}, "", `/engage/${SHARE_TOKEN}?lang=es`);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("posts one scrubbed report to this deployment, once per error", async () => {
    const error = Object.assign(new Error(`tiles failed: access_token=${MAPBOX_TOKEN}`), { digest: "123abc" });
    const view = render(<ModuleError error={error} reset={() => undefined} backHref="/" backLabel="Home" logTag="maps-error" />);
    view.rerender(<ModuleError error={error} reset={() => undefined} backHref="/" backLabel="Home" logTag="maps-error" />);

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/client-errors");
    const sent = JSON.parse(await blob.text());
    expect(sent).toMatchObject({ boundary: "maps-error", digest: "123abc", path: "/engage/[token]" });
    expect(JSON.stringify(sent)).not.toContain(MAPBOX_TOKEN);
    expect(JSON.stringify(sent)).not.toContain(SHARE_TOKEN);
  });
});

describe("POST /api/client-errors", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function post(body: unknown) {
    return new NextRequest("https://openplan.example/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", cookie: "sb-access-token=secret-cookie" },
      body: JSON.stringify(body),
    });
  }

  it("logs a scrubbed audit line without the cookie, and sends nothing to Sentry without a DSN", async () => {
    vi.stubEnv("OPENPLAN_SENTRY_DSN", "");
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/client-errors/route");

    const response = await POST(
      post({ boundary: "portal-error", message: `failed for resident@example.org`, path: `/embed/${SHARE_TOKEN}?x=1` }),
    );

    expect(response.status).toBe(204);
    expect(logged).toHaveLength(1);
    const line = JSON.parse(logged[0]);
    expect(line).toMatchObject({
      route: "client.error",
      event: "client_error",
      context: { boundary: "portal-error", path: "/embed/[token]" },
    });
    expect(logged[0]).not.toContain("resident@example.org");
    expect(logged[0]).not.toContain(SHARE_TOKEN);
    expect(logged[0]).not.toContain("secret-cookie");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards the scrubbed report to Sentry when a DSN is set", async () => {
    vi.stubEnv("OPENPLAN_SENTRY_DSN", "https://publickey123@o42.ingest.sentry.io/4507");
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/client-errors/route");

    await POST(post({ boundary: "maps-error", message: `bad ${MAPBOX_TOKEN}`, path: "/maps" }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect(String((init?.headers as Record<string, string>)["x-sentry-auth"])).toContain("sentry_key=publickey123");
    expect(String(init?.body)).not.toContain(MAPBOX_TOKEN);
    expect(String(init?.body)).not.toContain("203.0.113.9");
  });

  it("drops what is not a report and stops logging a flood", async () => {
    vi.stubEnv("OPENPLAN_SENTRY_DSN", "");
    const { POST } = await import("@/app/api/client-errors/route");

    expect((await POST(post({ hello: "world" }))).status).toBe(204);
    expect(logged).toHaveLength(0);

    for (let index = 0; index < 40; index += 1) {
      expect((await POST(post({ boundary: "app-error", message: `m${index}` }))).status).toBe(204);
    }
    expect(logged).toHaveLength(30);
  });
});

describe("Sentry envelope", () => {
  it("parses a DSN, including one with a path prefix, and refuses a malformed one", () => {
    expect(parseSentryDsn("https://k@o1.ingest.sentry.io/123")).toEqual({
      endpoint: "https://o1.ingest.sentry.io/api/123/envelope/",
      publicKey: "k",
    });
    expect(parseSentryDsn("https://k@errors.example.gov/sentry/9")?.endpoint).toBe("https://errors.example.gov/sentry/api/9/envelope/");
    expect(parseSentryDsn("not a dsn")).toBeNull();
    expect(parseSentryDsn("https://o1.ingest.sentry.io/123")).toBeNull();
    expect(parseSentryDsn(undefined)).toBeNull();
  });

  it("writes a header, an item header and one event, with no user", () => {
    const body = buildSentryEnvelope(
      { boundary: "maps-error", name: "TypeError", message: "x", digest: null, stack: "at f", path: "/maps" },
      "browser",
      new Date("2026-10-14T12:00:00Z"),
      "a".repeat(32),
    );
    const [header, item, event, trailing] = body.split("\n");
    expect(JSON.parse(header)).toEqual({ event_id: "a".repeat(32), sent_at: "2026-10-14T12:00:00.000Z" });
    expect(JSON.parse(item)).toEqual({ type: "event" });
    const parsed = JSON.parse(event);
    expect(parsed.exception.values[0]).toEqual({ type: "TypeError", value: "x" });
    expect(parsed.tags).toMatchObject({ boundary: "maps-error", runtime: "browser" });
    expect(parsed.user).toBeUndefined();
    expect(trailing).toBe("");
  });

  it("never throws when Sentry is unreachable", async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });
    await expect(
      forwardToSentry(
        { boundary: "app-error", name: "Error", message: "x", digest: null, stack: null, path: "/" },
        "server",
        { endpoint: "https://o1.ingest.sentry.io/api/1/envelope/", publicKey: "k" },
        failing,
      ),
    ).resolves.toBe(false);
  });
});
