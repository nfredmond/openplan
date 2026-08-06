import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  classifyAddress,
  fetchPublicUrl,
  hostIsAllowlisted,
  MAX_OUTBOUND_REDIRECTS,
  OUTBOUND_ALLOWED_HOSTS_ENV,
  parseIpv6,
  resolveOutboundAllowedHosts,
  type OutboundDnsLookup,
} from "@/lib/http/outbound-url";

/**
 * The env is passed explicitly EVERYWHERE. `resolveOutboundAllowedHosts`
 * defaults to `process.env`, so a machine that happens to have
 * OPENPLAN_OUTBOUND_ALLOWED_HOSTS set would otherwise change what these tests
 * mean without changing what they say.
 */
/** `NodeJS.ProcessEnv` demands NODE_ENV; this reader only ever reads one string. */
const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;
const NO_ENV = env();

/** A resolver that answers from a table and reports ENOTFOUND for anything else. */
function lookupFrom(table: Record<string, string[]>): OutboundDnsLookup {
  return async (host) => {
    const addresses = table[host];
    if (!addresses) {
      const error = new Error(`getaddrinfo ENOTFOUND ${host}`) as Error & { code?: string };
      error.code = "ENOTFOUND";
      throw error;
    }
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

/** Asserts the lookup is never reached — the shape checks must refuse first. */
const neverCalled: OutboundDnsLookup = async (host) => {
  throw new Error(`the resolver was called for ${host}, which means a check ran out of order`);
};

describe("assertPublicHttpUrl — the shape of the address", () => {
  it("refuses every scheme that is not https", async () => {
    const refused = [
      "http://feeds.example.org/gtfs.zip",
      "file:///etc/passwd",
      "ftp://feeds.example.org/gtfs.zip",
      "gopher://feeds.example.org/1",
      "data:text/plain,hello",
      "blob:https://feeds.example.org/8f2c",
    ];

    // Collected rather than asserted one at a time, so a regression reports
    // EVERY scheme it let through instead of stopping at the first.
    const codes: Record<string, string> = {};
    for (const raw of refused) {
      const result = await assertPublicHttpUrl(raw, { env: NO_ENV, lookup: neverCalled });
      codes[raw] = result.ok ? "ACCEPTED" : result.code;
    }

    expect(codes).toEqual(Object.fromEntries(refused.map((raw) => [raw, "bad_scheme"])));
  });

  it("accepts https", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({ "feeds.example.org": ["93.184.216.34"] }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.url.href).toBe("https://feeds.example.org/gtfs.zip");
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  it("refuses an address carrying a username or password", async () => {
    const withBoth = await assertPublicHttpUrl("https://user:pass@feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: neverCalled,
    });
    expect(withBoth.ok).toBe(false);
    if (withBoth.ok) throw new Error("unreachable");
    expect(withBoth.code).toBe("has_credentials");

    const withUserOnly = await assertPublicHttpUrl("https://user@feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: neverCalled,
    });
    expect(withUserOnly.ok).toBe(false);
    if (withUserOnly.ok) throw new Error("unreachable");
    expect(withUserOnly.code).toBe("has_credentials");
  });

  it("refuses a non-standard port and accepts the standard one", async () => {
    const odd = await assertPublicHttpUrl("https://feeds.example.org:8080/gtfs.zip", {
      env: NO_ENV,
      lookup: neverCalled,
    });
    expect(odd.ok).toBe(false);
    if (odd.ok) throw new Error("unreachable");
    expect(odd.code).toBe("bad_port");

    const explicit443 = await assertPublicHttpUrl("https://feeds.example.org:443/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({ "feeds.example.org": ["93.184.216.34"] }),
    });
    expect(explicit443.ok).toBe(true);
  });

  it("refuses a string that is not a URL at all", async () => {
    for (const raw of ["feeds.example.org/gtfs.zip", "", "   ", "https://"]) {
      const result = await assertPublicHttpUrl(raw, { env: NO_ENV, lookup: neverCalled });
      expect(result.ok, JSON.stringify(raw)).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code, JSON.stringify(raw)).toBe("malformed");
    }
  });
});

describe("assertPublicHttpUrl — addresses typed in directly", () => {
  const privateLiterals: Array<[string, string]> = [
    ["https://169.254.169.254/latest/meta-data/", "cloud instance metadata"],
    ["https://10.0.0.1/", "private network"],
    ["https://127.0.0.1/", "loopback"],
    ["https://192.168.1.1/", "private network"],
    ["https://172.16.0.1/", "private network"],
    ["https://172.31.255.255/", "the top of the /12"],
    ["https://100.64.0.1/", "carrier-grade NAT"],
    ["https://0.0.0.0/", "this host"],
    ["https://224.0.0.1/", "multicast"],
    ["https://255.255.255.255/", "reserved"],
    ["https://[::1]/", "IPv6 loopback"],
    ["https://[fc00::1]/", "unique local"],
    ["https://[fd00::1]/", "unique local, the half everyone actually uses"],
    ["https://[fe80::1]/", "link-local"],
    ["https://[ff02::1]/", "IPv6 multicast"],
    ["https://[::]/", "unspecified"],
  ];

  it.each(privateLiterals)("refuses %s (%s)", async (raw) => {
    const result = await assertPublicHttpUrl(raw, { env: NO_ENV, lookup: neverCalled });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
  });

  it("refuses the metadata address wrapped as IPv4-mapped IPv6", async () => {
    // `new URL()` rewrites this to `[::ffff:a9fe:a9fe]` before any check runs,
    // which is exactly why the guard parses bytes instead of matching text.
    expect(new URL("https://[::ffff:169.254.169.254]/").hostname).toBe("[::ffff:a9fe:a9fe]");

    for (const raw of ["https://[::ffff:169.254.169.254]/", "https://[::ffff:a9fe:a9fe]/"]) {
      const result = await assertPublicHttpUrl(raw, { env: NO_ENV, lookup: neverCalled });
      expect(result.ok, raw).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code, raw).toBe("private_address");
      expect(result.detail, raw).toContain("169.254.169.254");
    }
  });

  it("refuses loopback written in octal and as a bare integer", async () => {
    expect(new URL("https://0177.0.0.1/").hostname).toBe("127.0.0.1");
    expect(new URL("https://2130706433/").hostname).toBe("127.0.0.1");

    for (const raw of ["https://0177.0.0.1/", "https://2130706433/"]) {
      const result = await assertPublicHttpUrl(raw, { env: NO_ENV, lookup: neverCalled });
      expect(result.ok, raw).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code, raw).toBe("private_address");
    }
  });

  it("accepts a public address typed in directly, without asking a resolver", async () => {
    const result = await assertPublicHttpUrl("https://93.184.216.34/gtfs.zip", {
      env: NO_ENV,
      lookup: neverCalled,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });
});

describe("assertPublicHttpUrl — what the host resolves to", () => {
  it("refuses a public-looking host that resolves to a private address", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({ "feeds.example.org": ["169.254.169.254"] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
    expect(result.detail).toContain("169.254.169.254");
  });

  it("refuses when ANY of several addresses is private", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({ "feeds.example.org": ["93.184.216.34", "10.1.2.3"] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
    expect(result.detail).toContain("10.1.2.3");
  });

  it("refuses an IPv4-mapped answer from the resolver", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({ "feeds.example.org": ["::ffff:a9fe:a9fe"] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
    expect(result.detail).toContain("169.254.169.254");
  });

  it("reports a host that does not resolve", async () => {
    const result = await assertPublicHttpUrl("https://nowhere.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({}),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("unresolvable");
    expect(result.detail).toContain("ENOTFOUND");
  });

  it("reports a host that resolves to nothing", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: async () => [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("unresolvable");
  });

  it("fails closed on an address it cannot read", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: NO_ENV,
      lookup: lookupFrom({ "feeds.example.org": ["not-an-address"] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("unresolvable");
  });
});

describe("the operator allowlist", () => {
  it("is unset by default and adds no restriction", async () => {
    expect(resolveOutboundAllowedHosts(env())).toBeNull();
    expect(resolveOutboundAllowedHosts(env({ [OUTBOUND_ALLOWED_HOSTS_ENV]: "   " }))).toBeNull();

    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: env(),
      lookup: lookupFrom({ "feeds.example.org": ["93.184.216.34"] }),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a public host the operator did not list, and says so in its own words", async () => {
    const result = await assertPublicHttpUrl("https://feeds.example.org/gtfs.zip", {
      env: env({ [OUTBOUND_ALLOWED_HOSTS_ENV]: "gtfs.transitagency.gov" }),
      lookup: neverCalled,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("not_allowlisted");
    expect(result.detail).toContain("operator");
  });

  it("accepts a listed host, exactly or by domain suffix", () => {
    expect(hostIsAllowlisted("gtfs.transitagency.gov", ["gtfs.transitagency.gov"])).toBe(true);
    expect(hostIsAllowlisted("GTFS.TransitAgency.gov", ["gtfs.transitagency.gov"])).toBe(true);
    expect(hostIsAllowlisted("other.transitagency.gov", ["gtfs.transitagency.gov"])).toBe(false);
    expect(hostIsAllowlisted("gtfs.transitagency.gov", [".transitagency.gov"])).toBe(true);
    expect(hostIsAllowlisted("transitagency.gov", [".transitagency.gov"])).toBe(true);
    expect(hostIsAllowlisted("nottransitagency.gov", [".transitagency.gov"])).toBe(false);
    expect(resolveOutboundAllowedHosts(env({ [OUTBOUND_ALLOWED_HOSTS_ENV]: "a.gov, b.gov  c.gov" }))).toEqual([
      "a.gov",
      "b.gov",
      "c.gov",
    ]);
  });

  it("narrows and never widens — a listed host that resolves privately is still refused", async () => {
    const result = await assertPublicHttpUrl("https://gtfs.transitagency.gov/feed.zip", {
      env: env({ [OUTBOUND_ALLOWED_HOSTS_ENV]: "gtfs.transitagency.gov" }),
      lookup: lookupFrom({ "gtfs.transitagency.gov": ["169.254.169.254"] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
  });
});

describe("classifyAddress and the parsers underneath it", () => {
  it("reads every textual IPv6 form the same way", () => {
    const loopback = parseIpv6("::1");
    expect(loopback && Array.from(loopback)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("0:0:0:0:0:0:0:1")).toEqual(loopback);
    expect(parseIpv6("0000:0000:0000:0000:0000:0000:0000:0001")).toEqual(loopback);

    // The two spellings of IPv4-mapped 10.0.0.1 must land on the same bytes.
    expect(parseIpv6("::ffff:10.0.0.1")).toEqual(parseIpv6("::ffff:a00:1"));

    expect(parseIpv6("fe80::1%eth0")).toEqual(parseIpv6("fe80::1"));
    expect(parseIpv6("1::2::3")).toBeNull();
    expect(parseIpv6("nonsense")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7")).toBeNull();
  });

  it("blocks IPv4-mapped private addresses written in hex", () => {
    // `::ffff:a00:1` is 10.0.0.1. Nothing about the text says so.
    const verdict = classifyAddress("::ffff:a00:1");
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind !== "blocked") throw new Error("unreachable");
    expect(verdict.reason).toContain("10.0.0.1");
  });

  it("blocks the NAT64 well-known prefix carrying a private address", () => {
    const verdict = classifyAddress("64:ff9b::10.0.0.5");
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind !== "blocked") throw new Error("unreachable");
    expect(verdict.label).toBe("64:ff9b::/96");
  });

  it("lets ordinary public addresses through", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(classifyAddress(address).kind, address).toBe("public");
    }
  });

  it("says so plainly when it cannot read an address", () => {
    expect(classifyAddress("").kind).toBe("unparsed");
    expect(classifyAddress("256.1.1.1").kind).toBe("unparsed");
    expect(classifyAddress("hello").kind).toBe("unparsed");
  });
});

/**
 * A stub that behaves like the platform `fetch` in the ONE way that matters
 * here: with `redirect: "follow"` it follows the redirect itself, silently,
 * and hands back the final response. That fidelity is what makes the redirect
 * tests below mean anything — a stub that ignored the option would pass whether
 * the helper asked for "manual" or not.
 *
 * `requested` records every URL the network layer actually opened, which is the
 * assertion that distinguishes "refused before connecting" from "connected and
 * then complained".
 */
function fetchStub(routes: Record<string, { status: number; location?: string; body?: string }>) {
  const requested: string[] = [];
  const headersSeen: Array<Record<string, string>> = [];

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const mode = init?.redirect ?? "follow";
    let current = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;

    for (let hop = 0; hop < 20; hop += 1) {
      requested.push(current);
      headersSeen.push(Object.fromEntries(new Headers(init?.headers ?? undefined).entries()));

      const route = routes[current];
      if (!route) throw new TypeError(`fetch failed: nothing is listening at ${current}`);

      const headers = new Headers();
      if (route.location) headers.set("location", route.location);
      const response = new Response(route.body ?? null, { status: route.status, headers });

      const isRedirect = [301, 302, 303, 307, 308].includes(route.status) && Boolean(route.location);
      if (mode !== "follow" || !isRedirect) return response;

      current = new URL(route.location as string, current).toString();
    }

    throw new TypeError("fetch failed: too many redirects");
  }) as typeof fetch;

  return { impl, requested, headersSeen };
}

const PUBLIC_DNS = lookupFrom({
  "feeds.example.org": ["93.184.216.34"],
  "cdn.example.net": ["93.184.216.35"],
  "hop1.example.org": ["93.184.216.36"],
  "hop2.example.org": ["93.184.216.37"],
  "hop3.example.org": ["93.184.216.38"],
  "hop4.example.org": ["93.184.216.39"],
  "hop5.example.org": ["93.184.216.40"],
  "hop6.example.org": ["93.184.216.41"],
  "hop7.example.org": ["93.184.216.42"],
});

describe("fetchPublicUrl — every hop is checked, not just the first", () => {
  it("refuses a public host that redirects to the cloud metadata address, without connecting to it", async () => {
    const stub = fetchStub({
      "https://feeds.example.org/gtfs.zip": {
        status: 302,
        location: "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      },
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/": {
        status: 200,
        body: "AWS-CREDENTIALS",
      },
    });

    const result = await fetchPublicUrl(
      "https://feeds.example.org/gtfs.zip",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: stub.impl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
    expect(result.detail).toContain("169.254.169.254");
    expect(result.hops).toEqual(["https://feeds.example.org/gtfs.zip"]);

    // The load-bearing assertion. The metadata service was never contacted.
    expect(stub.requested).toEqual(["https://feeds.example.org/gtfs.zip"]);
  });

  it("refuses a redirect into a private network on a later hop", async () => {
    const stub = fetchStub({
      "https://feeds.example.org/gtfs.zip": { status: 301, location: "https://cdn.example.net/feed.zip" },
      "https://cdn.example.net/feed.zip": { status: 302, location: "https://10.1.2.3/internal" },
      "https://10.1.2.3/internal": { status: 200, body: "INTERNAL" },
    });

    const result = await fetchPublicUrl(
      "https://feeds.example.org/gtfs.zip",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: stub.impl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("private_address");
    expect(stub.requested).toEqual([
      "https://feeds.example.org/gtfs.zip",
      "https://cdn.example.net/feed.zip",
    ]);
  });

  it("follows a public redirect chain and returns the final response", async () => {
    const stub = fetchStub({
      "https://feeds.example.org/gtfs.zip": { status: 302, location: "https://cdn.example.net/feed.zip" },
      "https://cdn.example.net/feed.zip": { status: 200, body: "PK-ZIP-BYTES" },
    });

    const result = await fetchPublicUrl(
      "https://feeds.example.org/gtfs.zip",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: stub.impl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(await result.response.text()).toBe("PK-ZIP-BYTES");
    expect(result.finalUrl.href).toBe("https://cdn.example.net/feed.zip");
    expect(result.hops).toEqual([
      "https://feeds.example.org/gtfs.zip",
      "https://cdn.example.net/feed.zip",
    ]);
  });

  it("resolves a relative Location against the address that sent it", async () => {
    const stub = fetchStub({
      "https://feeds.example.org/gtfs/latest": { status: 302, location: "../archive/feed.zip" },
      "https://feeds.example.org/archive/feed.zip": { status: 200, body: "PK-ZIP-BYTES" },
    });

    const result = await fetchPublicUrl(
      "https://feeds.example.org/gtfs/latest",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: stub.impl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.finalUrl.href).toBe("https://feeds.example.org/archive/feed.zip");
  });

  it("stops after five redirects and keeps the ceiling", async () => {
    expect(MAX_OUTBOUND_REDIRECTS).toBe(5);

    const chain = fetchStub({
      "https://feeds.example.org/0": { status: 302, location: "https://hop1.example.org/1" },
      "https://hop1.example.org/1": { status: 302, location: "https://hop2.example.org/2" },
      "https://hop2.example.org/2": { status: 302, location: "https://hop3.example.org/3" },
      "https://hop3.example.org/3": { status: 302, location: "https://hop4.example.org/4" },
      "https://hop4.example.org/4": { status: 302, location: "https://hop5.example.org/5" },
      "https://hop5.example.org/5": { status: 200, body: "ARRIVED" },
    });

    const withinLimit = await fetchPublicUrl(
      "https://feeds.example.org/0",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: chain.impl },
    );
    expect(withinLimit.ok).toBe(true);
    expect(withinLimit.hops).toHaveLength(6);

    const longer = fetchStub({
      "https://feeds.example.org/0": { status: 302, location: "https://hop1.example.org/1" },
      "https://hop1.example.org/1": { status: 302, location: "https://hop2.example.org/2" },
      "https://hop2.example.org/2": { status: 302, location: "https://hop3.example.org/3" },
      "https://hop3.example.org/3": { status: 302, location: "https://hop4.example.org/4" },
      "https://hop4.example.org/4": { status: 302, location: "https://hop5.example.org/5" },
      "https://hop5.example.org/5": { status: 302, location: "https://hop6.example.org/6" },
      "https://hop6.example.org/6": { status: 200, body: "ARRIVED" },
    });

    const tooLong = await fetchPublicUrl(
      "https://feeds.example.org/0",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: longer.impl },
    );
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) throw new Error("unreachable");
    expect(tooLong.code).toBe("too_many_redirects");
    expect(longer.requested).toHaveLength(MAX_OUTBOUND_REDIRECTS + 1);

    // A caller may lower the ceiling; nothing may raise it. Asserted against the
    // SAME six-redirect chain, so the only thing that can make this pass is the
    // clamp — an earlier version of this assertion used an empty stub and passed
    // on a network error whether the clamp was there or not.
    const raisedStub = fetchStub({
      "https://feeds.example.org/0": { status: 302, location: "https://hop1.example.org/1" },
      "https://hop1.example.org/1": { status: 302, location: "https://hop2.example.org/2" },
      "https://hop2.example.org/2": { status: 302, location: "https://hop3.example.org/3" },
      "https://hop3.example.org/3": { status: 302, location: "https://hop4.example.org/4" },
      "https://hop4.example.org/4": { status: 302, location: "https://hop5.example.org/5" },
      "https://hop5.example.org/5": { status: 302, location: "https://hop6.example.org/6" },
      "https://hop6.example.org/6": { status: 200, body: "ARRIVED" },
    });

    const raised = await fetchPublicUrl(
      "https://feeds.example.org/0",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: raisedStub.impl, maxRedirects: 99 },
    );
    expect(raised.ok).toBe(false);
    if (raised.ok) throw new Error("unreachable");
    expect(raised.code).toBe("too_many_redirects");
    expect(raisedStub.requested).toHaveLength(MAX_OUTBOUND_REDIRECTS + 1);

    // And a caller CAN lower it.
    const lowered = fetchStub({
      "https://feeds.example.org/0": { status: 302, location: "https://hop1.example.org/1" },
      "https://hop1.example.org/1": { status: 302, location: "https://hop2.example.org/2" },
      "https://hop2.example.org/2": { status: 200, body: "ARRIVED" },
    });
    const stoppedEarly = await fetchPublicUrl(
      "https://feeds.example.org/0",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: lowered.impl, maxRedirects: 1 },
    );
    expect(stoppedEarly.ok).toBe(false);
    if (stoppedEarly.ok) throw new Error("unreachable");
    expect(stoppedEarly.code).toBe("too_many_redirects");
    expect(lowered.requested).toHaveLength(2);
  });

  it("drops credential headers when a redirect crosses to another origin", async () => {
    const stub = fetchStub({
      "https://feeds.example.org/gtfs.zip": { status: 302, location: "https://cdn.example.net/feed.zip" },
      "https://cdn.example.net/feed.zip": { status: 200, body: "PK-ZIP-BYTES" },
    });

    await fetchPublicUrl(
      "https://feeds.example.org/gtfs.zip",
      { headers: { authorization: "Bearer agency-secret", "x-feed-key": "keep-me" } },
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: stub.impl },
    );

    expect(stub.headersSeen[0].authorization).toBe("Bearer agency-secret");
    expect(stub.headersSeen[1].authorization).toBeUndefined();
    expect(stub.headersSeen[1]["x-feed-key"]).toBe("keep-me");
  });

  it("reports a refused address before any connection is made", async () => {
    const stub = fetchStub({});

    const result = await fetchPublicUrl(
      "http://feeds.example.org/gtfs.zip",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: stub.impl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("bad_scheme");
    expect(stub.requested).toEqual([]);
  });

  it("reports a connection that failed as a network error rather than a refusal", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const result = await fetchPublicUrl(
      "https://feeds.example.org/gtfs.zip",
      {},
      { env: NO_ENV, lookup: PUBLIC_DNS, fetchImpl: impl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("network_error");
  });
});

/**
 * The stub above emulates `redirect: "follow"`. This pins that emulation to the
 * runtime OpenPlan actually deploys on, with two real servers and the real
 * `fetch` — so nobody has to take the stub's word for what the platform does
 * with a cross-host 302.
 */
describe("the platform behaviour this module exists to prevent", () => {
  const servers: Server[] = [];

  afterEach(() => {
    while (servers.length > 0) servers.pop()?.close();
  });

  function listen(server: Server): Promise<number> {
    servers.push(server);
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });
  }

  it("follows a cross-host redirect on its own, and does not when told not to", async () => {
    const target = createServer((_request, response) => {
      response.writeHead(200);
      response.end("PRETEND-THIS-IS-INSTANCE-METADATA");
    });
    const targetPort = await listen(target);

    const entry = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/secret` });
      response.end();
    });
    const entryPort = await listen(entry);

    const followed = await fetch(`http://127.0.0.1:${entryPort}/feed`, { redirect: "follow" });
    expect(followed.status).toBe(200);
    expect(await followed.text()).toBe("PRETEND-THIS-IS-INSTANCE-METADATA");

    const manual = await fetch(`http://127.0.0.1:${entryPort}/feed`, { redirect: "manual" });
    expect(manual.status).toBe(302);
    expect(manual.headers.get("location")).toBe(`http://127.0.0.1:${targetPort}/secret`);
    await manual.body?.cancel();
  });
});
