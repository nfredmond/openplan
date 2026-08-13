import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { PageTabAnchorRouter } from "@/components/ui/page-tab-anchor-router";
import { PageTabNav } from "@/components/ui/page-tab-nav";
import type { PageTabDefinition } from "@/lib/ui/page-tabs";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { buildRtpCycleTabs } from "@/app/(app)/rtp/[rtpCycleId]/_tabs";

/**
 * A DEEP LINK MUST OPEN ITS TAB.
 *
 * `/projects/<id>#project-invoices` is emitted from three different places in
 * this product and was written when the whole project was one scroll. A tabbed
 * page that landed such a link on its default tab would leave the target
 * unrendered and the reader looking at the wrong thing — the link would appear
 * to work and would not.
 *
 * A fragment is never sent to the server, so this can only be settled on the
 * client. `location.replace` is what the router uses, and it is what is asserted
 * here: the URL it navigates to must name the anchor's tab AND keep the
 * fragment, because arriving at the right tab without the fragment loses the
 * scroll target just as completely.
 */

const NO_PROJECT_FAILURES = {
  overview: { reports: false, stageGates: false },
  delivery: { milestones: false, submittals: false },
  funding: { profile: false, awards: false, opportunities: false, invoices: false },
  evidence: { datasets: false, runs: false, aerial: false },
  record: { risks: false, issues: false, decisions: false, meetings: false },
};

const NO_CYCLE_FAILURES = {
  overview: { packetReports: false, packetArtifacts: false },
  projects: { links: false },
  financial: { horizonBands: false, assumptions: false, measures: false },
  document: { chapters: false },
  comments: { campaigns: false, items: false },
};

/**
 * Points `window.location` at `href` and captures what `replace` is called
 * with. jsdom's own `location` is not writable and navigating it is unsupported,
 * so the object is swapped for a plain stand-in for the duration of the test.
 */
function withLocation(href: string): { replaced: string[] } {
  const url = new URL(href);
  const replaced: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: url.toString(),
      hash: url.hash,
      search: url.search,
      pathname: url.pathname,
      replace: (next: string) => replaced.push(next),
    },
  });
  return { replaced };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an anchor in a closed tab opens that tab", () => {
  it("sends #project-invoices to the funding tab, fragment intact", () => {
    const { replaced } = withLocation("https://openplan.test/projects/p-1#project-invoices");

    render(<PageTabAnchorRouter tabs={buildProjectTabs(NO_PROJECT_FAILURES)} activeKey="overview" />);

    expect(replaced).toHaveLength(1);
    const url = new URL(replaced[0]);
    expect(url.searchParams.get("tab")).toBe("funding");
    expect(url.hash).toBe("#project-invoices");
    expect(url.pathname).toBe("/projects/p-1");
  });

  it("resolves a per-row anchor through its tab's prefix", () => {
    const { replaced } = withLocation("https://openplan.test/projects/p-1#project-milestone-abc123");

    render(<PageTabAnchorRouter tabs={buildProjectTabs(NO_PROJECT_FAILURES)} activeKey="overview" />);

    expect(new URL(replaced[0]).searchParams.get("tab")).toBe("delivery");
  });

  it("works the same on another page's tabs", () => {
    const { replaced } = withLocation("https://openplan.test/rtp/c-1#chapter-draft-fiscal-alert-8f2c1d0e");

    render(<PageTabAnchorRouter tabs={buildRtpCycleTabs(NO_CYCLE_FAILURES)} activeKey="overview" />);

    expect(new URL(replaced[0]).searchParams.get("tab")).toBe("document");
  });

  it("keeps the query parameters the reader arrived with", () => {
    const { replaced } = withLocation("https://openplan.test/projects/p-1?backTo=%2Fdashboard#project-risks");

    render(<PageTabAnchorRouter tabs={buildProjectTabs(NO_PROJECT_FAILURES)} activeKey="overview" />);

    const url = new URL(replaced[0]);
    expect(url.searchParams.get("tab")).toBe("record");
    expect(url.searchParams.get("backTo")).toBe("/dashboard");
  });
});

describe("it navigates only when it has to", () => {
  it("stays put when the anchor is already in the open tab", () => {
    const { replaced } = withLocation("https://openplan.test/projects/p-1?tab=funding#project-invoices");

    render(<PageTabAnchorRouter tabs={buildProjectTabs(NO_PROJECT_FAILURES)} activeKey="funding" />);

    expect(replaced).toEqual([]);
  });

  it("stays put when there is no fragment at all", () => {
    const { replaced } = withLocation("https://openplan.test/projects/p-1?tab=funding");

    render(<PageTabAnchorRouter tabs={buildProjectTabs(NO_PROJECT_FAILURES)} activeKey="funding" />);

    expect(replaced).toEqual([]);
  });

  it("stays put on a fragment no tab claims, rather than guessing a tab", () => {
    const { replaced } = withLocation("https://openplan.test/projects/p-1#something-else-entirely");

    render(<PageTabAnchorRouter tabs={buildProjectTabs(NO_PROJECT_FAILURES)} activeKey="overview" />);

    expect(replaced).toEqual([]);
  });
});

/**
 * AN ANCHOR ABOVE THE STRIP MUST NOT COST THE READER THEIR TAB.
 *
 * `#report-controls` is on the report page's header, which renders above the
 * tab strip and is therefore on screen whichever tab is open. Before the page
 * declared its chrome anchors, the Packet tab claimed `report-controls` and a
 * `detail-` prefix swept in the title, summary and status with it — so
 * `?tab=history#report-controls`, a URL `getReportNavigationHref` mints, did a
 * `location.replace` onto Packet and silently discarded the tab the reader had
 * asked for.
 *
 * The tab table below deliberately still has those claims. Nothing must be
 * navigated anyway, and that is only true if `pageAnchors` is threaded from the
 * page through `PageTabNav` into the router and honoured by `pageTabForAnchor`
 * ahead of both the exact claims and the prefixes. Any one of those three links
 * broken and this navigates.
 *
 * WHAT IT DOES NOT PROVE: that the header element renders above the strip. That
 * is a source ordering assertion in `page-tabs-anchor-coverage`, and jsdom
 * applies no stylesheet and has no box model, so no test here can see a layout.
 */
describe("a link to the page's own chrome scrolls without changing tab", () => {
  const claimingTabs: PageTabDefinition<"packet" | "history">[] = [
    { key: "packet", label: "Packet", anchors: ["report-controls"], anchorPrefixes: ["detail-"] },
    { key: "history", label: "History", anchors: ["drift-since-generation"] },
  ];
  const headerAnchors = ["report-controls", "detail-title", "detail-summary", "detail-status"];

  for (const anchor of ["report-controls", "detail-summary"]) {
    it(`keeps the reader on the tab they asked for when arriving at #${anchor}`, () => {
      const { replaced } = withLocation(`https://openplan.test/reports/r-1?tab=history#${anchor}`);

      render(
        <PageTabNav
          tabs={claimingTabs}
          activeKey="history"
          basePath="/reports/r-1"
          ariaLabel="Report sections"
          pageAnchors={headerAnchors}
        />,
      );

      expect(replaced).toEqual([]);
    });
  }

  it("navigates for the same tab table when the page declares no chrome at all", () => {
    // The negative control. Without this the two cases above would pass for a
    // tab table that claims nothing, which is not what they are asserting.
    const { replaced } = withLocation("https://openplan.test/reports/r-1?tab=history#report-controls");

    render(
      <PageTabNav tabs={claimingTabs} activeKey="history" basePath="/reports/r-1" ariaLabel="Report sections" />,
    );

    expect(replaced).toHaveLength(1);
    expect(new URL(replaced[0]).searchParams.get("tab")).toBe("packet");
  });

  it("still opens a tab for an anchor that really is inside one", () => {
    const { replaced } = withLocation("https://openplan.test/reports/r-1?tab=packet#drift-since-generation");

    render(
      <PageTabNav
        tabs={claimingTabs}
        activeKey="packet"
        basePath="/reports/r-1"
        ariaLabel="Report sections"
        pageAnchors={headerAnchors}
      />,
    );

    expect(new URL(replaced[0]).searchParams.get("tab")).toBe("history");
  });
});
