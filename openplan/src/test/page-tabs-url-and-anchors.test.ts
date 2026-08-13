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
