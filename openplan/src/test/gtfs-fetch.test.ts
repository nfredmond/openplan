import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  fetchCappedBytes,
  fetchGtfsFeedBytes,
  GTFS_FETCH_FAILURE_CODES,
  type CappedFetchOptions,
} from "@/lib/gtfs/fetch";
import { GTFS_FAILURE_CODES } from "@/lib/gtfs/types";
import {
  GTFS_MAX_ARCHIVE_BYTES,
  GTFS_PARSE_BUDGET_MS,
  resolveGtfsLimits,
} from "@/lib/gtfs/limits";
import { OUTBOUND_ALLOWED_HOSTS_ENV, type OutboundDnsLookup } from "@/lib/http/outbound-url";

/**
 * DOWNLOADING A FEED, OFFLINE.
 *
 * Nothing here touches the network and nothing here waits out a real deadline.
 * The seams are the injected ones the module documents — `fetchImpl`, `lookup`,
 * `now` — and every failure is asserted as a VALUE, because a feed problem that
 * arrives as an exception is a 500 with no explanation for the planner.
 *
 * THE CASE THAT MATTERS MOST IS "aborts mid-stream". A byte cap that checks the
 * size after buffering the body has already taken the bytes it was defending
 * against, so the test counts how many chunks the PRODUCER was asked for. If the
 * refusal ever moves after the loop, the producer runs to completion and that
 * count gives it away.
 */

const PUBLIC_DNS: OutboundDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const FEED_URL = "https://mirror.example.org/feed.zip";

/** Everything but the thing each test varies. Passing `env: {}` keeps the
 * machine's own OPENPLAN_* variables out of what these tests mean. */
function baseOptions(overrides: Partial<CappedFetchOptions> = {}): CappedFetchOptions {
  return {
    maxBytes: 1_000_000,
    timeoutMs: 30_000,
    subjectLabel: "feed",
    lookup: PUBLIC_DNS,
    env: {},
    ...overrides,
  };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A fetch that answers with the given bytes in one chunk. */
function serving(body: Uint8Array | string, init: ResponseInit = {}): typeof fetch {
  return (async () => new Response(body as BodyInit, { status: 200, ...init })) as typeof fetch;
}

/**
 * A fetch whose body is produced lazily, one chunk at a time, counting how many
 * chunks the consumer actually pulled. This is the instrument the byte-cap test
 * reads.
 */
function chunkedSource(chunkCount: number, chunkBytes: number) {
  const state = { produced: 0 };
  const impl = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (state.produced >= chunkCount) {
            controller.close();
            return;
          }
          state.produced += 1;
          controller.enqueue(new Uint8Array(chunkBytes).fill(65));
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  return { impl, state };
}

/* -------------------------------------------------------------------------- */

describe("the happy path", () => {
  it("returns the bytes, where they came from, and the checksum of exactly those bytes", async () => {
    const body = "PK a small archive";
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ fetchImpl: serving(body, { headers: { "content-type": "application/zip" } }) }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(new TextDecoder().decode(outcome.bytes)).toBe(body);
    expect(outcome.checksumSha256).toBe(createHash("sha256").update(bytesOf(body)).digest("hex"));
    expect(outcome.finalUrl).toBe(FEED_URL);
    expect(outcome.hops).toEqual([FEED_URL]);
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.contentType).toBe("application/zip");
  });

  it("checksums a multi-chunk body as one stream, not chunk by chunk", async () => {
    const chunks = ["first-", "second-", "third"];
    const impl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(bytesOf(chunk));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    const outcome = await fetchCappedBytes(FEED_URL, baseOptions({ fetchImpl: impl }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.checksumSha256).toBe(
      createHash("sha256").update(bytesOf(chunks.join(""))).digest("hex"),
    );
    expect(new TextDecoder().decode(outcome.bytes)).toBe(chunks.join(""));
  });

  it("reports how long it took, from the injected clock and not the wall", async () => {
    // The elapsed time reaches a version row and an operator's log. A field
    // computed from the real clock while every other seam is injected is a field
    // nothing can assert, so it goes untested and then goes wrong quietly.
    const readings = [1_000, 1_400];
    let index = 0;
    const now = () => readings[Math.min(index++, readings.length - 1)];

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ now, fetchImpl: serving("PK bytes") }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.elapsedMs).toBe(400);
  });
});

/**
 * A 2XX THAT CARRIED NO BYTES IS A FAILURE, NOT A ZERO-BYTE DOWNLOAD.
 *
 * This used to succeed, on the reasoning that a body-less 200 is legal HTTP and
 * not this module's to judge. That reasoning was wrong in one specific and
 * damaging way, which is why the case is now its own block: the success shape
 * has nowhere to say "of nothing", so it reported
 * `e3b0c442…` — the well-known sha256 of the empty string — as the checksum of
 * the agency's feed. Two agencies whose servers both answered 204 would have
 * recorded the SAME checksum, which is the one thing a checksum exists to make
 * impossible, and a refresh comparing digests would have called them unchanged.
 */
describe("an answer with no bytes in it", () => {
  it("refuses a 204 rather than recording the digest of nothing", async () => {
    const impl = (async () => new Response(null, { status: 204 })) as typeof fetch;

    const outcome = await fetchCappedBytes(FEED_URL, baseOptions({ fetchImpl: impl }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_failed");
    expect(outcome.detail).toContain("no feed");
    // The digest of the empty string must not appear anywhere in the answer.
    expect(JSON.stringify(outcome)).not.toContain(createHash("sha256").digest("hex"));
  });

  it("refuses a 200 whose body streams zero bytes, not only one with no body", async () => {
    // The same fact arriving through the other door. A stream that opens and
    // closes without enqueuing anything reaches a different branch from
    // `response.body === null`, and only one of the two was ever guarded.
    const impl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(0));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    const outcome = await fetchCappedBytes(FEED_URL, baseOptions({ fetchImpl: impl }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_failed");
  });

  it("names what was being downloaded, so the catalog and a feed do not share a sentence", async () => {
    const impl = (async () => new Response(null, { status: 200 })) as typeof fetch;

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ subjectLabel: "feed catalog", fetchImpl: impl }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toContain("no feed catalog");
  });
});

describe("the byte cap is a counter, and it stops the download part-way", () => {
  it("refuses an oversized body WITHOUT letting the producer finish", async () => {
    const source = chunkedSource(200, 1_000);

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ maxBytes: 5_000, fetchImpl: source.impl }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("too_large");
    // THE ASSERTION THE WHOLE DESIGN RESTS ON. 200 chunks were available; the
    // cap is six of them. A reader that buffered first and checked afterwards
    // would have pulled all 200.
    expect(source.state.produced).toBeLessThan(20);
    expect(source.state.produced).toBeGreaterThan(0);
  });

  it("says the size, so an operator knows what to raise", async () => {
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ maxBytes: 10, fetchImpl: serving("more than ten bytes") }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toContain("10");
    expect(outcome.detail).toContain("stopped part-way");
  });

  it("accepts a body of exactly the cap", async () => {
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ maxBytes: 5, fetchImpl: serving("12345") }),
    );

    expect(outcome.ok).toBe(true);
  });

  /**
   * ONE CONFIGURED VALUE CANNOT TELL A BINDING FROM A HARDCODE.
   *
   * This case used to drive a single cap of 8 and assert that a nine-byte body
   * was refused and an eight-byte one accepted. Both assertions hold with
   * `maxBytes: limits.maxArchiveBytes` replaced by the literal `8` — the fixture
   * describes the one value it configured, so it proves the number and not the
   * WIRE. Measured: 65 of 65 tests stayed green under exactly that mutation.
   *
   * TWO VALUES IN ONE TEST IS THE FIX. The same nine-byte body must be refused
   * at 8 and accepted at 12, and no literal satisfies both branches.
   */
  it("takes the feed cap from limits.ts, at two different values, so no literal can stand in", async () => {
    const nineBytes = "nine byte";
    const capOf = (bytes: string) =>
      fetchGtfsFeedBytes(FEED_URL, {
        env: { [GTFS_MAX_ARCHIVE_BYTES.env]: bytes },
        lookup: PUBLIC_DNS,
        fetchImpl: serving(nineBytes),
      });

    const refusedAtEight = await capOf("8");
    const acceptedAtTwelve = await capOf("12");

    expect(refusedAtEight.ok).toBe(false);
    if (!refusedAtEight.ok) {
      expect(refusedAtEight.code).toBe("too_large");
      // The sentence names the cap that was applied, which is the second half of
      // the binding: a hardcoded 8 would say "8" under both environments.
      expect(refusedAtEight.detail).toContain("8 bytes");
    }
    expect(acceptedAtTwelve.ok).toBe(true);

    // A third value, from the other direction: nine bytes refused again once the
    // cap drops below it, so "accepted at 12" is not simply "accepts anything".
    const refusedAtOne = await capOf("1");
    expect(refusedAtOne.ok).toBe(false);

    // The bound really is the one the rest of the GTFS lane refuses uploads
    // against — a fetch and an upload must not disagree about what fits.
    expect(resolveGtfsLimits({ [GTFS_MAX_ARCHIVE_BYTES.env]: "12" }).maxArchiveBytes).toBe(12);
  });
});

describe("the two clocks", () => {
  it("gives up on a stream that is alive but slow, without waiting for it", async () => {
    const source = chunkedSource(50, 100);
    // A clock that jumps a minute every time it is read. No real time passes and
    // the deadline is still exceeded exactly as it would be in production.
    let tick = 0;
    const now = () => {
      tick += 60_000;
      return tick;
    };

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ timeoutMs: 30_000, now, fetchImpl: source.impl }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_timed_out");
    expect(outcome.detail).toContain("30 seconds");
    expect(source.state.produced).toBeLessThan(50);
  });

  it("gives up on a connection that never answers", async () => {
    const neverAnswers = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as typeof fetch;

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ timeoutMs: 20, fetchImpl: neverAnswers }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // A request WE cancelled must not be reported as the agency's server being
    // down. The planner's next move is different in each case.
    expect(outcome.code).toBe("fetch_timed_out");
  });

  it("gives up on a body that stops part-way through", async () => {
    const stalls = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytesOf("the first chunk arrived"));
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          });
        },
        pull() {
          return new Promise<void>(() => {});
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ timeoutMs: 20, fetchImpl: stalls }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_timed_out");
  });

  it("takes the feed deadline from limits.ts", async () => {
    const env = { [GTFS_PARSE_BUDGET_MS.env]: "20" };
    const neverAnswers = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as typeof fetch;

    const outcome = await fetchGtfsFeedBytes(FEED_URL, {
      env,
      lookup: PUBLIC_DNS,
      fetchImpl: neverAnswers,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_timed_out");
  });

  /**
   * THE SAME "one value cannot tell a binding from a hardcode" PROBLEM as the
   * byte cap, on the clock. The case above drives ONE budget and asserts only
   * the code, so `timeoutMs: 20` written as a literal passes it.
   *
   * Two budgets, and the assertion is the sentence, which names the number that
   * was applied. The jumping clock is what makes this cost no real time: it
   * advances a minute per reading, so both budgets are exceeded on the first
   * cooperative check and neither test waits for anything.
   */
  it("takes the feed deadline from limits.ts, at two different values", async () => {
    const jumpingClock = () => {
      let tick = 0;
      return () => {
        tick += 60_000;
        return tick;
      };
    };
    const budgetOf = (ms: string) =>
      fetchGtfsFeedBytes(FEED_URL, {
        env: { [GTFS_PARSE_BUDGET_MS.env]: ms },
        lookup: PUBLIC_DNS,
        now: jumpingClock(),
        fetchImpl: chunkedSource(50, 100).impl,
      });

    const short = await budgetOf("20000");
    const long = await budgetOf("45000");

    expect(short.ok).toBe(false);
    expect(long.ok).toBe(false);
    if (short.ok || long.ok) return;
    expect(short.code).toBe("fetch_timed_out");
    expect(long.code).toBe("fetch_timed_out");
    expect(short.detail).toContain("20 seconds");
    expect(long.detail).toContain("45 seconds");
  });

  /**
   * `GtfsFetchOptions.timeoutMs` IS DOCUMENTED AS LOWERED-ONLY, and the
   * `Math.min` that enforces it had no test at all — nothing in this file ever
   * passed `timeoutMs`, so deleting the clamp changed nothing anywhere.
   */
  it("lets a caller lower the deadline but never raise it", async () => {
    const request = (timeoutMs: number) =>
      fetchGtfsFeedBytes(FEED_URL, {
        env: { [GTFS_PARSE_BUDGET_MS.env]: "30000" },
        lookup: PUBLIC_DNS,
        timeoutMs,
        now: (() => {
          let tick = 0;
          return () => {
            tick += 60_000;
            return tick;
          };
        })(),
        fetchImpl: chunkedSource(50, 100).impl,
      });

    const lowered = await request(5_000);
    const raised = await request(600_000);

    expect(lowered.ok).toBe(false);
    expect(raised.ok).toBe(false);
    if (lowered.ok || raised.ok) return;
    // The caller's smaller number wins…
    expect(lowered.detail).toContain("5 seconds");
    // …and the caller's larger one does not. The deployment's budget stands.
    expect(raised.detail).toContain("30 seconds");
  });

  /**
   * A BUDGET SO LARGE IT INVERTS INTO THE TIGHTEST ONE THERE IS.
   *
   * Node stores a timer delay in a signed 32-bit integer. Anything past
   * 2^31 - 1 ms does not extend the timer — it OVERFLOWS AND FIRES AFTER 1 ms.
   * So an operator self-hosting a worker with no function ceiling, who sets
   * `OPENPLAN_GTFS_PARSE_BUDGET_MS` to a day, would have made every fetch abort
   * instantly and this module would have reported their agency's server as too
   * slow to answer. A generous bound turning into no bound at all is the worst
   * direction a configuration mistake can fail in, because the symptom points
   * away from the cause.
   */
  /**
   * THE INSTRUMENT THIS NEEDS, and the reason it is not `serving(…)`.
   *
   * The first version of the overflow case used the immediate `serving(…)` and
   * SURVIVED its own mutation: with the clamp deleted, `setTimeout` fired after
   * 1 ms exactly as the defect predicts — but the immediate fetch had already
   * resolved in the same microtask drain, so nothing ever aborted and the test
   * passed while proving nothing. A deadline can only be observed by something
   * slow enough for it to beat. This answers after a real (short) delay and
   * rejects when aborted, which is what a stalled host looks like.
   */
  const respondingAfter = (ms: number, body: string): typeof fetch =>
    ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const handle = setTimeout(() => resolve(new Response(body, { status: 200 })), ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(handle);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as typeof fetch;

  it("does not let an enormous operator budget overflow into a 1 ms deadline", async () => {
    const outcome = await fetchGtfsFeedBytes(FEED_URL, {
      // THIRTY DAYS, and the number matters: 2^31 - 1 ms is 24.8 days, so a
      // plausible-looking "a week" is comfortably UNDER the ceiling and proves
      // nothing. The first version of this used a week and survived deleting
      // the clamp for exactly that reason.
      env: { [GTFS_PARSE_BUDGET_MS.env]: String(30 * 24 * 60 * 60 * 1000) },
      lookup: PUBLIC_DNS,
      fetchImpl: respondingAfter(40, "PK a small archive"),
    });

    // UNCLAMPED THIS IS `fetch_timed_out`: the overflowed timer fires at 1 ms and
    // aborts a host that was going to answer in 40. The operator asked for a
    // month and got the tightest deadline there is.
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(new TextDecoder().decode(outcome.bytes)).toBe("PK a small archive");
  });

  /**
   * `fetchCappedBytes` is exported for callers that are not `limits.ts`, whose
   * positive-or-default rule therefore does not reach them.
   *
   * ONE HONEST GAP, STATED RATHER THAN PAPERED OVER: the clamp's LOWER bound of
   * 1 ms cannot be observed through the timer, because Node applies the same
   * floor itself — `setTimeout(fn, 0)` and `setTimeout(fn, -5)` both fire at
   * 1 ms whatever this function returns. What a non-positive budget DOES change
   * observably is the sentence, which divides the budget by 1,000 and would
   * otherwise tell a planner their feed did not arrive within minus five
   * seconds. That is what the last assertion here holds.
   */
  it("clamps a nonsensical budget instead of arming a timer with it", async () => {
    const unbounded = await fetchCappedBytes(
      FEED_URL,
      // Infinity is the overflow by another name; `setTimeout(fn, Infinity)`
      // also collapses to 1 ms.
      baseOptions({ timeoutMs: Number.POSITIVE_INFINITY, fetchImpl: respondingAfter(40, "PK") }),
    );
    const notANumber = await fetchCappedBytes(
      FEED_URL,
      // And NaN, which is what an unparsed operator string becomes on its way
      // through arithmetic. `setTimeout(fn, NaN)` fires at 1 ms too.
      baseOptions({ timeoutMs: Number.NaN, fetchImpl: respondingAfter(40, "PK") }),
    );
    const negative = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ timeoutMs: -5_000, fetchImpl: respondingAfter(40, "PK") }),
    );

    expect(unbounded.ok).toBe(true);
    expect(notANumber.ok).toBe(true);

    // A negative budget is a real deadline, not an absent one…
    expect(negative.ok).toBe(false);
    if (negative.ok) return;
    expect(negative.code).toBe("fetch_timed_out");
    // …and the sentence a planner reads never counts down from a negative.
    expect(negative.detail).not.toMatch(/-\d/);
    expect(negative.detail).toContain("0 seconds");
  });
});

describe("every address goes through the outbound guard", () => {
  it("refuses a host that resolves inside the deployment's own network", async () => {
    const outcome = await fetchCappedBytes(
      "https://feeds.example.org/gtfs.zip",
      baseOptions({
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
        fetchImpl: (() => {
          throw new Error("a private address was fetched");
        }) as unknown as typeof fetch,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("host_not_allowed");
    // What the planner is shown still names the host they typed and what the
    // server did about it — see the block below for what is taken out.
    expect(outcome.detail).toContain("feeds.example.org");
    expect(outcome.detail).toContain("own network");
  });

  it("refuses a private address typed straight in, without asking a resolver", async () => {
    const outcome = await fetchCappedBytes(
      "https://127.0.0.1/gtfs.zip",
      baseOptions({
        lookup: async (host) => {
          throw new Error(`the resolver was called for ${host}`);
        },
        fetchImpl: (() => {
          throw new Error("loopback was fetched");
        }) as unknown as typeof fetch,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("host_not_allowed");
  });

  it("refuses a redirect that lands on a private address", async () => {
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input) === FEED_URL) {
        return new Response(null, { status: 302, headers: { location: "https://10.0.0.5/gtfs.zip" } });
      }
      throw new Error("the redirect target was fetched");
    }) as typeof fetch;

    const outcome = await fetchCappedBytes(FEED_URL, baseOptions({ fetchImpl: impl }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("host_not_allowed");
    expect(outcome.hops).toEqual([FEED_URL]);
  });

  it("refuses a host an operator has not listed, when a list is configured", async () => {
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({
        env: { [OUTBOUND_ALLOWED_HOSTS_ENV]: "feeds.someagency.example.org" },
        fetchImpl: (() => {
          throw new Error("an unlisted host was fetched");
        }) as unknown as typeof fetch,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("host_not_allowed");
  });

  /**
   * The line the code map draws: a refusal an operator caused is
   * `host_not_allowed`, and an address the PLANNER can fix is `fetch_failed`.
   * Reporting a typo'd address as "this deployment will not go there" sends the
   * wrong person looking.
   */
  it("reports a bad address as a fetch failure, not as a host refusal", async () => {
    const cases: Record<string, string> = {};
    for (const raw of [
      "http://mirror.example.org/feed.zip",
      "not a url at all",
      "https://user:secret@mirror.example.org/feed.zip",
      "https://mirror.example.org:8443/feed.zip",
    ]) {
      const outcome = await fetchCappedBytes(
        raw,
        baseOptions({
          fetchImpl: (() => {
            throw new Error(`${raw} was fetched`);
          }) as unknown as typeof fetch,
        }),
      );
      cases[raw] = outcome.ok ? "ACCEPTED" : outcome.code;
    }

    expect(cases).toEqual({
      "http://mirror.example.org/feed.zip": "fetch_failed",
      "not a url at all": "fetch_failed",
      "https://user:secret@mirror.example.org/feed.zip": "fetch_failed",
      "https://mirror.example.org:8443/feed.zip": "fetch_failed",
    });
  });

  it("reports a host that does not resolve as a fetch failure", async () => {
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({
        lookup: async (host) => {
          const error = new Error(`getaddrinfo ENOTFOUND ${host}`) as Error & { code?: string };
          error.code = "ENOTFOUND";
          throw error;
        },
        fetchImpl: (() => {
          throw new Error("an unresolvable host was fetched");
        }) as unknown as typeof fetch,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_failed");
  });
});

/**
 * THE FEED-URL FIELD IS NOT A DNS CONSOLE.
 *
 * `outbound-url.ts` refuses correctly and explains itself well — "feeds.example.
 * org resolves to 10.0.0.5, which is private network (10.0.0.0/8)". That
 * sentence is right for an operator reading a log and wrong on a planner's
 * screen, because the address it names is MEMBER-SUPPLIED: anyone with a
 * workspace login can type a hostname they control and read this deployment's
 * resolver answer back out of the refusal, one lookup at a time. That is a
 * DNS-mapping oracle over the deployment's internal network, assembled out of an
 * honest error message, and it is worth more to an attacker than the SSRF the
 * guard just stopped.
 *
 * The line is drawn HERE rather than in `outbound-url.ts`, because this module is
 * the one handing a sentence to a person.
 */
describe("a refusal never tells a member what this deployment's resolver said", () => {
  const oracleProbe = (address: string) =>
    fetchCappedBytes(
      "https://probe.example.org/gtfs.zip",
      baseOptions({
        lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
        fetchImpl: (() => {
          throw new Error("a refused address was fetched");
        }) as unknown as typeof fetch,
      }),
    );

  it("withholds the resolved IPv4 address and keeps it for the logs instead", async () => {
    const outcome = await oracleProbe("10.11.12.13");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).not.toContain("10.11.12.13");
    expect(outcome.diagnostic).toContain("10.11.12.13");
    // Still actionable: the host the member typed survives, and so does what the
    // server did about it. A refusal nobody can act on is its own defect.
    expect(outcome.detail).toContain("probe.example.org");
    expect(outcome.detail).toContain("own network");
  });

  /**
   * THE FORMS AN ADDRESS CAN TAKE, WHICH IS WHY THIS IS SELECTED BY REFUSAL CODE
   * AND NOT BY SCANNING THE SENTENCE.
   *
   * The first implementation of this scanned for address-shaped tokens and
   * leaked twice on its first run: `::ffff:169.254.169.254` does not begin with
   * a hex digit, so the token never matched; and `10.0.0.5%eth0` is rejected by
   * both `parseIpv4` and `parseIpv6`, so a scanner has no way to know it is an
   * address at all — the guard's own fail-closed branch quotes it verbatim.
   * Every one of these goes through the same code path now, so a form nobody
   * anticipated cannot slip past.
   */
  it.each([
    ["a mapped IPv4-in-IPv6", "::ffff:169.254.169.254", "169.254.169.254"],
    ["a link-local IPv6", "fe80::1", "fe80::1"],
    ["a NAT64-embedded IPv4", "64:ff9b::10.0.0.5", "10.0.0.5"],
    ["a scoped address no parser accepts", "10.0.0.5%eth0", "10.0.0.5"],
    ["an answer that is not an address at all", "not-an-address", "not-an-address"],
  ])("withholds %s", async (_name, resolved, leaked) => {
    const outcome = await oracleProbe(resolved);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).not.toContain(leaked);
    expect(outcome.detail).not.toContain(resolved);
    expect(outcome.diagnostic).toContain(resolved);
    expect(outcome.detail).toContain("probe.example.org");
  });

  it("withholds a redirect target's resolver answer without naming a host at all", async () => {
    // On a redirect hop the failing host is not the one the member typed, so
    // there is no host of theirs to keep — and naming the redirect target would
    // hand back the same mapping by another route.
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input) === FEED_URL) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.example.org/feed.zip" },
        });
      }
      throw new Error("the redirect target was fetched");
    }) as typeof fetch;

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({
        lookup: async (host) =>
          host === "mirror.example.org"
            ? [{ address: "93.184.216.34", family: 4 }]
            : [{ address: "192.168.7.9", family: 4 }],
        fetchImpl: impl,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("host_not_allowed");
    expect(outcome.detail).not.toContain("192.168.7.9");
    expect(outcome.detail).not.toContain("internal.example.org");
    expect(outcome.diagnostic).toContain("192.168.7.9");
    expect(outcome.detail).toContain("redirected");
  });

  it("keeps an address the member typed themselves, which is nothing they can learn from", async () => {
    const outcome = await fetchCappedBytes(
      "https://10.0.0.5/gtfs.zip",
      baseOptions({
        lookup: async (host) => {
          throw new Error(`the resolver was called for ${host}`);
        },
        fetchImpl: (() => {
          throw new Error("a private address was fetched");
        }) as unknown as typeof fetch,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // They wrote it; echoing it back reveals nothing and removing it would leave
    // a refusal that does not say what was refused.
    expect(outcome.detail).toContain("10.0.0.5");
    expect(outcome.diagnostic).toBeUndefined();
  });

  it("sets the diagnostic only when something was actually withheld", async () => {
    // Otherwise its presence stops meaning anything and whoever reads the logs
    // learns to skip it.
    const ordinary = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ fetchImpl: serving("nope", { status: 503 }) }),
    );

    expect(ordinary.ok).toBe(false);
    if (ordinary.ok) return;
    expect(ordinary.diagnostic).toBeUndefined();
    expect(ordinary.detail).toContain("503");
  });
});

describe("what the far end says", () => {
  it("reports a non-2xx answer with its status", async () => {
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ fetchImpl: serving("nope", { status: 404, statusText: "Not Found" }) }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_failed");
    expect(outcome.detail).toContain("404");
    expect(outcome.detail).toContain("mirror.example.org");
  });

  it("reports a connection that fails outright", async () => {
    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({
        fetchImpl: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("fetch_failed");
  });

  it("follows a redirect and reports where the bytes actually came from", async () => {
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input) === FEED_URL) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.org/feed.zip" },
        });
      }
      return new Response("moved bytes", { status: 200 });
    }) as typeof fetch;

    const outcome = await fetchCappedBytes(FEED_URL, baseOptions({ fetchImpl: impl }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.finalUrl).toBe("https://cdn.example.org/feed.zip");
    expect(outcome.hops).toEqual([FEED_URL, "https://cdn.example.org/feed.zip"]);
  });

  /**
   * THE HOPS ON A FAILURE THAT HAPPENED IN THE BODY, WHICH NOTHING EXERCISED.
   *
   * `readCappedBody` cannot know the hops — it is handed a `Response` — so it
   * returns an empty list and `fetchCappedBytes` fills it in on the way out.
   * That hand-off had no test: every hops assertion in this file was on a
   * SUCCESS or on a refusal raised before the body was read. Deleting the
   * spread would have left a size or deadline refusal claiming no address was
   * ever tried, which is exactly the case where an operator needs to know that a
   * redirect took the request somewhere else before it went wrong.
   */
  it("reports where it had been when the failure happened in the body", async () => {
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input) === FEED_URL) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.org/feed.zip" },
        });
      }
      return new Response("far more than four bytes", { status: 200 });
    }) as typeof fetch;

    const outcome = await fetchCappedBytes(
      FEED_URL,
      baseOptions({ maxBytes: 4, fetchImpl: impl }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("too_large");
    expect(outcome.hops).toEqual([FEED_URL, "https://cdn.example.org/feed.zip"]);
  });
});

describe("the failure vocabulary stays closed", () => {
  it("uses only codes the GTFS lane already knows", () => {
    for (const code of GTFS_FETCH_FAILURE_CODES) {
      expect(GTFS_FAILURE_CODES).toContain(code);
    }
    expect([...GTFS_FETCH_FAILURE_CODES].sort()).toEqual([
      "fetch_failed",
      "fetch_timed_out",
      "host_not_allowed",
      "too_large",
    ]);
  });
});
