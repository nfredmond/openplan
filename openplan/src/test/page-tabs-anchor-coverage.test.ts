import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pageTabForAnchor, type PageTabDefinition } from "@/lib/ui/page-tabs";
import { stripSourceComments } from "./helpers/source-text";
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
    anchors: [
      "packet-release-review",
      "release-review",
      "report-controls",
      "narrative-grounding-line",
      "report-narrative-draft-panel",
    ],
    anchorPrefixes: ["detail-", "report-"],
  },
  { key: "evidence", label: "Evidence", anchorPrefixes: ["artifact-"] },
  { key: "history", label: "History", anchors: ["drift-since-generation", "evidence-chain-summary"] },
];

const TABBED_PAGES: Array<{
  /** The route segment a link has to start with to belong to this page. */
  prefix: string;
  label: string;
  tabs: readonly PageTabDefinition<string>[];
}> = [
  { prefix: "projects", label: "project detail", tabs: buildProjectTabs(NO_PROJECT_FAILURES) },
  { prefix: "engagement", label: "engagement console", tabs: buildCampaignTabs(NO_CAMPAIGN_FAILURES) },
  { prefix: "rtp", label: "RTP cycle", tabs: buildRtpCycleTabs(NO_CYCLE_FAILURES) },
  { prefix: "reports", label: "report detail", tabs: REPORT_TABS },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The tests are excluded on purpose: a fixture URL in a test is not a
      // link a planner can follow, and several deliberately use made-up ids.
      if (entry === "test") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

type Found = { file: string; href: string; anchor: string };

/**
 * Every `/<prefix>/…#anchor` link in the source, from plain strings and from
 * template literals alike — `/projects/${id}#project-invoices` is the common
 * form here, so a pattern that stopped at `{` would have walked past nearly all
 * of them.
 *
 * A fragment whose tail is itself interpolated (`#artifact-${artifact.id}`) is
 * recorded with a placeholder standing in for the computed part, because that
 * is exactly the case a tab's `anchorPrefixes` exists to cover and resolving the
 * bare prefix would wrongly report it as unclaimed.
 */
function collectAnchorLinks(prefix: string): Found[] {
  const pattern = new RegExp("/" + prefix + "/[^\\s\"'`]*?#([a-z][a-z0-9-]*)(\\$\\{)?", "g");
  const found: Found[] = [];

  for (const file of sourceFiles(SRC)) {
    // Comments first, always. A route file DOCUMENTS the shape
    // `/reports/{id}#artifact-{id}` in its header, and prose reaching a matcher
    // is a defect this repo has shipped in both directions; the shared stripper
    // is the one place that decision lives.
    const text = stripSourceComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(pattern)) {
      const interpolatedTail = Boolean(match[2]);
      found.push({
        file: path.relative(SRC, file),
        href: match[0],
        anchor: interpolatedTail ? `${match[1]}interpolated-id` : match[1],
      });
    }
  }
  return found;
}

describe("every deep link into a tabbed page resolves to one of its tabs", () => {
  for (const page of TABBED_PAGES) {
    it(`covers the ${page.label} anchors linked from elsewhere in the product`, () => {
      const links = collectAnchorLinks(page.prefix);
      const unclaimed = links.filter((link) => pageTabForAnchor(page.tabs, link.anchor) === null);

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
    const source = readFileSync(
      path.join(SRC, "app/(app)/reports/[reportId]/_components/report-standard-detail.tsx"),
      "utf8",
    );

    for (const tab of REPORT_TABS) {
      expect(source, `report-standard-detail no longer declares the "${tab.key}" tab`).toContain(
        `key: "${tab.key}"`,
      );
      for (const anchor of [...(tab.anchors ?? []), ...(tab.anchorPrefixes ?? [])]) {
        expect(source, `report-standard-detail no longer claims "${anchor}"`).toContain(`"${anchor}"`);
      }
    }
  });
});
