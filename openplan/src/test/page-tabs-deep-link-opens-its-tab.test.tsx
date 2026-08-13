import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { PageTabAnchorRouter } from "@/components/ui/page-tab-anchor-router";
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
    const { replaced } = withLocation("https://openplan.test/rtp/c-1#chapter-draft-fiscal-alert");

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
