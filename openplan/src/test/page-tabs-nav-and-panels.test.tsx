import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageTabNav } from "@/components/ui/page-tab-nav";
import { PageTabPanel } from "@/components/ui/page-tab-panel";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";

/**
 * The tab strip as it is actually rendered, against the project page's real tab
 * definitions.
 *
 * NOTHING HERE CLAIMS TO CHECK VISIBILITY. jsdom applies no stylesheet, so a
 * `hidden` utility class means nothing to it; what is asserted is the DOM the
 * browser is given — the href each trigger points at, and the state each panel
 * is marked with. The visibility follows from `display: none` in a browser, and
 * a test that pretended to have verified that would be worse than no test.
 */

const NO_FAILURES = {
  overview: { reports: false, stageGates: false },
  delivery: { milestones: false, submittals: false },
  funding: { profile: false, awards: false, opportunities: false, invoices: false },
  evidence: { datasets: false, runs: false, aerial: false },
  record: { risks: false, issues: false, decisions: false, meetings: false },
};

function hrefFor(label: string): string {
  return screen.getByRole("link", { name: new RegExp(`^${label}`) }).getAttribute("href") ?? "";
}

describe("the tab strip links every tab by URL", () => {
  it("points each trigger at its own tab on this page's own path", () => {
    render(
      <PageTabNav
        tabs={buildProjectTabs(NO_FAILURES)}
        activeKey="overview"
        basePath="/projects/p-1"
        ariaLabel="Project sections"
      />
    );

    expect(hrefFor("Overview")).toBe("/projects/p-1?tab=overview");
    expect(hrefFor("Funding")).toBe("/projects/p-1?tab=funding");
    expect(hrefFor("Record")).toBe("/projects/p-1?tab=record");
  });

  it("carries the reader's other query parameters across a tab change", () => {
    render(
      <PageTabNav
        tabs={buildProjectTabs(NO_FAILURES)}
        activeKey="overview"
        basePath="/projects/p-1"
        searchParams={{ backTo: "/dashboard", tab: "overview" }}
        ariaLabel="Project sections"
      />
    );

    expect(hrefFor("Delivery")).toContain("backTo=%2Fdashboard");
    expect(hrefFor("Delivery")).toContain("tab=delivery");
  });

  it("marks exactly one trigger as the current page", () => {
    render(
      <PageTabNav
        tabs={buildProjectTabs(NO_FAILURES)}
        activeKey="funding"
        basePath="/projects/p-1"
        ariaLabel="Project sections"
      />
    );

    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("data-page-tab")).toBe("funding");
  });
});

describe("a failed read behind a closed tab announces itself", () => {
  it("names the tab above the strip and marks the trigger, while that tab is shut", () => {
    render(
      <PageTabNav
        tabs={buildProjectTabs({
          ...NO_FAILURES,
          funding: { profile: false, awards: true, opportunities: false, invoices: false },
        })}
        activeKey="overview"
        basePath="/projects/p-1"
        ariaLabel="Project sections"
      />
    );

    const notice = screen.getByTestId("page-tabs-unreadable-notice");
    expect(notice.textContent).toContain("Funding");
    expect(notice.textContent).toContain("funding awards");

    // And the strip itself carries the mark, so the reader knows where to go.
    expect(screen.getByTestId("page-tab-unreadable-funding")).toBeInTheDocument();
    expect(screen.queryByTestId("page-tab-unreadable-delivery")).not.toBeInTheDocument();
  });

  it("says nothing at all when every read succeeded", () => {
    render(
      <PageTabNav
        tabs={buildProjectTabs(NO_FAILURES)}
        activeKey="overview"
        basePath="/projects/p-1"
        ariaLabel="Project sections"
      />
    );

    expect(screen.queryByTestId("page-tabs-unreadable-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-tab-unreadable-funding")).not.toBeInTheDocument();
  });
});

describe("panels are marked open or closed", () => {
  it("gives the browser display:none for the closed panel and nothing for the open one", () => {
    render(
      <>
        <PageTabPanel tabKey="overview" active>
          <p>open panel body</p>
        </PageTabPanel>
        <PageTabPanel tabKey="funding" active={false}>
          <p>closed panel body</p>
        </PageTabPanel>
      </>
    );

    const open = document.querySelector('[data-page-tab-panel="overview"]');
    const closed = document.querySelector('[data-page-tab-panel="funding"]');

    expect(open?.getAttribute("data-page-tab-panel-state")).toBe("open");
    expect(open?.className).not.toContain("hidden");
    expect(closed?.getAttribute("data-page-tab-panel-state")).toBe("closed");
    expect(closed?.className.split(/\s+/)).toContain("hidden");
  });

  it("uses the layout the page asked for on the open panel", () => {
    render(
      <PageTabPanel tabKey="financial" active className="mt-6 space-y-4">
        <p>body</p>
      </PageTabPanel>
    );

    expect(document.querySelector('[data-page-tab-panel="financial"]')?.className).toBe("mt-6 space-y-4");
  });
});
