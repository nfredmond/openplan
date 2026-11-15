/**
 * THE REVIEW FILES CALL THE RESPONSE A STAFF RESPONSE (KI-2026-11-15-011).
 *
 * Found on 2026-11-15 by the second proven job's dress rehearsal. The review
 * PDF printed the "We did" text as "Agency response". The demonstration's
 * response says it speaks for no agency, and a tribal government or a
 * consultant's workspace is not an agency either. The workspace staff wrote
 * it, so the label says so.
 *
 * The rule: the HTML both review PDFs are printed from, for each scope and
 * for decision history with and without synthesis evidence, labels the
 * response "Staff response" and never "Agency response", and the workbook's
 * human-readable Decision history header does the same. Only labels changed:
 * the stored column `we_did` and the workbook field key `agency_response` in
 * the synthesis sheets stay as they are, because exports and readers join on
 * them.
 *
 * WHAT THIS FILE CANNOT PROVE. Wording on screens it does not render (the
 * staff evidence panel has its own test), or how the PDF reads after Chrome
 * prints it; the label is plain text in the HTML, so printing cannot change it.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildCampaignReviewHtml, buildCampaignReviewWorkbook, parseReviewSnapshot } from "@/lib/engagement/review-export";
import { decisionHistoryReviewSnapshots, fullerInternalReviewSnapshot, fullerPublicReviewSnapshot } from "./fixtures/engagement/review-wording";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function saved(snapshot: unknown) {
  const raw = JSON.stringify(snapshot), checksum = hash(raw);
  return { checksum, parsed: await parseReviewSnapshot(raw, checksum) };
}

describe("the review files label the response a staff response", () => {
  it.each([
    { name: "public copy", snapshot: fullerPublicReviewSnapshot() },
    { name: "internal copy", snapshot: fullerInternalReviewSnapshot() },
  ])("$name prints each published response as a staff response", async ({ snapshot }) => {
    const { parsed, checksum } = await saved(snapshot);
    expect(parsed.responses.length).toBeGreaterThan(0);
    const html = buildCampaignReviewHtml(parsed, checksum);
    expect(html.match(/<p>Staff response: /g)?.length).toBe(parsed.responses.length);
    expect(html).not.toMatch(/agency response/i);
  });

  it.each(decisionHistoryReviewSnapshots())("decision history ($name) heads each response as a staff response", async ({ snapshot }) => {
    const { parsed, checksum } = await saved(snapshot);
    expect(parsed.decisionLinks?.length).toBeGreaterThan(0);
    const html = buildCampaignReviewHtml(parsed, checksum);
    expect(html).toContain("<h4>Staff response</h4>");
    expect(html).not.toMatch(/agency response/i);
  });

  it("names the response column in the workbook's decision history Staff response", async () => {
    const [{ snapshot }] = decisionHistoryReviewSnapshots();
    const { parsed, checksum } = await saved(snapshot);
    const book = XLSX.read(await buildCampaignReviewWorkbook(parsed, checksum), { type: "buffer" });
    const header = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Decision history"], { header: 1 })[0] as unknown[];
    expect(header).toContain("Staff response");
    expect(header).not.toContain("Agency response");
    expect(header).toContain("You said");
  });
});
