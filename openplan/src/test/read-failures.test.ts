import { describe, expect, it } from "vitest";
import { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * The shapes these tests are written from are supabase-js's, because the point
 * of the module is that `{ data: null, error: null }` and
 * `{ data: null, error: {...} }` look the same to a destructure that only takes
 * `data` — and only one of them may be rendered as an answer.
 */

describe("ReadFailureLog", () => {
  it("says nothing when every read succeeded", () => {
    const reads = new ReadFailureLog();

    expect(reads.check("linked plans", { data: [], error: null })).toBe(false);
    expect(reads.check("linked reports", { data: [{ id: "r1" }], error: null })).toBe(false);

    expect(reads.any).toBe(false);
    expect(reads.describe()).toBeNull();
    expect(reads.messages()).toEqual([]);
  });

  it("treats an empty result as a successful read, not a failure", () => {
    // The whole point: empty is an answer. Only a failure is not.
    const reads = new ReadFailureLog();

    reads.check("linked datasets", { data: [], error: null });

    expect(reads.any).toBe(false);
  });

  it("records a failed read and returns true so the caller can branch once", () => {
    const reads = new ReadFailureLog();

    const failed = reads.check("linked plans", {
      data: null,
      error: { message: 'column plans.tite does not exist' },
    });

    expect(failed).toBe(true);
    expect(reads.any).toBe(true);
    expect(reads.all).toEqual([
      { label: "linked plans", message: "column plans.tite does not exist" },
    ]);
  });

  it("keeps the database's own message for the operator", () => {
    const reads = new ReadFailureLog();

    reads.check("county screening runs", { data: null, error: { message: "permission denied" } });

    expect(reads.messages()).toEqual(["county screening runs: permission denied"]);
  });

  it("still records a failure that arrived without a message", () => {
    const reads = new ReadFailureLog();

    reads.check("linked runs", { data: null, error: { message: null } });
    reads.check("linked datasets", { data: null, error: { message: "   " } });

    expect(reads.all.map((failure) => failure.message)).toEqual([
      "no message reported",
      "no message reported",
    ]);
  });

  it("tolerates a result that is missing entirely", () => {
    const reads = new ReadFailureLog();

    expect(reads.check("something optional", null)).toBe(false);
    expect(reads.check("something else", undefined)).toBe(false);
    expect(reads.any).toBe(false);
  });

  it("names one failure plainly", () => {
    const reads = new ReadFailureLog();
    reads.check("linked plans", { data: null, error: { message: "boom" } });

    expect(reads.describe()).toContain("could not read linked plans");
  });

  it("lists several failures in a sentence a planner can read", () => {
    const reads = new ReadFailureLog();
    reads.check("linked plans", { data: null, error: { message: "boom" } });
    reads.check("linked reports", { data: null, error: { message: "boom" } });
    reads.check("county screening runs", { data: null, error: { message: "boom" } });

    expect(reads.describe()).toContain("linked plans, linked reports and county screening runs");
  });

  it("says the thing the defect turned on — that an empty list is not a finding", () => {
    const reads = new ReadFailureLog();
    reads.check("linked plans", { data: null, error: { message: "boom" } });

    // Without this sentence the disclosure is just noise: the reader still has
    // no reason to disbelieve the zeroes rendered underneath it.
    expect(reads.describe()).toMatch(/would not mean the records are absent/i);
  });

  it("keeps failures in the order they were read, so the sentence follows the page", () => {
    const reads = new ReadFailureLog();
    reads.check("second", { data: null, error: { message: "b" } });
    reads.check("first", { data: null, error: { message: "a" } });

    expect(reads.all.map((failure) => failure.label)).toEqual(["second", "first"]);
  });
});
