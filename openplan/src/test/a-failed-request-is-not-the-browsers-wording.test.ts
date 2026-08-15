import { describe, expect, it } from "vitest";

import { describeRequestFailure, isNetworkFailure } from "@/lib/http/request-failure";

/**
 * A PLANNER MUST NOT BE SHOWN THE BROWSER'S INTERNAL WORDING.
 *
 * WHERE THIS CAME FROM. A tester pressed Run on Corridor Analysis and was shown
 * exactly **"Failed to fetch"** and nothing else — no way to tell whether the
 * work had started, whether anything had been saved, or whether to retry, wait,
 * or call somebody. That string is not ours: when `fetch()` cannot reach the
 * server the browser throws a TypeError carrying its own wording, and the call
 * sites were doing `error instanceof Error ? error.message : fallback`.
 *
 * IT ALSO VARIED BY BROWSER, which is how you know it was never written for a
 * reader: Chrome says "Failed to fetch", Firefox "NetworkError when attempting
 * to fetch resource", Safari "Load failed".
 *
 * THE LINE THIS MUST NOT CROSS. A refusal FROM the server is a real answer in
 * our own words and has to survive untouched. Swapping "This workspace has no
 * home geography" for a soothing connection sentence would lose the only thing
 * that tells a planner what to fix — so the translation is deliberately narrow,
 * and this file spends most of its assertions proving the narrowness rather than
 * the translation.
 */
function networkError(message: string): Error {
  // A fetch network failure is specifically a TypeError; the name is load-bearing.
  const error = new TypeError(message);
  return error;
}

describe("a failed request is not the browser's wording", () => {
  const browserWordings = [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "net::ERR_CONNECTION_REFUSED",
  ];

  it("recognises every engine's way of saying it never reached the server", () => {
    for (const wording of browserWordings) {
      expect(isNetworkFailure(networkError(wording)), wording).toBe(true);
    }
  });

  it("says nothing was started, so a planner knows retrying is safe", () => {
    const message = describeRequestFailure(networkError("Failed to fetch"), "run the analysis");
    expect(message).not.toMatch(/failed to fetch/i);
    expect(message).toMatch(/run the analysis/);
    // The two facts a person actually needs.
    expect(message).toMatch(/nothing was (started|saved)/i);
    expect(message).toMatch(/try again/i);
  });

  it("passes a real answer from the server through unchanged", () => {
    // The server's own sentences are the ones that say what to fix.
    const serverSaid = "This workspace has no home geography, so county onboarding cannot resolve.";
    expect(describeRequestFailure(new Error(serverSaid), "run the analysis")).toBe(serverSaid);
  });

  it("does not swallow a server answer that happens to contain the words", () => {
    // A plain Error, not a TypeError: this came from our own `throw`, not the
    // network. Rewriting it would hide a real finding behind a connection story.
    const serverSaid = "The upstream crash source returned a network error for 2019.";
    expect(isNetworkFailure(new Error(serverSaid))).toBe(false);
    expect(describeRequestFailure(new Error(serverSaid), "run the analysis")).toBe(serverSaid);
  });

  it("still says something when there is no message at all", () => {
    const message = describeRequestFailure(undefined, "generate the report");
    expect(message).toMatch(/generate the report/);
    // Honest about the absence rather than inventing a cause.
    expect(message).toMatch(/no reason was given/i);
  });
});
