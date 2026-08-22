import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { PageTabDefinition } from "@/lib/ui/page-tabs";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { buildCampaignTabs } from "@/app/(app)/engagement/[campaignId]/_tabs";
import { buildRtpCycleTabs } from "@/app/(app)/rtp/[rtpCycleId]/_tabs";
import { stripSourceComments } from "./helpers/source-text";

/**
 * A DECLARED TAB WITH NO PANEL IS AN EMPTY TAB, and an empty tab is
 * indistinguishable from a broken one — the failure this whole lane exists to
 * prevent, arriving through the back door. The four pages declare their tabs in
 * one place and render their panels in another, so nothing in the type system
 * connects the two: dropping a `<PageTabPanel>` while leaving its trigger in
 * the strip compiles, ships, and gives a planner a tab that shows nothing.
 *
 * WHAT THIS IS AND IS NOT. It reads source, not a rendered page, so it proves
 * the wiring exists rather than that the panel renders anything useful — the
 * rendered-behaviour tests are in the sibling `page-tabs-*` files, against the
 * real components. Comments are stripped first, because a matcher fed prose is
 * a mistake this repo has made in both directions.
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

const TABBED_SURFACES: Array<{
  label: string;
  /** The file that RENDERS the tabs — for reports that is the detail component. */
  file: string;
  tabKeys: string[];
}> = [
  {
    label: "project detail",
    file: "app/(app)/projects/[projectId]/page.tsx",
    tabKeys: buildProjectTabs(NO_PROJECT_FAILURES).map((tab) => tab.key),
  },
  {
    label: "engagement console",
    file: "app/(app)/engagement/[campaignId]/page.tsx",
    tabKeys: buildCampaignTabs(NO_CAMPAIGN_FAILURES).map((tab) => tab.key),
  },
  {
    label: "RTP cycle",
    file: "app/(app)/rtp/[rtpCycleId]/page.tsx",
    tabKeys: buildRtpCycleTabs(NO_CYCLE_FAILURES).map((tab) => tab.key),
  },
  {
    label: "report detail",
    file: "app/(app)/reports/[reportId]/_components/report-standard-detail.tsx",
    tabKeys: ["packet", "evidence", "history"],
  },
];

function code(file: string): string {
  return stripSourceComments(readFileSync(path.join(SRC, file), "utf8"));
}

describe("each tabbed page renders a strip and a panel for every tab it declares", () => {
  for (const surface of TABBED_SURFACES) {
    it(`wires the ${surface.label} tabs`, () => {
      const source = code(surface.file);

      // The trailing-boundary class is load-bearing: `toContain("<PageTabNav")`
      // matched `<PageTabNavX` when that mutation was run, which is the
      // substring blind spot this repo has already been bitten by once.
      expect(source, `${surface.label} declares tabs but renders no tab strip`).toMatch(/<PageTabNav[\s/>]/);

      const rendered = surface.tabKeys.filter((key) =>
        new RegExp(`<PageTabPanel\\s+tabKey="${key}"`).test(source),
      );
      expect(rendered, `${surface.label} declares a tab it renders no panel for`).toEqual(surface.tabKeys);
    });
  }
});

describe("each tabbed page takes its active tab from the URL", () => {
  for (const surface of TABBED_SURFACES) {
    it(`resolves the ${surface.label} tab from its own searchParams`, () => {
      const source = code(surface.file);

      expect(source, `${surface.label} does not resolve a tab from the request`).toContain("resolvePageTab(");
      // The resolution has to be fed by the request, not by a constant: a page
      // that resolved a hardcoded key would still have a working-looking strip
      // whose links changed nothing.
      expect(source, `${surface.label} resolves a tab without consulting searchParams`).toMatch(
        // No `s` flag: the pattern contains no `.`, and this repo's tsconfig
        // targets below es2018, where `s` is a compile error rather than a
        // no-op. It was one, until this line was fixed.
        /resolvePageTab\([^)]*(searchParams|requestedTab)/i,
      );
    });
  }
});

describe("the pages agree with the tab modules about which page they are", () => {
  it("gives each strip this page's own path, never a hardcoded route", () => {
    for (const surface of TABBED_SURFACES) {
      const source = code(surface.file);
      const basePath = source.match(/basePath=\{([^}]*)\}/)?.[1] ?? "";

      expect(basePath, `${surface.label} does not pass a basePath to its tab strip`).not.toBe("");
      // A template literal carrying the record's own id. A literal string here
      // would send every record's tab links to the same URL.
      expect(basePath, `${surface.label} hardcodes its tab strip's path`).toContain("${");
    }
  });

  it("uses a distinct key per tab within a page", () => {
    for (const surface of TABBED_SURFACES) {
      expect(new Set(surface.tabKeys).size).toBe(surface.tabKeys.length);
    }
  });
});

describe("the shared tab type stays plain data", () => {
  it("carries nothing that cannot cross the server/client boundary", () => {
    // `PageTabNav` hands the definitions to a client component, so a function
    // or a class on a tab would fail at runtime rather than at build time.
    const tabs: PageTabDefinition<string>[] = [
      ...buildProjectTabs(NO_PROJECT_FAILURES),
      ...buildCampaignTabs(NO_CAMPAIGN_FAILURES),
      ...buildRtpCycleTabs(NO_CYCLE_FAILURES),
    ];

    expect(() => structuredClone(tabs)).not.toThrow();
  });
});
