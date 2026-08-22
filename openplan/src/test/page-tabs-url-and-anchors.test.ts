import { describe, expect, it } from "vitest";

import {
  PAGE_TAB_QUERY_KEY,
  describeUnreadableTabs,
  pageTabForAnchor,
  pageTabHref,
  resolvePageTab,
  unreadableLanes,
  type PageTabDefinition,
} from "@/lib/ui/page-tabs";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { buildCampaignTabs } from "@/app/(app)/engagement/[campaignId]/_tabs";
import { buildRtpCycleTabs } from "@/app/(app)/rtp/[rtpCycleId]/_tabs";
import { tabbedPages } from "./page-tabs-guard-source";

/**
 * THE THREE PROMISES A TABBED DETAIL PAGE MAKES, tested on the real tab
 * definitions the four pages ship rather than on a fixture.
 *
 * 1. The active tab is in the URL, so a colleague can be sent one.
 * 2. An anchor link that predates the tabs still resolves — to the tab that
 *    contains it, not to whatever tab the reader happened to land on.
 * 3. A read that failed behind a CLOSED tab is still announced. This is the one
 *    most likely to be got wrong, because a tab nobody opened and a tab that
 *    could not be read look identical from the outside.
 */

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

describe("the active tab travels in the URL", () => {
  const tabs: PageTabDefinition<"a" | "b">[] = [
    { key: "a", label: "A" },
    { key: "b", label: "B" },
  ];

  it("uses one query key across every tabbed page, so links compose", () => {
    expect(PAGE_TAB_QUERY_KEY).toBe("tab");
    expect(pageTabHref("/projects/p1", "funding")).toBe("/projects/p1?tab=funding");
  });

  it("keeps every other query parameter when the tab changes", () => {
    const href = pageTabHref("/rtp/c1", "financial", new URLSearchParams("backTo=/dashboard&tab=document"));
    const url = new URL(href, "https://example.invalid");

    expect(url.searchParams.get("tab")).toBe("financial");
    expect(url.searchParams.get("backTo")).toBe("/dashboard");
  });

  it("reads the requested tab out of the query string", () => {
    expect(resolvePageTab(tabs, "b", "a")).toBe("b");
    expect(resolvePageTab(tabs, ["b"], "a")).toBe("b");
  });

  it("falls back rather than rendering nothing for a stale or missing tab", () => {
    expect(resolvePageTab(tabs, undefined, "a")).toBe("a");
    expect(resolvePageTab(tabs, "no-such-tab", "a")).toBe("a");
  });
});

describe("an existing anchor link opens the tab that contains it", () => {
  const projectTabs = buildProjectTabs(NO_PROJECT_FAILURES);
  const campaignTabs = buildCampaignTabs(NO_CAMPAIGN_FAILURES);
  const cycleTabs = buildRtpCycleTabs(NO_CYCLE_FAILURES);

  it("resolves the project anchors the rest of the product links to", () => {
    // These four are emitted by the assistant quick links, the workspace
    // command board and the operations summary — 100+ call sites between them.
    expect(pageTabForAnchor(projectTabs, "project-funding-opportunities")).toBe("funding");
    expect(pageTabForAnchor(projectTabs, "project-invoices")).toBe("funding");
    expect(pageTabForAnchor(projectTabs, "project-submittals")).toBe("delivery");
    expect(pageTabForAnchor(projectTabs, "project-governance")).toBe("overview");
    expect(pageTabForAnchor(projectTabs, "project-risks")).toBe("record");
  });

  it("resolves a per-row anchor through its prefix", () => {
    expect(pageTabForAnchor(projectTabs, "project-invoice-8f2c1d0e")).toBe("funding");
    expect(pageTabForAnchor(projectTabs, "project-milestone-8f2c1d0e")).toBe("delivery");
  });

  it("lets the exact anchor win over a prefix that also matches it", () => {
    // `project-invoices` is declared on Funding and `project-invoice-` is a
    // prefix on the same tab, but the pair is what makes the ordering
    // load-bearing: a prefix must never swallow an exact anchor.
    expect(pageTabForAnchor(projectTabs, "project-invoices")).toBe("funding");
    expect(pageTabForAnchor(projectTabs, "project-invoice-")).toBeNull();
  });

  it("resolves the campaign and cycle anchors to their tabs", () => {
    expect(pageTabForAnchor(campaignTabs, "campaign-publish-flow")).toBe("setup");
    expect(pageTabForAnchor(campaignTabs, "engagement-item-title")).toBe("responses");
    expect(pageTabForAnchor(cycleTabs, "rtp-cycle-project-map-canvas")).toBe("projects");
    // Per-chapter, because the Document tab renders one draft-assist panel per
    // chapter and a bare id would repeat down the page. The bare name must NOT
    // resolve: nothing renders it, and a tab switch to a target that does not
    // exist is the failure this whole table exists to prevent.
    expect(pageTabForAnchor(cycleTabs, "chapter-draft-fiscal-alert-8f2c1d0e")).toBe("document");
    expect(pageTabForAnchor(cycleTabs, "rtp-chapter-draft-insert-8f2c1d0e")).toBe("document");
    expect(pageTabForAnchor(cycleTabs, "chapter-draft-fiscal-alert")).toBeNull();
  });

  it("says so rather than guessing when no tab claims an anchor", () => {
    expect(pageTabForAnchor(projectTabs, "not-an-anchor-on-this-page")).toBeNull();
    expect(pageTabForAnchor(projectTabs, "")).toBeNull();
  });

  it("claims each anchor exactly once, so a link has one destination", () => {
    for (const tabs of [projectTabs, campaignTabs, cycleTabs]) {
      const seen = new Map<string, string>();
      for (const tab of tabs) {
        for (const anchor of tab.anchors ?? []) {
          expect(seen.has(anchor), `${anchor} is claimed by ${seen.get(anchor)} and ${tab.key}`).toBe(false);
          seen.set(anchor, tab.key);
        }
      }
    }
  });
});

/**
 * AN ANCHOR ON THE PAGE'S OWN CHROME BELONGS TO NO TAB.
 *
 * The report page's header sits ABOVE the tab strip, so `#report-controls`,
 * `#detail-title`, `#detail-summary` and `#detail-status` are on screen
 * whichever tab is open. Resolving one of them to a tab is not a harmless
 * over-claim: arriving at `?tab=history#report-controls` — a URL this product
 * mints in `getReportNavigationHref` — would `location.replace` onto the
 * claiming tab and throw away the tab the reader asked for, to scroll to a
 * control already in front of them.
 *
 * `pageTabForAnchor` takes the page's chrome anchors as its third argument and
 * answers "no tab" for them BEFORE consulting either the exact claims or the
 * prefixes. That one line was the whole behavioural change, and deleting it
 * left 11 files and 94 tests green: the same commit also narrowed the report
 * tab table, so with today's data nothing claims those ids by either route and
 * both mechanisms answer null.
 *
 * So the first case here is deliberately NOT read off the shipped tab table. It
 * puts a tab in direct conflict with a page anchor — an exact claim and a
 * prefix that both match — which is the only arrangement in which the line is
 * observable, and it is the arrangement the report page was in until it was
 * fixed. The cases after it are the product-level statement, and they are
 * honest about being over-determined today.
 */
describe("an anchor on always-visible chrome resolves to no tab", () => {
  const conflicting: PageTabDefinition<"packet" | "history">[] = [
    { key: "packet", label: "Packet", anchors: ["report-controls"], anchorPrefixes: ["detail-"] },
    { key: "history", label: "History", anchors: ["drift-since-generation"] },
  ];

  it("beats a tab that claims the same id exactly, and a prefix that sweeps it", () => {
    const chrome = ["report-controls", "detail-title"];

    expect(pageTabForAnchor(conflicting, "report-controls", chrome)).toBeNull();
    expect(pageTabForAnchor(conflicting, "detail-title", chrome)).toBeNull();

    // Without the declaration the same table DOES claim both, which is what
    // makes the two assertions above a test of the exemption rather than of an
    // empty tab table.
    expect(pageTabForAnchor(conflicting, "report-controls")).toBe("packet");
    expect(pageTabForAnchor(conflicting, "detail-title")).toBe("packet");

    // And the exemption is narrow: an anchor that really is inside a tab still
    // resolves, with the chrome list present.
    expect(pageTabForAnchor(conflicting, "drift-since-generation", chrome)).toBe("history");
  });

  it("leaves a leading `#` and stray whitespace no way round the exemption", () => {
    const chrome = ["report-controls"];
    expect(pageTabForAnchor(conflicting, "#report-controls", chrome)).toBeNull();
    expect(pageTabForAnchor(conflicting, "  report-controls  ", chrome)).toBeNull();
  });

  /**
   * The shipped statement, over every tabbed page rather than the report page
   * alone, with both the tab table and the chrome list read out of the source
   * that ships them.
   *
   * WHAT THIS DOES NOT PROVE: with today's tables it passes even if
   * `pageTabForAnchor` stops honouring `pageAnchors`, because the report tabs
   * no longer claim those ids by any route. It is here to catch the OTHER
   * direction — a tab that starts claiming a page anchor again — which is how
   * the defect arrived the first time.
   */
  it("holds for every chrome anchor the four tabbed pages declare", () => {
    const pages = tabbedPages();
    const declared = pages.flatMap((page) => page.pageAnchors.map((anchor) => `${page.label}: ${anchor}`));
    // A page whose chrome list came back empty would make every assertion
    // below vacuous, and the report page's list is parsed out of source.
    expect(declared.length, "no tabbed page declares any chrome anchor — the derivation broke").toBeGreaterThan(0);

    const swallowed = pages.flatMap((page) =>
      page.pageAnchors
        .filter((anchor) => pageTabForAnchor(page.tabs, anchor, page.pageAnchors) !== null)
        .map((anchor) => `${page.label}: #${anchor} resolves to ${pageTabForAnchor(page.tabs, anchor, page.pageAnchors)}`),
    );
    expect(
      swallowed,
      "these anchors are on chrome above the tab strip, so a link to one must scroll without changing tab",
    ).toEqual([]);
  });
});

describe("a read that failed behind a closed tab is still announced", () => {
  it("names the tab and the lane, so an empty tab is not mistaken for a broken one", () => {
    const tabs = buildProjectTabs({
      ...NO_PROJECT_FAILURES,
      funding: { profile: false, awards: true, opportunities: false, invoices: true },
    });

    const sentence = describeUnreadableTabs(tabs);

    expect(sentence).toContain("Funding");
    expect(sentence).toContain("funding awards");
    expect(sentence).toContain("invoice records");
    expect(sentence).toContain("unavailable rather than as a record that does not exist");
  });

  it("stays silent when every read behind every tab succeeded", () => {
    expect(describeUnreadableTabs(buildProjectTabs(NO_PROJECT_FAILURES))).toBeNull();
    expect(describeUnreadableTabs(buildCampaignTabs(NO_CAMPAIGN_FAILURES))).toBeNull();
    expect(describeUnreadableTabs(buildRtpCycleTabs(NO_CYCLE_FAILURES))).toBeNull();
  });

  it("carries the failure from every page's own lanes, not just the project's", () => {
    const campaign = buildCampaignTabs({ ...NO_CAMPAIGN_FAILURES, itemsUnreadable: true });
    expect(describeUnreadableTabs(campaign)).toContain("Responses");
    expect(describeUnreadableTabs(campaign)).toContain("the comments on this campaign");

    const cycle = buildRtpCycleTabs({
      ...NO_CYCLE_FAILURES,
      financial: { horizonBands: false, assumptions: true, measures: false },
    });
    expect(describeUnreadableTabs(cycle)).toContain("Financial");
    expect(describeUnreadableTabs(cycle)).toContain("this plan's financial assumptions");
  });

  it("reports only the lanes that actually failed", () => {
    expect(unreadableLanes([["risks", true], ["issues", false], ["meetings", true]])).toEqual([
      "risks",
      "meetings",
    ]);
  });
});
