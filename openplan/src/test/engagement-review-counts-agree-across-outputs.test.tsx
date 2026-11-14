/**
 * THE REVIEW PDF, THE REVIEW WORKBOOK, THE REVIEW ZIP'S MANIFEST AND THE
 * PUBLIC RESPONSE PAGE STATE THE SAME COUNTS.
 *
 * A public engagement record is believed when its numbers agree wherever a
 * reader meets them. Each of the four outputs used to count on its own: the
 * PDF from a state table, the workbook not at all by state, the manifest by
 * record set, and the public page by top-level comments and entries. Now all
 * four count through `countEngagementReview`, and this file builds all four
 * from one fixture with every case in it: approved, withheld, pending and
 * flagged contributions; one answered by one published response, one answered
 * by two, one answered only by an unpublished draft.
 *
 * Each output is read the way its reader reads it: the PDF's count sentences
 * from the HTML it is printed from, the workbook by cell, the manifest as
 * JSON from the real ZIP, and the public page as rendered (tab counts and the
 * comments each response links to). The numbers are also fixed in the test, so
 * a mistake shared by all four still fails.
 *
 * WHAT THIS FILE CANNOT PROVE. The real PDF's text layer (the PDF counts test
 * reads that with Poppler), a live database's selection (the public copy here
 * is built the way the snapshot function selects it, not by it), or what a
 * resident sees on screen: jsdom applies no stylesheet.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildCampaignReviewHtml, parseReviewSnapshot, renderCampaignReviewFiles, type EngagementReviewSnapshot } from "@/lib/engagement/review-export";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { emptyPortalTranslationIndex, resolveOperatorText } from "@/lib/engagement/portal-i18n/operator-text";
import type { PublicCloseLoopEntry } from "@/components/engagement/public-close-loop";
import { REVIEW_COUNT_EXPECTED, internalReviewCountSnapshot, publicReviewCountSnapshot, savedSnapshot } from "./fixtures/engagement/review-counts";

vi.mock("@/lib/reports/pdf", () => ({
  renderReportPdf: vi.fn(async () => ({ bytes: new TextEncoder().encode("%PDF-1.7 test"), engine: "chrome", pageCount: 1, disclosure: null, engineFailure: null })),
}));
vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

let PublicEngagementPortal: typeof import("@/components/engagement/public-engagement-portal").PublicEngagementPortal;
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  vi.resetModules();
  PublicEngagementPortal = (await import("@/components/engagement/public-engagement-portal")).PublicEngagementPortal;
});
afterAll(() => {
  vi.unstubAllEnvs();
});

type Counts = Partial<Record<"received" | "approved" | "withheld" | "pending" | "flagged" | "publishedResponses" | "answered", number>>;

async function parsed(snapshot: EngagementReviewSnapshot) {
  const saved = savedSnapshot(snapshot);
  return { saved, review: await parseReviewSnapshot(saved.text, saved.checksum) };
}

/** The PDF's count sentences, read back into numbers by their leading words. */
async function pdfCounts(snapshot: EngagementReviewSnapshot): Promise<Counts> {
  const { saved, review } = await parsed(snapshot);
  const document = new DOMParser().parseFromString(buildCampaignReviewHtml(review, saved.checksum), "text/html");
  const lines = [...document.querySelectorAll("ul.review-counts li")].map((li) => li.textContent ?? "");
  const keys: Record<string, keyof Counts> = {
    Received: "received", Approved: "approved", Withheld: "withheld", Pending: "pending",
    "Flagged for review": "flagged", Published: "publishedResponses", Answered: "answered",
  };
  const counts: Counts = {};
  for (const line of lines) {
    const match = /^(Received|Approved|Withheld|Pending|Flagged for review|Published|Answered) (\d+) /.exec(line);
    if (match) counts[keys[match[1]]] = Number(match[2]);
  }
  return counts;
}

/** The workbook's Summary cells, read by their labels. */
async function workbookCounts(snapshot: EngagementReviewSnapshot): Promise<Counts> {
  const { saved } = await parsed(snapshot);
  const files = await renderCampaignReviewFiles(saved.text, saved.checksum);
  const book = XLSX.read(files.find((file) => file.format === "xlsx")!.bytes, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<[string, unknown]>(book.Sheets.Summary, { header: 1 });
  const labels: Record<string, keyof Counts> = {
    Received: "received", Approved: "approved", Withheld: "withheld", Pending: "pending", "Flagged for review": "flagged",
    "Published staff responses": "publishedResponses", "Answered by a published staff response": "answered",
  };
  const counts: Counts = {};
  for (const [label, value] of rows) if (labels[label] && typeof value === "number") counts[labels[label]] = value;
  return counts;
}

/** The counts in the real ZIP's manifest.json. */
async function manifestCounts(snapshot: EngagementReviewSnapshot): Promise<Counts> {
  const { saved } = await parsed(snapshot);
  const files = await renderCampaignReviewFiles(saved.text, saved.checksum);
  const zip = await JSZip.loadAsync(files.find((file) => file.format === "zip")!.bytes);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as { counts: Record<string, number> };
  const { received, approved, withheld, pending, flaggedForReview, publishedResponses, answered } = manifest.counts;
  return Object.fromEntries(Object.entries({ received, approved, withheld, pending, flagged: flaggedForReview, publishedResponses, answered })
    .filter(([, value]) => value !== undefined)) as Counts;
}

/** The public response page, rendered from the public copy's records, read as a resident reads it. */
function publicPageCounts(snapshot: EngagementReviewSnapshot): Counts {
  const en = resolvePortalLocale({ requested: "en", acceptLanguage: null });
  const index = emptyPortalTranslationIndex("en");
  const text = (id: string, field: string, value: string) => resolveOperatorText(index, { entity: "close_loop_entry", id, field }, value);
  const entries: PublicCloseLoopEntry[] = snapshot.responses.map((row) => ({
    id: String(row.id), themeTitle: String(row.theme_title), youSaid: String(row.you_said), weDid: String(row.we_did), categoryLabel: null,
    themeTitleText: text(String(row.id), "theme_title", String(row.theme_title)),
    youSaidText: text(String(row.id), "you_said", String(row.you_said)),
    weDidText: text(String(row.id), "we_did", String(row.we_did)),
    categoryLabelText: null,
    sourceItemIds: row.source_item_ids as string[],
  }));
  const { unmount } = render(
    <PublicEngagementPortal
      mapFraming={resolvePortalMapFraming({})}
      shareToken="share-token-counts"
      acceptingSubmissions={false}
      engagementType="map_feedback"
      categories={[]}
      approvedItems={snapshot.items.map((row) => ({
        id: String(row.id), categoryId: null, title: String(row.title), body: String(row.body), submittedBy: null,
        latitude: null, longitude: null, parentItemId: (row.parent_item_id as string | null) ?? null, createdAt: String(row.created_at),
      }))}
      closeLoopEntries={entries}
      locale={en}
      messages={buildPortalMessageBundle(en)}
    />
  );
  const tabCount = (name: RegExp) => Number(/\((\d+)\)/.exec(screen.getByRole("button", { name }).textContent ?? "")?.[1]);
  const approved = tabCount(/^Comments/);
  const publishedResponses = tabCount(/^You said \/ We did/);
  fireEvent.click(screen.getByRole("button", { name: /^You said \/ We did/ }));
  // The comments each response links to, by the comment named in the link.
  const answered = new Set(
    within(document.body).getAllByRole("link")
      .map((link) => new URL(link.getAttribute("href") ?? "", "https://portal.test").searchParams.get("item"))
      .filter((id): id is string => Boolean(id))
  ).size;
  unmount();
  return { approved, publishedResponses, answered };
}

describe("one campaign's review counts, in every output that states them", () => {
  it("agree across the internal PDF, workbook and manifest, and match the fixture", async () => {
    const snapshot = internalReviewCountSnapshot();
    const outputs = { pdf: await pdfCounts(snapshot), workbook: await workbookCounts(snapshot), manifest: await manifestCounts(snapshot) };
    expect(outputs).toEqual({ pdf: REVIEW_COUNT_EXPECTED.internal, workbook: REVIEW_COUNT_EXPECTED.internal, manifest: REVIEW_COUNT_EXPECTED.internal });
  });

  it("agree across the public PDF, workbook, manifest and response page, and match the fixture", async () => {
    const snapshot = publicReviewCountSnapshot();
    const outputs = {
      pdf: await pdfCounts(snapshot), workbook: await workbookCounts(snapshot), manifest: await manifestCounts(snapshot),
      publicPage: publicPageCounts(snapshot),
    };
    const expected = REVIEW_COUNT_EXPECTED.public;
    expect(outputs).toEqual({ pdf: expected, workbook: expected, manifest: expected, publicPage: expected });
  });

  it("counts an approved reply on the public page as the review files count it", async () => {
    // The feed nests a reply under its comment; the review files count it as a contribution.
    const internal = internalReviewCountSnapshot();
    const parent = internal.items[0];
    internal.items.push({ ...parent, id: "00000000-0000-4000-8000-000000000008", title: "A reply", parent_item_id: parent.id });
    const publicCopy = { ...internal, scope: "public" as const, items: internal.items.filter((row) => row.status === "approved").map(({ moderation_notes: _notes, ...row }) => row), responses: internal.responses.filter((row) => row.published_at) };
    expect({ internalPdf: (await pdfCounts(internal)).approved, publicPdf: (await pdfCounts(publicCopy)).approved, publicPage: publicPageCounts(publicCopy).approved })
      .toEqual({ internalPdf: 5, publicPdf: 5, publicPage: 5 });
  });

  it("states the same approved, published and answered counts in the internal files as on the public page", async () => {
    const internal = await pdfCounts(internalReviewCountSnapshot());
    const page = publicPageCounts(publicReviewCountSnapshot());
    expect({ approved: internal.approved, publishedResponses: internal.publishedResponses, answered: internal.answered }).toEqual(page);
  });
});
