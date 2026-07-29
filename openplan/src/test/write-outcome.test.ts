import { describe, expect, it } from "vitest";
import {
  POSTGREST_NO_ROWS_MATCHED,
  insertNotReadableBackResponse,
  isNoRowsMatchedError,
  isWriteFailure,
  noRowsMatchedBody,
  noRowsMatchedResponse,
  noRowsMatchedStatus,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";

/**
 * The two shapes PostgREST uses for "your write matched no rows" are what this
 * module exists to collapse, so every test below is written from the shape
 * rather than from the helper: `.single()` reports it in `error`, and
 * `.maybeSingle()` reports the SAME outcome in `data`. A helper that agreed with
 * one and not the other would leave half the defect in place.
 */

const NO_ROWS_ERROR = {
  code: POSTGREST_NO_ROWS_MATCHED,
  message: "JSON object requested, multiple (or no) rows returned",
  details: "The result contains 0 rows",
};

const REAL_FAILURE = {
  code: "42P01",
  message: 'relation "project_widgets" does not exist',
  details: null,
};

describe("recognising a write that changed nothing", () => {
  it("reads PGRST116 as zero rows, not as a failure", () => {
    expect(isNoRowsMatchedError(NO_ROWS_ERROR)).toBe(true);
    expect(isWriteFailure(NO_ROWS_ERROR)).toBe(false);
  });

  it("reads any other error as a real failure", () => {
    expect(isNoRowsMatchedError(REAL_FAILURE)).toBe(false);
    expect(isWriteFailure(REAL_FAILURE)).toBe(true);
  });

  it("treats a null error as no failure at all", () => {
    expect(isNoRowsMatchedError(null)).toBe(false);
    expect(isWriteFailure(null)).toBe(false);
  });

  it("does not match the rest of the PGRST1xx family", () => {
    // PGRST100 is a malformed query string and PGRST301 is a bad JWT. Matching
    // by prefix would answer 404 to both.
    expect(isNoRowsMatchedError({ code: "PGRST100" })).toBe(false);
    expect(isNoRowsMatchedError({ code: "PGRST301" })).toBe(false);
    expect(isNoRowsMatchedError({ code: "PGRST1160" })).toBe(false);
  });

  it("sees zero rows through single(), which reports it in the error", () => {
    expect(writeMatchedNoRows({ data: null, error: NO_ROWS_ERROR })).toBe(true);
  });

  it("sees the same zero rows through maybeSingle(), which reports it in the data", () => {
    expect(writeMatchedNoRows({ data: null, error: null })).toBe(true);
    expect(writeMatchedNoRows({ data: undefined, error: null })).toBe(true);
  });

  it("does not call a real failure zero rows", () => {
    // A route that took this branch would answer 404 for a missing table.
    expect(writeMatchedNoRows({ data: null, error: REAL_FAILURE })).toBe(false);
  });

  it("does not call a successful write zero rows", () => {
    expect(writeMatchedNoRows({ data: { id: "row-1" }, error: null })).toBe(false);
  });

  it("does not mistake a falsy row for a missing one", () => {
    // `!data` would. A count aggregate legitimately returns 0, and an empty
    // array is a row set, not the absence of one.
    expect(writeMatchedNoRows<unknown>({ data: 0, error: null })).toBe(false);
    expect(writeMatchedNoRows<unknown>({ data: "", error: null })).toBe(false);
    expect(writeMatchedNoRows<unknown>({ data: [], error: null })).toBe(false);
    expect(writeMatchedNoRows<unknown>({ data: false, error: null })).toBe(false);
  });
});

describe("answering a write that changed nothing", () => {
  it("answers 404 when the route never verified the target", () => {
    expect(noRowsMatchedStatus({ subject: "invoice", targetWasVerified: false })).toBe(404);
  });

  it("answers 500 when the route did verify the target", () => {
    // The application believed the write was allowed and the database refused
    // it. That is this deployment's defect, not the caller's mistake.
    expect(noRowsMatchedStatus({ subject: "invoice", targetWasVerified: true })).toBe(500);
  });

  it("never answers 403, because that would confirm the row exists", () => {
    // Enumeration: a 403 for rows in other workspaces and a 404 for rows that
    // do not exist tells a stranger which ids are real.
    for (const targetWasVerified of [true, false]) {
      expect(noRowsMatchedStatus({ subject: "project", targetWasVerified })).not.toBe(403);
    }
  });

  it("tells an unverified caller to go looking for the record", () => {
    const body = noRowsMatchedBody({ subject: "spend entry", targetWasVerified: false });
    expect(body.error).toBe("No such spend entry");
    expect(body.details).toContain("spend entry");
    expect(body.details).toMatch(/may not exist/i);
    // It must not claim the record is absent — it may simply be someone else's.
    expect(body.details).toMatch(/workspace you are not a member of/i);
  });

  it("tells an operator where to look when the target was verified", () => {
    const body = noRowsMatchedBody({ subject: "RTP link", targetWasVerified: true });
    expect(body.error).toMatch(/not saved/i);
    expect(body.details).toMatch(/row-level security/i);
    expect(body.details).toMatch(/nothing was saved/i);
    // The sentence that stops the next reader guessing at "Failed to update".
    expect(body.details).toMatch(/passed every check the application makes/i);
  });

  it("carries the status onto the response it builds", async () => {
    const missing = noRowsMatchedResponse({ subject: "model", targetWasVerified: false });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: "No such model" });

    const refused = noRowsMatchedResponse({ subject: "model", targetWasVerified: true });
    expect(refused.status).toBe(500);
  });
});

describe("an insert that landed and could not be read back", () => {
  it("reports success, because the row exists", async () => {
    const response = insertNotReadableBackResponse({ subject: "narrative draft" });

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      created: boolean;
      record: unknown;
      details: string;
    };

    expect(body.created).toBe(true);
    expect(body.record).toBeNull();
    // The instruction that stops a client turning one row into two.
    expect(body.details).toMatch(/retrying would create a second one/i);
  });
});
