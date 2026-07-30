import { describe, expect, it } from "vitest";
import {
  COMMENT_IMPORT_MAX_ROWS,
  IMPORTABLE_SOURCE_TYPES,
  commentImportProvenance,
  isImportableSourceType,
  parseCommentImportCsv,
} from "@/lib/engagement/comment-import";

/**
 * A CONSULTATION IS NOT THE PORTAL.
 *
 * It is the open house with a flip chart, the comment cards at the library, the
 * project inbox, the council transcript — and then the portal.
 * `engagement_items.source_type` has carried `meeting` and `email` since the
 * table was created, so the model always expected them; nothing offered a way in.
 *
 * That is an honesty problem rather than a convenience one. Every claim this
 * product makes about a campaign is computed over the items it holds, so an
 * agency whose in-person turnout never got entered receives a confident reading
 * of its own outreach that is wrong in a predictable direction — portal
 * submissions skew toward people with a device, a data plan, and enough English
 * or Spanish to use one, which is precisely the population an equity screening
 * exists to look past.
 */

describe("reading a file of offline comment", () => {
  it("reads the comment, the name, and the topic", () => {
    const result = parseCommentImportCsv(
      "comment,name,category\nThe crossing at 5th is unsafe,A. Rivera,Safety\n"
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      body: "The crossing at 5th is unsafe",
      submittedBy: "A. Rivera",
      categoryLabel: "Safety",
      latitude: null,
      longitude: null,
    });
  });

  it("accepts the header spellings a real export actually uses", () => {
    // A planner exports from Excel, SurveyMonkey, a county CRM or a hand-kept
    // sheet, and none of them agrees on capitalisation or punctuation.
    for (const header of ["Comment", "  BODY  ", "Response", "feed_back", "Feedback", "Text"]) {
      const result = parseCommentImportCsv(`${header}\nSomething a resident said\n`);
      expect(result.rows, `header: ${header}`).toHaveLength(1);
    }
  });

  it("counts rows the way the spreadsheet on the planner's other screen does", () => {
    const result = parseCommentImportCsv("comment\nfirst\n\nthird\n");

    // The header is row 1, so the first comment is row 2. An off-by-one sends
    // somebody to the wrong line of a 300-row file.
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });

  it("says which columns it did not read instead of dropping them quietly", () => {
    const result = parseCommentImportCsv("comment,phone,zip\nhello,555-0100,95959\n");

    // A body column spelled in a way this does not recognise is data loss that
    // otherwise looks exactly like a successful import.
    expect(result.ignored).toEqual(["phone", "zip"]);
  });

  it("refuses a file with no comment column, rather than importing empty rows", () => {
    const result = parseCommentImportCsv("name,zip\nA. Rivera,95959\n");

    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toMatch(/No comment column/i);
  });

  it("names every problem at once, not the first one", () => {
    const result = parseCommentImportCsv(
      "comment,latitude,longitude\n,39.2,-121.0\ngood one,not-a-number,-121.0\nanother,39.2,\n"
    );

    // Fixing one error, re-uploading, and being told about the next is the loop
    // this exists to collapse.
    expect(result.errors.map((error) => error.rowNumber)).toEqual([2, 3, 4]);
    expect(result.errors[0].message).toMatch(/empty/i);
    expect(result.errors[1].message).toMatch(/not a number/i);
    expect(result.errors[2].message).toMatch(/both a latitude and a longitude/i);
  });

  it("treats a blank location as no location and a broken one as an error", () => {
    const blank = parseCommentImportCsv("comment,latitude,longitude\nhello,,\n");
    expect(blank.errors).toEqual([]);
    expect(blank.rows[0].latitude).toBeNull();

    // Most offline comment has no coordinate. A cell that says "unknown" in a
    // column of real coordinates is a file the operator should look at, and
    // silently dropping that pin would move a comment off the map unannounced.
    const broken = parseCommentImportCsv("comment,latitude,longitude\nhello,unknown,-121.0\n");
    expect(broken.errors).toHaveLength(1);
    expect(broken.rows).toEqual([]);
  });

  it("refuses a coordinate outside the world", () => {
    const result = parseCommentImportCsv("comment,latitude,longitude\nhello,412.0,-121.0\n");

    expect(result.errors[0].message).toMatch(/outside the valid range/i);
  });

  it("keeps a comment containing commas and newlines intact", () => {
    const result = parseCommentImportCsv(
      'comment\n"The lights at 5th, 6th, and 7th\nall need retiming"\n'
    );

    // Hand-rolled splitting on commas is the classic way to shred exactly the
    // long, considered comments an agency most wants to keep.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].body).toContain("5th, 6th, and 7th");
    expect(result.rows[0].body).toContain("all need retiming");
  });

  it("refuses a file too large to import in one pass, and says how large", () => {
    const rows = Array.from({ length: COMMENT_IMPORT_MAX_ROWS + 1 }, (_, i) => `comment ${i}`).join("\n");
    const result = parseCommentImportCsv(`comment\n${rows}\n`);

    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toMatch(new RegExp(`${COMMENT_IMPORT_MAX_ROWS}`));
  });

  it("reports an unreadable file as unreadable, not as an empty one", () => {
    const result = parseCommentImportCsv('comment\n"unterminated\n');

    // "0 comments found" would send an operator looking for a problem in their
    // data when the problem is that the file could not be parsed.
    expect(result.errors[0].message).toMatch(/could not be read as CSV/i);
  });
});

describe("what an import is not allowed to claim", () => {
  it("cannot mark imported comment as a public portal submission", () => {
    // `public` means a member of the public submitted through the portal under a
    // rate limit, a honeypot and a share token — none of which a spreadsheet row
    // has or can be given afterwards. Allowing it would let operator access
    // manufacture public support that every downstream count treats as genuine.
    expect(isImportableSourceType("public")).toBe(false);
    expect(IMPORTABLE_SOURCE_TYPES).not.toContain("public");
  });

  it("still offers the three sources that are honest to claim", () => {
    expect([...IMPORTABLE_SOURCE_TYPES].sort()).toEqual(["email", "internal", "meeting"]);
  });

  it("records where each comment came from, down to the line of the file", () => {
    const provenance = commentImportProvenance({
      batchId: "batch-1",
      fileName: "open-house-2026-03-12.csv",
      rowNumber: 47,
      importedAt: "2026-07-30T00:00:00.000Z",
    });

    // "A resident said X" is a different claim depending on whether X was typed
    // into a portal or transcribed from a card, and six months later nobody
    // remembers which.
    expect(provenance).toEqual({
      import: {
        batchId: "batch-1",
        fileName: "open-house-2026-03-12.csv",
        rowNumber: 47,
        importedAt: "2026-07-30T00:00:00.000Z",
      },
    });
  });
});
