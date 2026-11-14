import { isIPv4, isIPv6 } from "node:net";
import type { NextRequest } from "next/server";

/**
 * THE ONE PLACE A PUBLIC REQUEST'S CONNECTION IS NAMED FOR ABUSE LIMITS.
 *
 * Every per-connection limit (public comments, supports, photos, survey
 * responses and drafts, update sign-ups) counts against the value this module
 * returns, hashed by `buildPublicSubmissionClientFingerprint`.
 *
 * WHICH HEADER IS BELIEVED. The first of `x-forwarded-for`, `x-real-ip` and
 * `cf-connecting-ip` that is present, and only its leftmost entry. That is the
 * rule the public routes used before this module existed, unchanged. On Vercel
 * the platform overwrites `x-forwarded-for` and `x-real-ip` with the address it
 * received the request from, so a client cannot choose its own value there. A
 * self-hosted installation must put a proxy in front that does the same, or
 * every one of these limits is the client's word.
 *
 * IPv4 IS KEPT AS IT ARRIVED. A dotted address is returned byte for byte, so
 * its hash, and every count stored against it before 2026-11-02, is unchanged.
 * An IPv4-mapped IPv6 address (`::ffff:203.0.113.9`) is the same IPv4 host and
 * is returned as plain IPv4.
 *
 * IPv6 IS GROUPED BY ITS /64. One household or phone normally receives a whole
 * /64 and its devices pick new addresses inside it on their own (privacy
 * extensions, RFC 8981); a script can pick a new one per request. Counting
 * single IPv6 addresses gave such a host an unlimited supply of fresh limits.
 * The key is the first four groups, lowercase, without leading zeros, followed
 * by `::/64`, for example `2001:db8:1:2::/64`. Brackets, a port and a zone id
 * are removed before the address is read.
 *
 * THIS CHANGED THE IPv6 KEY ONCE, on 2026-11-02. Counts already stored against
 * a single IPv6 address no longer match, so each IPv6 connection's limits start
 * again from zero on deploy. They fill again within the limit's own window
 * (10 minutes to a day).
 *
 * Anything that is not an address, and a request with no such header at all,
 * is `unknown`. All of those share one connection's limits, as a missing
 * header always has.
 */
const UNKNOWN_CLIENT_CONNECTION = "unknown";

const CONNECTION_HEADERS = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"] as const;

/** `[addr]`, `[addr]:port`, `a.b.c.d:port`, or the bare text otherwise. */
function stripBracketsAndPort(value: string): string | null {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close === -1) return null;
    const rest = value.slice(close + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return null;
    return value.slice(1, close);
  }
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/);
  return ipv4WithPort ? ipv4WithPort[1] : value;
}

/** Eight 16-bit groups of an address `isIPv6` has already accepted. */
function expandIPv6(address: string): number[] {
  let text = address.toLowerCase();
  // An embedded IPv4 tail (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`) is two groups.
  const tail = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const missing = rest === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((group) => parseInt(group, 16));
}

/**
 * The connection key for one address as a header carried it, or `unknown`.
 * See the module comment for the rules.
 */
export function normalizeClientConnectionAddress(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return UNKNOWN_CLIENT_CONNECTION;
  const unwrapped = stripBracketsAndPort(trimmed);
  if (!unwrapped) return UNKNOWN_CLIENT_CONNECTION;
  if (isIPv4(unwrapped)) return unwrapped;

  // A zone id (`fe80::1%eth0`) names the interface, not the host.
  const address = unwrapped.includes(":") ? unwrapped.split("%")[0] : unwrapped;
  if (!isIPv6(address)) return UNKNOWN_CLIENT_CONNECTION;

  const groups = expandIPv6(address);
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return UNKNOWN_CLIENT_CONNECTION;
  }
  const isIPv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isIPv4Mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** The connection key for a request: the believed header, normalized. */
export function clientConnectionKey(request: Pick<NextRequest, "headers">): string {
  for (const header of CONNECTION_HEADERS) {
    const value = request.headers.get(header);
    if (value) return normalizeClientConnectionAddress(value.split(",")[0]);
  }
  return UNKNOWN_CLIENT_CONNECTION;
}
