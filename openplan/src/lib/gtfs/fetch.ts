/**
 * FETCHING BYTES FOR THE GTFS LANE — A FEED ARCHIVE, OR THE FEED CATALOG.
 *
 * THE ONE THING THIS MODULE EXISTS TO GUARANTEE. A GTFS feed URL is the first
 * address in OpenPlan that a *member of a workspace types* and the *server*
 * then fetches. `src/lib/http/outbound-url.ts` is the shared answer to what that
 * means for security, and everything here goes through it — there is no bare
 * `fetch()` in this file and there must never be one. What this module adds on
 * top of that check is the two bounds a public feed URL still needs after it has
 * been proven to point somewhere public: a SIZE bound and a TIME bound.
 *
 * WHY THE SIZE BOUND HAS TO BE A COUNTER AND CANNOT BE A PRE-FLIGHT.
 *
 * The obvious implementation — HEAD the URL, read `Content-Length`, refuse if it
 * is too big — does not work and is worse than nothing, because it reads as a
 * defence while defending nothing:
 *
 *   - the MobilityData mirror answers a plain GET with no `Content-Length` a
 *     caller can rely on, and ignores `Range` (verified 2026-08-05 against the
 *     real mirror), so there is frequently no number to read;
 *   - a `Content-Length` is a CLAIM BY THE SERVER. A host that wants to exhaust
 *     this deployment simply states 1 MB and sends 40 GB;
 *   - a chunked response has no length at all, by definition.
 *
 * So the only defence that is actually a defence is a byte counter over the
 * response stream that CANCELS THE READER the moment the cap is passed. That is
 * what `readCappedBody` does, and the difference between "abort mid-stream" and
 * "buffer then check" is the entire point: the second one has already taken the
 * 40 GB by the time it forms an opinion about it. `zip.ts` makes the same
 * argument one layer down about a member's declared uncompressed size — a
 * declared size may only ever REJECT, never ADMIT — and this is that rule applied
 * to the wire.
 *
 * WHY THERE ARE TWO CLOCKS.
 *
 * A cooperative deadline checked between chunks bounds a stream that is ALIVE
 * but slow — a host trickling one byte a second, which no abort signal on the
 * request will ever fire for because the request is progressing. An
 * `AbortController` armed with a real timer bounds a stream that is DEAD — a
 * socket that opened and then stopped answering, where the cooperative check
 * never runs again because `read()` never resolves. Neither one covers the
 * other's case, which is why both are here.
 *
 * The cooperative clock is INJECTABLE (`now`) precisely so a test can prove the
 * timeout without spending it. A test that has to wait out a real deadline gets
 * shortened by whoever is in a hurry, and then the deadline is untested.
 *
 * NOTHING HERE THROWS FOR SOMETHING A FEED URL DID. Every failure comes back as
 * a value carrying one of the closed `GtfsFailureCode`s, for the same reason
 * `parse.ts` states at its head: an exception escaping into a route becomes a
 * 500 with no explanation, and the person on the other end is a planner who was
 * told their agency's data does not work and given nothing to act on.
 */

import { createHash } from "node:crypto";

import {
  fetchPublicUrl,
  parseIpv4,
  parseIpv6,
  type OutboundDnsLookup,
  type OutboundUrlRefusalCode,
} from "@/lib/http/outbound-url";

import { resolveGtfsLimits, type GtfsLimitEnv } from "./limits";
import type { GtfsFailureCode } from "./types";

/**
 * The subset of the closed failure vocabulary this lane can produce.
 *
 * Declared the same way `GTFS_PARSE_FAILURE_CODES` is declared next door, and
 * for the same reason: the persist and route lanes switch on a status column,
 * and a lane that can quietly widen its own vocabulary is how a column ends up
 * with two spellings of one failure. `satisfies` makes the compiler check the
 * subset relationship, and `gtfs-fetch.test.ts` checks it again at runtime so
 * the guarantee survives someone loosening a type.
 */
export const GTFS_FETCH_FAILURE_CODES = [
  "fetch_failed",
  "fetch_timed_out",
  "host_not_allowed",
  "too_large",
] as const satisfies readonly GtfsFailureCode[];

export type GtfsFetchFailureCode = (typeof GTFS_FETCH_FAILURE_CODES)[number];

/**
 * HOW AN OUTBOUND REFUSAL BECOMES A GTFS FAILURE CODE, as a total map rather
 * than a chain of `if`s.
 *
 * The line drawn here is WHO HAS TO ACT, because that is the only thing a code
 * is for once a planner is reading it:
 *
 *   host_not_allowed - the address is a perfectly good web address and THIS
 *                      DEPLOYMENT will not go there. An operator changed the
 *                      allowlist, or the address resolves inside the network.
 *                      Nobody can fix this by re-typing the URL.
 *   fetch_failed     - the address did not produce a feed. A malformed string,
 *                      an `http://` scheme, a credential in the URL, a host that
 *                      does not resolve: in every one of these the planner edits
 *                      the address and tries again.
 *
 * `Record<OutboundUrlRefusalCode, …>` is deliberate — if the outbound module
 * ever adds a refusal code, this file stops compiling instead of silently
 * falling through to a default that names the wrong person.
 */
const OUTBOUND_REFUSAL_TO_GTFS_CODE: Record<OutboundUrlRefusalCode, GtfsFetchFailureCode> = {
  malformed: "fetch_failed",
  bad_scheme: "fetch_failed",
  has_credentials: "fetch_failed",
  bad_port: "fetch_failed",
  unresolvable: "fetch_failed",
  not_allowlisted: "host_not_allowed",
  private_address: "host_not_allowed",
};

export type GtfsFetchSuccess = {
  ok: true;
  /** The bytes, complete. Under `maxBytes` by construction, never by assertion. */
  bytes: Uint8Array;
  /** Hex sha256 of exactly those bytes, computed as they streamed past. */
  checksumSha256: string;
  /** Where the bytes actually came from, after every validated redirect hop. */
  finalUrl: string;
  /** Every validated address that was requested, in order. Provenance for a UI. */
  hops: string[];
  httpStatus: number;
  contentType: string | null;
  elapsedMs: number;
};

export type GtfsFetchFailure = {
  ok: false;
  code: GtfsFetchFailureCode;
  /**
   * One sentence a planner can act on. Safe to display verbatim.
   *
   * NO RESOLVED ADDRESS EVER APPEARS HERE — see `redactResolvedAddresses`. A
   * refusal sentence naming what a host resolved to turns the feed-URL field
   * into a DNS-mapping oracle for anyone with a workspace login.
   */
  detail: string;
  /**
   * The same refusal with the address left in, for the deployment's own logs.
   *
   * PRESENT ONLY WHEN SOMETHING WAS ACTUALLY WITHHELD, so its presence is the
   * signal that there is more to see. A route may record this; a route must
   * never render it to a member. If it is absent, `detail` is the whole story.
   */
  diagnostic?: string;
  /** The hops that were attempted before the refusal. Empty when none were. */
  hops: string[];
};

export type GtfsFetchOutcome = GtfsFetchSuccess | GtfsFetchFailure;

/**
 * Everything a capped fetch needs, with every seam a test drives injected.
 *
 * `now` and `fetchImpl` and `lookup` are here so that `gtfs-fetch.test.ts` needs
 * no network and no wall-clock patience. They default to the real thing, so a
 * route passes none of them.
 */
export type CappedFetchOptions = {
  /** Hard ceiling. The reader cancels the response the moment this is passed. */
  maxBytes: number;
  /** Wall-clock budget for the whole fetch, connection and body together. */
  timeoutMs: number;
  /**
   * What the thing being downloaded is called in a refusal sentence — "feed",
   * "feed catalog". A noun, not a sentence, so the wording stays consistent.
   */
  subjectLabel: string;
  /** Injectable clock, in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Injected in tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected in tests. Defaults to the platform resolver. */
  lookup?: OutboundDnsLookup;
  /** Read for the outbound host allowlist. Defaults to `process.env`. */
  env?: GtfsLimitEnv;
};

/** What a caller of the GTFS-specific wrappers may set. Bounds come from limits.ts. */
export type GtfsFetchOptions = {
  env?: GtfsLimitEnv;
  now?: () => number;
  fetchImpl?: typeof fetch;
  lookup?: OutboundDnsLookup;
  /**
   * Lowered only, and only by a caller who knows something this module does not
   * — a cron sweep with less budget than an interactive ingest, say. The bound
   * from `limits.ts` is a ceiling; this may not raise it.
   */
  timeoutMs?: number;
};

/**
 * Download one GTFS feed archive.
 *
 * THE TWO BOUNDS BOTH COME FROM `limits.ts` AND NEITHER IS A LITERAL HERE.
 *
 *   size - `GTFS_MAX_ARCHIVE_BYTES`, the same bound `openGtfsZip` refuses an
 *          uploaded archive against. Fetching and uploading must agree, or a
 *          feed is acceptable through one door and not the other and the planner
 *          gets a different answer depending on which button they pressed.
 *   time - `GTFS_PARSE_BUDGET_MS`. That bound is named for the parse and is
 *          reused here on purpose: it is this deployment's stated wall-clock
 *          budget for handling ONE feed inside a serverless function ceiling,
 *          and a download that eats it leaves nothing to parse with. If a
 *          deployment ever needs to bound the fetch separately from the parse,
 *          the new bound belongs in `limits.ts` beside every other one — never
 *          as a number typed into this file.
 */
export async function fetchGtfsFeedBytes(
  url: string,
  options: GtfsFetchOptions = {},
): Promise<GtfsFetchOutcome> {
  const limits = resolveGtfsLimits(options.env);
  return fetchCappedBytes(url, {
    maxBytes: limits.maxArchiveBytes,
    // `Math.min`, not `??`: `GtfsFetchOptions.timeoutMs` is documented as
    // lowered-only, and a caller asking for more than this deployment's budget
    // gets this deployment's budget.
    timeoutMs: Math.min(options.timeoutMs ?? limits.parseBudgetMs, limits.parseBudgetMs),
    subjectLabel: "feed",
    now: options.now,
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    env: options.env,
  });
}

/**
 * Download bytes from a public address, bounded in size and in time.
 *
 * Kept general rather than folded into `fetchGtfsFeedBytes` because the feed
 * catalog needs exactly the same guarantees as a feed archive — an untrusted
 * host, a byte cap, a deadline, an outbound check on every redirect hop. A
 * shared capability that lives inside one of its two callers gets reimplemented
 * by the other one, differently and worse; `catalog.ts` calls this.
 */
export async function fetchCappedBytes(
  url: string,
  rawOptions: CappedFetchOptions,
): Promise<GtfsFetchOutcome> {
  // EVERY DOWNSTREAM READER SEES THE CLAMPED BUDGET, not the requested one, so
  // the deadline that is armed, the deadline that is checked between chunks, and
  // the deadline the refusal sentence names are the same number. A refusal that
  // states a limit must state the limit that was actually applied.
  const options: CappedFetchOptions = {
    ...rawOptions,
    timeoutMs: clampTimerDelay(rawOptions.timeoutMs),
  };

  const now = options.now ?? Date.now;
  const startedAt = now();

  // The DEAD-STREAM clock. A socket that opens and then stops answering never
  // resolves `read()`, so the cooperative check below would never run again;
  // only an abort on the request itself gets control back. `timedOut` is what
  // tells the catch block that the AbortError was ours and not the caller's.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const fetched = await fetchPublicUrl(
      url,
      { method: "GET", signal: controller.signal, redirect: "manual" },
      {
        fetchImpl: options.fetchImpl,
        lookup: options.lookup,
        // `limits.ts` documents why its env type is a loose record rather than
        // `NodeJS.ProcessEnv`; the outbound module predates that and asks for
        // the Next-augmented type. `process.env` satisfies both, and this cast
        // is the one place the two readers are reconciled.
        env: options.env as NodeJS.ProcessEnv | undefined,
      },
    );

    if (!fetched.ok) {
      if (fetched.code === "too_many_redirects") {
        return { ok: false, code: "fetch_failed", detail: fetched.detail, hops: fetched.hops };
      }
      if (fetched.code === "network_error") {
        // An abort we armed arrives here as a network error, because that is
        // what a cancelled request looks like from inside `fetch`. Reporting it
        // as `fetch_failed` would tell a planner their agency's server is down
        // when in fact this deployment gave up waiting.
        if (timedOut) {
          return {
            ok: false,
            code: "fetch_timed_out",
            detail: timeoutDetail(options),
            hops: fetched.hops,
          };
        }
        return { ok: false, code: "fetch_failed", detail: fetched.detail, hops: fetched.hops };
      }
      return {
        ok: false,
        code: OUTBOUND_REFUSAL_TO_GTFS_CODE[fetched.code],
        ...outboundRefusalDetail(
          fetched.code,
          fetched.detail,
          url,
          fetched.hops,
          options.subjectLabel,
        ),
        hops: fetched.hops,
      };
    }

    const { response, finalUrl, hops } = fetched;

    if (!response.ok) {
      await discard(response);
      return {
        ok: false,
        code: "fetch_failed",
        detail:
          `${finalUrl.host} answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""} ` +
          `for that ${options.subjectLabel}. The address may have moved, or the host may be having trouble.`,
        hops,
      };
    }

    const body = await readCappedBody(response, options, now, startedAt, () => timedOut);
    if (!body.ok) {
      return { ...body, hops };
    }

    return {
      ok: true,
      bytes: body.bytes,
      checksumSha256: body.checksumSha256,
      finalUrl: finalUrl.toString(),
      hops,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      elapsedMs: now() - startedAt,
    };
  } finally {
    // Always. A pending timer holds the event loop open, which in a test run
    // shows up as a suite that will not exit and in a serverless function as
    // billed time after the answer was already sent.
    clearTimeout(timer);
  }
}

/**
 * THE LARGEST DELAY `setTimeout` ACTUALLY HONOURS.
 *
 * Node stores a timer's delay in a signed 32-bit integer. Handing it anything
 * larger does not extend the timer — it OVERFLOWS AND FIRES AFTER 1 ms, with a
 * runtime warning nobody reads in production. An operator who sets
 * `OPENPLAN_GTFS_PARSE_BUDGET_MS` to a day's worth of milliseconds because they
 * self-host a worker with no function ceiling would therefore make EVERY fetch
 * abort instantly, and this module would report their agency's server as too
 * slow. A generous bound must never invert into the tightest one there is.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * A wall-clock budget an armed timer will honour, and that a sentence can name.
 *
 * The floor is 1 ms rather than 0 because a non-positive delay fires on the next
 * tick — a caller passing 0 or a negative number gets the tightest possible
 * deadline rather than none at all, which is the direction a bound must fail in.
 * A non-finite value falls back to the ceiling: `limits.ts` never produces one,
 * and `fetchCappedBytes` is exported for callers that are not `limits.ts`.
 */
function clampTimerDelay(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return MAX_TIMER_DELAY_MS;
  return Math.min(Math.max(Math.trunc(timeoutMs), 1), MAX_TIMER_DELAY_MS);
}

/**
 * THE TWO OUTBOUND REFUSALS WHOSE SENTENCE CAN QUOTE THE RESOLVER.
 *
 * Everything else `assertPublicHttpUrl` refuses for — a string that is not a
 * URL, a wrong scheme, a credential, a port, a host an operator did not list —
 * is derived from the address TEXT the member already has in front of them, so
 * those sentences pass through untouched. These two are the ones that ran a
 * lookup and then said what came back.
 */
const OUTBOUND_REFUSALS_THAT_MAY_QUOTE_THE_RESOLVER: ReadonlySet<OutboundUrlRefusalCode> = new Set([
  "private_address",
  "unresolvable",
]);

/**
 * A PLANNER-SAFE REFUSAL FOR AN ADDRESS THIS DEPLOYMENT LOOKED UP.
 *
 * THE PROBLEM. `outbound-url.ts` refuses correctly and explains itself well —
 * "`feeds.example.org` resolves to 10.0.0.5, which is private network
 * (10.0.0.0/8)". That sentence is exactly right for an operator reading a log
 * and exactly wrong on a planner's screen, because the feed-URL field is
 * MEMBER-SUPPLIED: anyone with a workspace login can type a hostname they
 * control, point it wherever they like, and read this deployment's resolver
 * answer back out of the refusal — one lookup at a time, until they have mapped
 * the internal network. That is worth more to an attacker than the SSRF the
 * guard just stopped, and it is assembled entirely out of an honest error
 * message. The outbound module is right to say it; this module is the one
 * handing a sentence to a person, so this is where it stops.
 *
 * WHY THE SENTENCE IS REPLACED RATHER THAN EDITED. The first version of this
 * scanned the refusal for address-shaped tokens and swapped them out. It looked
 * neater and it leaked twice in its first run: `::ffff:169.254.169.254` was
 * missed because the token does not begin with a hex digit, and a resolver
 * answer that is not a parseable address at all — `10.0.0.5%eth0`, which
 * `parseIpv4` and `parseIpv6` both reject — went through verbatim with an
 * internal address inside it. A guard that has to recognise every form an
 * address can take is a guard that will keep missing one. Selecting by REFUSAL
 * CODE cannot miss a form, because it never looks at the text.
 *
 * WHAT SURVIVES. The host the MEMBER TYPED, because they wrote it and a refusal
 * that does not name what was refused is one nobody can act on; and the action
 * they should take. What is lost is the resolver's own words, which is the
 * point. The untouched sentence comes back as `diagnostic` for the deployment's
 * logs.
 *
 * ONE PASS-THROUGH, DELIBERATELY: a member who typed a LITERAL IP had no lookup
 * run on their behalf at all (`classifyLiteralHost` short-circuits before the
 * resolver), so the address in that refusal is the one they typed, and echoing
 * it back tells them nothing they did not already know.
 */
function outboundRefusalDetail(
  code: OutboundUrlRefusalCode,
  outboundDetail: string,
  requestedUrl: string,
  hops: string[],
  subjectLabel: string,
): { detail: string; diagnostic?: string } {
  if (!OUTBOUND_REFUSALS_THAT_MAY_QUOTE_THE_RESOLVER.has(code)) return { detail: outboundDetail };

  // `hops` holds only addresses that already PASSED the check, so an empty list
  // means the refusal is about the address the member typed and a non-empty one
  // means it is about somewhere a redirect tried to send us.
  const redirected = hops.length > 0;
  const typedHost = memberTypedHost(requestedUrl);

  if (!redirected && typedHost && isAddressLiteral(typedHost)) return { detail: outboundDetail };

  if (code === "private_address") {
    return {
      detail: redirected
        ? `That ${subjectLabel} address redirected to a host that leads inside this deployment's own network, ` +
          `and the server stopped rather than following it.`
        : `${typedHost ?? "That address"} leads inside this deployment's own network, and the server will not ` +
          `fetch from inside its own network. If this is your agency's public ${subjectLabel} address, check it ` +
          `with whoever runs your network.`,
      diagnostic: outboundDetail,
    };
  }

  return {
    detail: redirected
      ? `That ${subjectLabel} address redirected to a host that could not be looked up. Check the address, or ` +
        `the host may be down.`
      : `${typedHost ?? "That address"} could not be looked up, or it answered with something this deployment ` +
        `could not read as an address. Check the address, or the host may be down.`,
    diagnostic: outboundDetail,
  };
}

/**
 * The host as the member wrote it, lowercased, or null when the string is not a
 * URL at all — in which case there is no host of theirs to name.
 */
function memberTypedHost(requestedUrl: string): string | null {
  try {
    const hostname = new URL(requestedUrl).hostname;
    const bare =
      hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
    return bare.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Whether a host is an IP typed straight in, rather than a name to be resolved. */
function isAddressLiteral(host: string): boolean {
  return parseIpv4(host) !== null || parseIpv6(host) !== null;
}

function timeoutDetail(options: CappedFetchOptions): string {
  return (
    `That ${options.subjectLabel} did not finish downloading within ` +
    `${Math.round(options.timeoutMs / 1000).toLocaleString("en-US")} seconds. ` +
    `Whoever operates this deployment can raise the limit.`
  );
}

/**
 * Read a response body, counting bytes and hashing them as they go.
 *
 * THREE THINGS HAPPEN IN ONE PASS, and that is the reason this is written by
 * hand instead of `await response.arrayBuffer()`:
 *
 *   1. the byte counter can CANCEL the reader the instant the cap is passed, so
 *      an oversized body is refused after `maxBytes + one chunk` rather than
 *      after all of it;
 *   2. the sha256 is fed chunk by chunk, so the bytes are hashed exactly once
 *      and are never walked a second time to produce the checksum the version
 *      row stores;
 *   3. the cooperative deadline gets a look between chunks, which is the only
 *      thing that stops a host trickling bytes for an hour.
 */
async function readCappedBody(
  response: Response,
  options: CappedFetchOptions,
  now: () => number,
  startedAt: number,
  armedTimeoutFired: () => boolean,
): Promise<{ ok: true; bytes: Uint8Array; checksumSha256: string } | GtfsFetchFailure> {
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let total = 0;

  const reader = response.body?.getReader();
  if (!reader) return emptyBodyRefusal(options);

  try {
    for (;;) {
      if (now() - startedAt > options.timeoutMs) {
        await cancel(reader);
        return { ok: false, code: "fetch_timed_out", detail: timeoutDetail(options), hops: [] };
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > options.maxBytes) {
        await cancel(reader);
        return {
          ok: false,
          code: "too_large",
          detail:
            `That ${options.subjectLabel} is larger than the ` +
            `${options.maxBytes.toLocaleString("en-US")} bytes this deployment accepts, and the download was ` +
            `stopped part-way. Whoever operates this deployment can raise the limit.`,
          hops: [],
        };
      }

      hash.update(value);
      chunks.push(value);
    }
  } catch (error) {
    // An abort we armed lands here; so does a connection dropped mid-body. They
    // are different things to a planner and must not share a code.
    return {
      ok: false,
      code: armedTimeoutFired() ? "fetch_timed_out" : "fetch_failed",
      detail: armedTimeoutFired()
        ? timeoutDetail(options)
        : `The ${options.subjectLabel} download stopped part-way: ${error instanceof Error ? error.message : "unknown error"}.`,
      hops: [],
    };
  }

  if (total === 0) return emptyBodyRefusal(options);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes, checksumSha256: hash.digest("hex") };
}

/**
 * A 2xx THAT CARRIED NO BYTES IS A FAILURE, NOT A ZERO-BYTE DOWNLOAD.
 *
 * This branch used to succeed, on the reasoning that a body-less 200 is legal
 * HTTP and not this module's to judge. That reasoning was wrong in one specific
 * and damaging way: `createHash("sha256").digest("hex")` over nothing is
 * `e3b0c442…`, the well-known digest of the empty string, and the success shape
 * has nowhere to say "of nothing". So the version row would have recorded a real
 * checksum, a real `finalUrl` and a real elapsed time for a feed that was never
 * sent — and two agencies whose servers both answered 204 would have recorded
 * the SAME checksum, which is the one thing a checksum exists to make impossible.
 * A digest presented as the fingerprint of an agency's data must be the
 * fingerprint of some data.
 *
 * `fetch_failed` is the right code by the map at the head of this file: the
 * address answered but did not produce a feed, and the planner's next move is to
 * check the address — which is also what a 204 or an empty 200 usually means in
 * practice (a mirror that has the entry but not the file yet).
 */
function emptyBodyRefusal(options: CappedFetchOptions): GtfsFetchFailure {
  return {
    ok: false,
    code: "fetch_failed",
    detail:
      `That address answered, but sent no ${options.subjectLabel} at all — the response was empty. ` +
      `The address may point at a placeholder, or the file may not have been published yet.`,
    hops: [],
  };
}

async function cancel(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stream is already gone. Nothing here is worth turning into a failure
    // the planner has to read — the refusal that caused the cancel is.
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Same reasoning as `cancel` above.
  }
}
