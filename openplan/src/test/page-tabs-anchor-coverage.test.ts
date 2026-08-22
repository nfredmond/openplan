import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pageTabForAnchor, type PageTabDefinition } from "@/lib/ui/page-tabs";
import { stripSourceComments } from "./helpers/source-text";
import { anchorLinks } from "./page-tabs-guard-source";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { buildCampaignTabs } from "@/app/(app)/engagement/[campaignId]/_tabs";
import { buildRtpCycleTabs } from "@/app/(app)/rtp/[rtpCycleId]/_tabs";

/**
 * EVERY ANCHOR LINK THIS PRODUCT EMITS AT A TABBED PAGE MUST LAND ON A TAB.
 *
 * Tabbing four detail pages hid most of each one behind a control, and the rest
 * of the product had been linking INTO those pages for a year:
 * `/projects/${id}#project-invoices` from the assistant's quick links,
 * `#project-funding-opportunities` from the workspace command board and the
 * operations summary, `#drift-since-generation` from the report queue. Each of
 * those is a promise that the reader arrives looking at the thing named.
 *
 * A hand-maintained anchor list would drift the first time someone adds a link,
 * and the failure is silent — the link still navigates, it just shows the wrong
 * tab. So this walks the source for the links themselves and resolves each one
 * through the same function the page uses at runtime. Adding a deep link to a
 * tab-hidden panel without claiming its anchor fails here.
 *
 * WHAT THIS CANNOT SEE: a link built from a variable fragment, and a link in a
 * database row or a document rather than in source. Those need the anchor's own
 * tab declaration to be right; this covers the literals, which is all of them
 * today.
 */

const SRC = path.join(process.cwd(), "src");

const NO_PROJECT_FAILURES = {
  overview: { reports: false, stageGates: false },
  delivery: { milestones: false, submittals: false },
  funding: { profile: false, awards: false, opportunities: false, invoices: false },
  evidence: { datasets: false, runs: false, aerial: false },
  record: { risks: false, issues: false, decisions: false, meetings: false },
};

const NO_CAMPAIGN_FAILURES = {
  categoriesUnreadable: false,
  itemsUnreadable: false,
  projectUnreadable: false,
  reportsUnreadable: false,
  reportSectionLinksUnreadable: false,
  rtpCycleUnreadable: false,
  rtpChapterUnreadable: false,
  crashCorroborationUnreadable: false,
};

const NO_CYCLE_FAILURES = {
  overview: { packetReports: false, packetArtifacts: false },
  projects: { links: false },
  financial: { horizonBands: false, assumptions: false, measures: false },
  document: { chapters: false },
  comments: { campaigns: false, items: false },
};

/**
 * The report page declares its tabs inside its detail component rather than in
 * a `_tabs` module, so the list is restated here — and the sibling assertion
 * below proves the restatement still matches what that component ships.
 */
const REPORT_TABS: PageTabDefinition<"packet" | "evidence" | "history">[] = [
  {
    key: "packet",
    label: "Packet",
    anchors: ["packet-release-review", "report-narrative-draft-panel"],
    anchorPrefixes: ["narrative-grounding-line-"],
  },
  { key: "evidence", label: "Evidence", anchorPrefixes: ["artifact-"] },
  { key: "history", label: "History", anchors: ["drift-since-generation", "evidence-chain-summary"] },
];

/**
 * Anchors on the report page's header, which is ABOVE its tab strip and so is
 * on screen whichever tab is open. They belong to no tab, and a link to one
 * must not switch tabs — see `REPORT_HEADER_ANCHORS` in the detail component.
 */
const REPORT_PAGE_ANCHORS = [
  "report-controls",
  "detail-title",
  "detail-summary",
  "detail-status",
] as const;

const TABBED_PAGES: Array<{
  /** The route segment a link has to start with to belong to this page. */
  prefix: string;
  label: string;
  tabs: readonly PageTabDefinition<string>[];
  /** Anchors on chrome above the strip: claimed by the page, by no tab. */
  pageAnchors?: readonly string[];
}> = [
  { prefix: "projects", label: "project detail", tabs: buildProjectTabs(NO_PROJECT_FAILURES) },
  { prefix: "engagement", label: "engagement console", tabs: buildCampaignTabs(NO_CAMPAIGN_FAILURES) },
  { prefix: "rtp", label: "RTP cycle", tabs: buildRtpCycleTabs(NO_CYCLE_FAILURES) },
  { prefix: "reports", label: "report detail", tabs: REPORT_TABS, pageAnchors: REPORT_PAGE_ANCHORS },
];

type Found = { file: string; href: string; anchor: string };

/**
 * Every `/<prefix>/…#anchor` link in the source, resolved the way a tab table
 * claims it: an interpolated tail becomes a placeholder id, because that is
 * exactly the case a tab's `anchorPrefixes` exists to cover and resolving the
 * bare head would wrongly report it as unclaimed.
 *
 * The walk itself lives in `page-tabs-guard-source`, shared with the guard that
 * proves each of these links has an ELEMENT to land on — two copies of it would
 * drift, and the pair only means something if both read the same links.
 */
function collectAnchorLinks(prefix: string): Found[] {
  return anchorLinks(prefix).map((link) => ({
    file: link.file,
    href: link.href,
    anchor: link.interpolated ? `${link.head}interpolated-id` : link.head,
  }));
}

describe("every deep link into a tabbed page resolves to one of its tabs", () => {
  for (const page of TABBED_PAGES) {
    it(`covers the ${page.label} anchors linked from elsewhere in the product`, () => {
      const links = collectAnchorLinks(page.prefix);
      const unclaimed = links.filter(
        (link) =>
          pageTabForAnchor(page.tabs, link.anchor) === null &&
          // A page-level anchor resolves to no tab BY DESIGN: its element is
          // above the strip and always on screen, so the link scrolls without
          // touching the tab the reader asked for.
          !(page.pageAnchors ?? []).includes(link.anchor),
      );

      expect(
        unclaimed.map((link) => `${link.file}: ${link.href}`),
        `these links point at anchors no ${page.label} tab claims, so they would open the default tab ` +
          "with their target unrendered — add the anchor to the tab whose panel renders it",
      ).toEqual([]);
    });
  }

  it("finds the links it is meant to be checking", () => {
    // A guard that walked nothing would pass every assertion above. The project
    // page alone carries dozens of `#project-funding-opportunities` and
    // `#project-invoices` call sites; if this ever drops to nothing, the walk
    // broke rather than the product getting tidier.
    const projectLinks = collectAnchorLinks("projects");
    expect(projectLinks.length).toBeGreaterThan(20);
    expect(new Set(projectLinks.map((link) => link.anchor)).size).toBeGreaterThan(3);
  });
});

describe("the report tab list restated here still matches the one that ships", () => {
  it("names the same tabs and anchors as report-standard-detail", () => {
    // Comments are stripped first, or commenting a tab out satisfies every
    // `toContain` below while deleting it fails — the same prose-reaches-the-
    // matcher class this repo has been bitten by five times in one day.
    const source = stripSourceComments(
      readFileSync(
        path.join(SRC, "app/(app)/reports/[reportId]/_components/report-standard-detail.tsx"),
        "utf8",
      ),
    );

    for (const tab of REPORT_TABS) {
      expect(source, `report-standard-detail no longer declares the "${tab.key}" tab`).toContain(
        `key: "${tab.key}"`,
      );
      for (const anchor of [...(tab.anchors ?? []), ...(tab.anchorPrefixes ?? [])]) {
        expect(source, `report-standard-detail no longer claims "${anchor}"`).toContain(`"${anchor}"`);
      }
    }

    for (const anchor of REPORT_PAGE_ANCHORS) {
      expect(source, `report-standard-detail no longer lists "${anchor}" as page chrome`).toContain(
        `"${anchor}"`,
      );
    }
  });

  it("keeps the header anchors above the tab strip, where every tab can see them", () => {
    // The whole reason those four belong to no tab. If one of them were moved
    // INTO a panel it would need a tab claim again, and a reader arriving from
    // another tab would find nothing at the fragment.
    const source = stripSourceComments(
      readFileSync(
        path.join(SRC, "app/(app)/reports/[reportId]/_components/report-standard-detail.tsx"),
        "utf8",
      ),
    );

    const stripAt = source.indexOf("<PageTabNav");
    expect(stripAt, "report-standard-detail no longer renders a tab strip").toBeGreaterThan(-1);

    const controlsAt = source.indexOf('id="report-controls"');
    expect(controlsAt, "report-standard-detail no longer renders #report-controls").toBeGreaterThan(-1);
    expect(
      controlsAt,
      "#report-controls moved below the tab strip — it is now inside a tab and needs a tab claim",
    ).toBeLessThan(stripAt);

    // And the page has to TELL the strip about them, or `pageTabForAnchor`
    // never sees the exemption and a future prefix sweeps them back in.
    expect(source, "the report page does not declare its header anchors to PageTabNav").toMatch(
      /pageAnchors=\{REPORT_HEADER_ANCHORS\}/,
    );
  });
});
