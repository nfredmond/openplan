import { promises as dnsPromises } from "node:dns";

/**
 * Whether the server may fetch an address a member of a workspace typed in.
 *
 * THE DOOR THIS EXISTS FOR. Everything OpenPlan fetches today is an address the
 * CODE chose — Overpass, TIGERweb, CCRS, a worker URL an operator set. A GTFS
 * lane changes that: a workspace member pastes a transit operator's feed URL and
 * the SERVER fetches it. That is the first member-supplied address in the
 * product, and a server fetching one is a request made from inside the
 * deployment's network with the deployment's credentials in ambient reach —
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` on any
 * cloud host, `http://127.0.0.1:54321/` on a self-hosted box running Supabase,
 * `https://10.0.0.5/` on an agency LAN. None of those are exotic; the first one
 * is the single most-copied SSRF payload in existence.
 *
 * WHY IT IS SHARED AND NOT PART OF THE GTFS LANE. There was no outbound-URL
 * validation anywhere in this repository when this was written — `models/
 * artifact-source.ts` REFUSES remote URLs rather than checking them, and
 * `data-sources/http.ts` does no host validation at all. The second feature to
 * fetch a member-supplied address will be written by a different session, and a
 * check that lives inside the first feature's folder gets reimplemented by the
 * second one, differently and worse. It lives in `lib/http` so the next lane
 * imports it instead of inventing it.
 *
 * SERVER ONLY. It imports `node:dns`. Do not import it from a client component;
 * `body-limit.ts` next door is imported by client components and deliberately
 * uses nothing but web standards, which is why the two are separate modules.
 *
 * WHAT IS ACTUALLY CHECKED, in order, refusing at the first failure:
 *   1. the string parses as a URL at all           → `malformed`
 *   2. the scheme is `https:`                       → `bad_scheme`
 *   3. there is no `user:password@` in it           → `has_credentials`
 *   4. the port is unset or 443                     → `bad_port`
 *   5. the host is on the operator allowlist, when one is configured
 *                                                   → `not_allowlisted`
 *   6. the host resolves                            → `unresolvable`
 *   7. EVERY resolved address is publicly routable  → `private_address`
 *
 * Step 7 says EVERY on purpose. A host with one public A record and one private
 * one is refused, because which address the connect picks is not this module's
 * to decide.
 *
 * WHY THE TEXTUAL FORM OF AN ADDRESS IS NEVER MATCHED. Addresses are parsed to
 * bytes and compared against a prefix table. A guard that pattern-matched
 * strings would be defeated by ordinary, boring normalization that has already
 * happened by the time it runs:
 *
 *     new URL("https://[::ffff:169.254.169.254]/").hostname === "[::ffff:a9fe:a9fe]"
 *     new URL("https://0177.0.0.1/").hostname            === "127.0.0.1"
 *     new URL("https://2130706433/").hostname            === "127.0.0.1"
 *
 * The first line is the classic miss this module was told to avoid: the cloud
 * metadata address, wrapped as IPv4-mapped IPv6, and WHATWG `URL` rewrites it
 * into hex before any check sees it. Parsing to 16 bytes catches it, and catches
 * `::ffff:a9fe:a9fe` written that way from the start, which no `::ffff:` +
 * dotted-quad regex ever would.
 *
 * REDIRECTS ARE THE HALF EVERYONE FORGETS, so the fetch helper is part of this
 * module rather than left to the caller. `fetch(url, { redirect: "follow" })` —
 * the default — will take a 302 from a perfectly public host to
 * `http://169.254.169.254/` without asking anyone, and the caller never sees the
 * hop. Verified against Node's own runtime in `outbound-url.test.ts` rather than
 * asserted from memory. `fetchPublicUrl` uses `redirect: "manual"` and re-runs
 * every check above on every hop, to a maximum of five.
 *
 * WHAT THIS DOES NOT COVER — DNS REBINDING, and it cannot.
 *
 * The check resolves the host and then Node's `fetch` resolves it AGAIN when it
 * connects. Nothing in the platform lets a caller pin the address it validated
 * to the socket that gets opened, so a host under an attacker's control can
 * answer the first lookup with a public address and the second with
 * 169.254.169.254, and this module will have approved it. That is a real
 * residual, not a theoretical one, and it is stated here rather than papered
 * over because a guard believed to be complete stops being looked at.
 *
 * What actually reduces it, none of which is a fix:
 *   - the response is opaque bytes to this module; it returns a `Response` and
 *     never parses, echoes, or renders a body, so a caller that treats a feed as
 *     a feed does not turn a fetched page into an answer for the requester;
 *   - a refusal is recorded with its `code`, so the attempts are countable in
 *     host logs rather than invisible;
 *   - `OPENPLAN_OUTBOUND_ALLOWED_HOSTS` exists for deployments that want
 *     certainty instead of mitigation — an allowlisted host still gets every
 *     check above, so the env narrows and never widens.
 *
 * A real fix means resolving once and connecting to the resolved address with a
 * custom dispatcher (undici `connect` with a fixed IP and the original Host
 * header). That is a dependency-level change, and it is not pretended here.
 */

/** Comma- or whitespace-separated hosts. Unset means "no extra restriction". */
export const OUTBOUND_ALLOWED_HOSTS_ENV = "OPENPLAN_OUTBOUND_ALLOWED_HOSTS";

/** The ceiling on redirect hops. A caller may lower it; nothing may raise it. */
export const MAX_OUTBOUND_REDIRECTS = 5;

/**
 * Why an address was refused.
 *
 * `malformed` and `not_allowlisted` are here because collapsing them into one of
 * the other five would misreport: an unparseable string is not a bad scheme, and
 * a public host an operator did not list is not a private address. A refusal
 * that names the wrong reason is how an operator spends an afternoon looking in
 * the wrong place.
 */
export type OutboundUrlRefusalCode =
  | "malformed"
  | "bad_scheme"
  | "has_credentials"
  | "bad_port"
  | "not_allowlisted"
  | "private_address"
  | "unresolvable";

export type OutboundUrlOutcome =
  | {
      ok: true;
      url: URL;
      /** Every address the host resolved to, all of them public. For the audit line. */
      addresses: string[];
    }
  | {
      ok: false;
      code: OutboundUrlRefusalCode;
      /** One sentence naming what was refused and why. Safe to show a planner. */
      detail: string;
    };

/** One address family's worth of "do not connect here". */
type AddressRange = {
  /** How the range is written in the RFCs, for the refusal text. */
  label: string;
  /** What it is, in the words someone reading a log would want. */
  reason: string;
  bytes: Uint8Array;
  prefixBits: number;
};

function v4(a: number, b: number, c: number, d: number): Uint8Array {
  return new Uint8Array([a, b, c, d]);
}

/**
 * IPv4 ranges that are never a public transit feed.
 *
 * This is the list the guard was specified with, kept as data so a range can be
 * added without touching a code path. Ranges NOT here — 192.0.2.0/24 and
 * 203.0.113.0/24 (documentation), 198.18.0.0/15 (benchmarking) — are unroutable
 * on the public internet but are not a private service either; a deployment that
 * wants them refused should use the allowlist, which refuses everything else too.
 */
const IPV4_BLOCKED: AddressRange[] = [
  { label: "0.0.0.0/8", reason: "this host, on this network", bytes: v4(0, 0, 0, 0), prefixBits: 8 },
  { label: "10.0.0.0/8", reason: "private network", bytes: v4(10, 0, 0, 0), prefixBits: 8 },
  { label: "100.64.0.0/10", reason: "carrier-grade NAT", bytes: v4(100, 64, 0, 0), prefixBits: 10 },
  { label: "127.0.0.0/8", reason: "loopback — the server itself", bytes: v4(127, 0, 0, 0), prefixBits: 8 },
  {
    label: "169.254.0.0/16",
    reason: "link-local — cloud instance metadata lives here",
    bytes: v4(169, 254, 0, 0),
    prefixBits: 16,
  },
  { label: "172.16.0.0/12", reason: "private network", bytes: v4(172, 16, 0, 0), prefixBits: 12 },
  { label: "192.168.0.0/16", reason: "private network", bytes: v4(192, 168, 0, 0), prefixBits: 16 },
  { label: "224.0.0.0/4", reason: "multicast", bytes: v4(224, 0, 0, 0), prefixBits: 4 },
  { label: "240.0.0.0/4", reason: "reserved", bytes: v4(240, 0, 0, 0), prefixBits: 4 },
];

function v6(...groups: number[]): Uint8Array {
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/**
 * IPv6 ranges that are never a public transit feed.
 *
 * `::/128`, `ff00::/8` and `64:ff9b::/96` are here as the v6 mirrors of rules the
 * v4 table already has — the unspecified address, multicast, and an embedded v4
 * that a NAT64 gateway will happily translate into a connection to 10.0.0.5.
 * Leaving them out would have made the v6 half of this guard weaker than the v4
 * half for no reason anyone could have defended later.
 */
const IPV6_BLOCKED: AddressRange[] = [
  { label: "::/128", reason: "the unspecified address", bytes: v6(), prefixBits: 128 },
  { label: "::1/128", reason: "loopback — the server itself", bytes: v6(0, 0, 0, 0, 0, 0, 0, 1), prefixBits: 128 },
  {
    label: "::ffff:0:0/96",
    reason: "an IPv4 address wearing IPv6 clothes",
    bytes: v6(0, 0, 0, 0, 0, 0xffff, 0, 0),
    prefixBits: 96,
  },
  {
    label: "64:ff9b::/96",
    reason: "NAT64 — an IPv4 address a gateway will translate",
    bytes: v6(0x64, 0xff9b, 0, 0, 0, 0, 0, 0),
    prefixBits: 96,
  },
  { label: "fc00::/7", reason: "unique local address", bytes: v6(0xfc00, 0, 0, 0, 0, 0, 0, 0), prefixBits: 7 },
  { label: "fe80::/10", reason: "link-local", bytes: v6(0xfe80, 0, 0, 0, 0, 0, 0, 0), prefixBits: 10 },
  { label: "ff00::/8", reason: "multicast", bytes: v6(0xff00, 0, 0, 0, 0, 0, 0, 0), prefixBits: 8 },
];

/** Dotted quad to four bytes, or null when it is not one. */
export function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index];
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

/**
 * Any textual IPv6 form to sixteen bytes, or null when it is not one.
 *
 * Handles `::` compression, an embedded IPv4 tail (`::ffff:10.0.0.1`), and a
 * zone id (`fe80::1%eth0`), because all three are forms a resolver or a URL can
 * hand back and all three defeat string matching.
 */
export function parseIpv6(text: string): Uint8Array | null {
  let value = text;

  const zoneAt = value.indexOf("%");
  if (zoneAt >= 0) value = value.slice(0, zoneAt);
  if (!value) return null;

  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    const embedded = parseIpv4(value.slice(lastColon + 1));
    if (!embedded) return null;
    const high = ((embedded[0] << 8) | embedded[1]).toString(16);
    const low = ((embedded[2] << 8) | embedded[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }

  let head: string[];
  let tail: string[];
  const compressedAt = value.indexOf("::");
  if (compressedAt >= 0) {
    if (value.indexOf("::", compressedAt + 1) >= 0) return null;
    const headText = value.slice(0, compressedAt);
    const tailText = value.slice(compressedAt + 2);
    head = headText ? headText.split(":") : [];
    tail = tailText ? tailText.split(":") : [];
    if (head.length + tail.length > 7) return null;
  } else {
    head = value.split(":");
    tail = [];
    if (head.length !== 8) return null;
  }

  const groups = [...head, ...new Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    const group = groups[index];
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const parsed = Number.parseInt(group, 16);
    bytes[index * 2] = (parsed >> 8) & 0xff;
    bytes[index * 2 + 1] = parsed & 0xff;
  }
  return bytes;
}

function withinRange(address: Uint8Array, range: AddressRange): boolean {
  if (address.length !== range.bytes.length) return false;

  let remaining = range.prefixBits;
  for (let index = 0; index < address.length && remaining > 0; index += 1) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((address[index] & mask) !== (range.bytes[index] & mask)) return false;
    remaining -= take;
  }
  return true;
}

export type AddressVerdict =
  | { kind: "public" }
  | { kind: "blocked"; label: string; reason: string }
  /** Not an address this deployment can read. Fails closed — see the caller. */
  | { kind: "unparsed" };

/**
 * Whether one resolved address may be connected to.
 *
 * An IPv4-mapped address is reported against `::ffff:0:0/96` AND has its
 * embedded IPv4 checked, so the refusal names the real destination
 * (`169.254.169.254`) rather than the hex the URL parser left behind.
 */
export function classifyAddress(address: string): AddressVerdict {
  const asV4 = parseIpv4(address);
  if (asV4) {
    const hit = IPV4_BLOCKED.find((range) => withinRange(asV4, range));
    return hit ? { kind: "blocked", label: hit.label, reason: hit.reason } : { kind: "public" };
  }

  const asV6 = parseIpv6(address);
  if (!asV6) return { kind: "unparsed" };

  const hit = IPV6_BLOCKED.find((range) => withinRange(asV6, range));
  if (!hit) return { kind: "public" };

  const embedded = embeddedIpv4(asV6);
  if (embedded) {
    const embeddedHit = IPV4_BLOCKED.find((range) => withinRange(embedded.bytes, range));
    return {
      kind: "blocked",
      label: hit.label,
      reason: embeddedHit
        ? `${hit.reason} — ${embedded.text} is ${embeddedHit.reason} (${embeddedHit.label})`
        : `${hit.reason} — ${embedded.text}`,
    };
  }

  return { kind: "blocked", label: hit.label, reason: hit.reason };
}

/** The IPv4 hiding in an IPv4-mapped or NAT64 address, for the refusal text. */
function embeddedIpv4(address: Uint8Array): { bytes: Uint8Array; text: string } | null {
  const mapped = IPV6_BLOCKED.find(
    (range) => (range.label === "::ffff:0:0/96" || range.label === "64:ff9b::/96") && withinRange(address, range),
  );
  if (!mapped) return null;
  const bytes = address.slice(12, 16);
  return { bytes, text: Array.from(bytes).join(".") };
}

/** The operator allowlist, or null when none is configured (the default). */
export function resolveOutboundAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env[OUTBOUND_ALLOWED_HOSTS_ENV]?.trim();
  if (!raw) return null;

  const hosts = raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return hosts.length > 0 ? hosts : null;
}

/**
 * Whether a host is on the allowlist. An entry starting with `.` matches that
 * domain and everything under it, because a transit agency serving its feed from
 * `gtfs.` of its own domain should not need a second entry.
 */
export function hostIsAllowlisted(host: string, allowed: string[]): boolean {
  const needle = host.toLowerCase();
  return allowed.some((entry) => {
    if (entry.startsWith(".")) {
      return needle === entry.slice(1) || needle.endsWith(entry);
    }
    return needle === entry;
  });
}

/** `[::1]` → `::1`. WHATWG `URL` keeps the brackets; a resolver will not take them. */
function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Injected in tests. Matches the shape of `dns.promises.lookup(host, { all: true })`. */
export type OutboundDnsLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

export type OutboundUrlOptions = {
  env?: NodeJS.ProcessEnv;
  lookup?: OutboundDnsLookup;
};

const defaultLookup: OutboundDnsLookup = (host) => dnsPromises.lookup(host, { all: true });

/**
 * The one check every outbound fetch of a member-supplied address goes through.
 *
 * Returns an outcome rather than throwing, matching `body-limit.ts` next door:
 * a route needs the refusal as a value it can turn into a status and an audit
 * code, and an exception thrown through a fetch path tends to get logged as
 * "something went wrong".
 */
export async function assertPublicHttpUrl(
  raw: string,
  options: OutboundUrlOptions = {},
): Promise<OutboundUrlOutcome> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      code: "malformed",
      detail: "That is not a web address. A feed address starts with https:// and names a host.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      code: "bad_scheme",
      detail: `Only https:// addresses can be fetched. This one uses ${url.protocol}//.`,
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      code: "has_credentials",
      detail:
        "That address carries a username and password in it. Remove them — a credential in a URL is stored and logged wherever the address goes.",
    };
  }

  if (url.port && url.port !== "443") {
    return {
      ok: false,
      code: "bad_port",
      detail: `Only the standard https port is fetched. This address asks for port ${url.port}.`,
    };
  }

  const host = bareHost(url.hostname);
  if (!host) {
    return { ok: false, code: "malformed", detail: "That address names no host." };
  }

  const allowed = resolveOutboundAllowedHosts(options.env ?? process.env);
  if (allowed && !hostIsAllowlisted(host, allowed)) {
    return {
      ok: false,
      code: "not_allowlisted",
      detail: `This deployment fetches feeds only from hosts its operator has listed, and ${host} is not one of them.`,
    };
  }

  const literal = classifyLiteralHost(host);
  if (literal) {
    if (literal.kind === "blocked") {
      return {
        ok: false,
        code: "private_address",
        detail: `${host} is ${literal.reason} (${literal.label}). The server will not fetch from inside its own network.`,
      };
    }
    return { ok: true, url, addresses: [host] };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await (options.lookup ?? defaultLookup)(host);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : null;
    return {
      ok: false,
      code: "unresolvable",
      detail: `${host} could not be looked up${code ? ` (${code})` : ""}. Check the address, or the host may be down.`,
    };
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    return { ok: false, code: "unresolvable", detail: `${host} resolved to no addresses.` };
  }

  for (const entry of resolved) {
    const verdict = classifyAddress(entry.address);
    if (verdict.kind === "blocked") {
      return {
        ok: false,
        code: "private_address",
        detail: `${host} resolves to ${entry.address}, which is ${verdict.reason} (${verdict.label}). The server will not fetch from inside its own network.`,
      };
    }
    if (verdict.kind === "unparsed") {
      // Fails closed. An address this deployment cannot read is not an address
      // it can vouch for, and "I could not tell" must never become "go ahead".
      return {
        ok: false,
        code: "unresolvable",
        detail: `${host} resolved to ${entry.address}, which this deployment could not read as an address.`,
      };
    }
  }

  return { ok: true, url, addresses: resolved.map((entry) => entry.address) };
}

/**
 * An IP typed straight into the address bar needs no resolver — and must not get
 * one. Returns null when the host is a name, so the caller falls through to DNS.
 */
function classifyLiteralHost(host: string): AddressVerdict | null {
  if (!parseIpv4(host) && !parseIpv6(host)) return null;
  return classifyAddress(host);
}

export type OutboundFetchOutcome =
  | {
      ok: true;
      response: Response;
      /** The address the returned response actually came from, after redirects. */
      finalUrl: URL;
      /** Every validated URL that was requested, in order. */
      hops: string[];
    }
  | {
      ok: false;
      code: OutboundUrlRefusalCode | "too_many_redirects" | "network_error";
      detail: string;
      hops: string[];
    };

export type OutboundFetchOptions = OutboundUrlOptions & {
  /** Lowered only. `MAX_OUTBOUND_REDIRECTS` is a ceiling, not a default to raise. */
  maxRedirects?: number;
  /** Injected in tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Headers that must not survive a redirect to a different origin. */
const CROSS_ORIGIN_STRIPPED_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/**
 * Fetch a member-supplied address, validating every hop.
 *
 * `redirect: "manual"` is the whole point. The platform default follows a
 * redirect itself, inside the runtime, with no check and no notification — a
 * public host answering `302 Location: http://169.254.169.254/` gets the
 * metadata service fetched on its behalf and the caller sees a 200. So this
 * follows redirects by hand and runs `assertPublicHttpUrl` on each new address
 * before opening the next connection.
 *
 * NO DEFAULT TIMEOUT, deliberately. A GTFS feed is 94 MiB for one large US
 * agency and 300 KiB for a small one, and a number invented here would either
 * cut off the first or let a stalled connection sit. Pass `init.signal`.
 *
 * ONE LIMIT WORTH KNOWING: a 307/308 redirect re-sends the request body, and a
 * stream body cannot be read twice. Callers sending a body should send bytes,
 * not a stream. GET — the only thing the feed lane does — is unaffected.
 */
export async function fetchPublicUrl(
  raw: string,
  init: RequestInit = {},
  options: OutboundFetchOptions = {},
): Promise<OutboundFetchOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? MAX_OUTBOUND_REDIRECTS, MAX_OUTBOUND_REDIRECTS));

  const hops: string[] = [];
  let target = raw;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers = new Headers(init.headers ?? undefined);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = await assertPublicHttpUrl(target, options);
    if (!checked.ok) {
      return { ok: false, code: checked.code, detail: checked.detail, hops };
    }

    hops.push(checked.url.toString());

    let response: Response;
    try {
      response = await fetchImpl(checked.url, { ...init, method, body, headers, redirect: "manual" });
    } catch (error) {
      return {
        ok: false,
        code: "network_error",
        detail: `The request to ${checked.url.host} failed: ${error instanceof Error ? error.message : "unknown error"}`,
        hops,
      };
    }

    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null;
    if (!location) {
      // Includes a 3xx with no Location, which is the server's answer, not a
      // redirect. The caller sees the status and decides.
      return { ok: true, response, finalUrl: checked.url, hops };
    }

    await discardBody(response);

    let next: URL;
    try {
      next = new URL(location, checked.url);
    } catch {
      return {
        ok: false,
        code: "malformed",
        detail: `${checked.url.host} redirected to an address that is not a URL.`,
        hops,
      };
    }

    if (next.origin !== checked.url.origin) {
      headers = stripCrossOriginHeaders(headers);
    }

    if (response.status !== 307 && response.status !== 308 && method !== "GET" && method !== "HEAD") {
      // RFC 9110 §15.4: 301/302/303 turn the follow-up into a GET.
      method = "GET";
      body = undefined;
    }

    target = next.toString();
  }

  return {
    ok: false,
    code: "too_many_redirects",
    detail: `That address redirected more than ${maxRedirects} times without arriving anywhere.`,
    hops,
  };
}

function stripCrossOriginHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  for (const name of CROSS_ORIGIN_STRIPPED_HEADERS) next.delete(name);
  return next;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release. A redirect body nobody read is not worth a failure.
  }
}
