/**
 * The project lists a board reads.
 *
 * The arithmetic here is trivial and the honesty is not. Three things have to
 * hold, and each is a way a plan could misstate what it commits to:
 *
 *   1. An unpriced project never contributes 0 to a subtotal, and a group
 *      containing one says its total is partial. A subtotal that silently
 *      omitted a project would read as complete.
 *   2. Illustrative projects are never summed with constrained ones. They sit
 *      outside the fiscally constrained programme by regulation.
 *   3. A project assigned to no period is shown, not dropped. A costed project
 *      belonging to nowhere is a gap somebody has to close, and hiding it is
 *      how it stays open.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  RtpProgrammeLists,
  type RtpProgrammeListEntry,
} from "@/app/(app)/rtp/[rtpCycleId]/_components/rtp-programme-lists";

const BANDS = [
  { id: "band-1", label: "First ten years", startYear: 2026, endYear: 2035 },
  { id: "band-2", label: "Later years", startYear: 2036, endYear: 2050 },
];

function entry(overrides: Partial<RtpProgrammeListEntry> & { id: string }): RtpProgrammeListEntry {
  return {
    portfolioRole: "constrained",
    horizonBandId: "band-1",
    estimatedCost: 10_000_000,
    costBasisYear: 2026,
    priorityRationale: null,
    project: { id: `p-${overrides.id}`, name: `Project ${overrides.id}`, status: "active", summary: null },
    priority: { summary: { composite: 0, scoredCriteria: 0, tier: "unscored" }, narrative: "" },
    funding: {
      pipelineLabel: "Likely covered",
      pipelineStatus: "likely_covered",
      committedFundingAmount: 0,
      unfundedAfterLikelyAmount: 0,
    },
    ...overrides,
  };
}

function groupNamed(bandLabel: string, roleLabel: string) {
  const headings = screen.getAllByRole("heading", { level: 3 });
  const heading = headings.find((node) => node.textContent?.includes(bandLabel));
  if (!heading) throw new Error(`No group for band ${bandLabel}`);
  // The <section> wrapping this heading, whose header also carries the role.
  let node: HTMLElement | null = heading.closest("section");
  while (node && !node.textContent?.includes(roleLabel)) node = node.parentElement?.closest("section") ?? null;
  if (!node) throw new Error(`No ${roleLabel} group for band ${bandLabel}`);
  return node;
}

afterEach(() => cleanup());

describe("grouping", () => {
  it("groups by period first and portfolio role second", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[
          entry({ id: "a" }),
          entry({ id: "b", horizonBandId: "band-2" }),
          entry({ id: "c", portfolioRole: "illustrative" }),
        ]}
      />
    );

    const headings = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    // Band order follows the bands array, not insertion order.
    expect(headings[0]).toContain("First ten years");
    expect(headings[headings.length - 1]).toContain("Later years");
    expect(headings.filter((text) => text?.includes("First ten years"))).toHaveLength(2);
  });

  it("shows a project assigned to no period rather than dropping it", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[entry({ id: "orphan", horizonBandId: null })]}
      />
    );

    expect(screen.getByText(/No period assigned/)).toBeInTheDocument();
    expect(screen.getByText("Project orphan")).toBeInTheDocument();
  });
});

describe("subtotals never treat an unpriced project as zero", () => {
  it("reports a whole-group total when every project is priced", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[entry({ id: "a", estimatedCost: 10_000_000 }), entry({ id: "b", estimatedCost: 15_000_000 })]}
      />
    );

    expect(screen.getByText("$25,000,000 across 2 projects")).toBeInTheDocument();
  });

  it("says the total is PARTIAL when one project has no cost", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[entry({ id: "a", estimatedCost: 10_000_000 }), entry({ id: "b", estimatedCost: null })]}
      />
    );

    // The number is still shown — it is true as far as it goes — but it is
    // labelled so nobody reads it as the group's cost.
    expect(screen.getByText(/\$10,000,000 so far/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 projects has no cost recorded/)).toBeInTheDocument();
  });

  it("never renders $0 for a group where nothing is priced", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[entry({ id: "a", estimatedCost: null }), entry({ id: "b", estimatedCost: null })]}
      />
    );

    expect(screen.getByText("No costs recorded for these 2 projects")).toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("shows a per-project row as 'No cost recorded' rather than a zero", () => {
    render(
      <RtpProgrammeLists bands={BANDS} readFailed={false} entries={[entry({ id: "a", estimatedCost: null })]} />
    );

    expect(screen.getByText("No cost recorded")).toBeInTheDocument();
  });
});

describe("the illustrative list is kept apart from the constrained programme", () => {
  it("never sums an illustrative project into the constrained subtotal", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[
          entry({ id: "a", estimatedCost: 10_000_000 }),
          entry({ id: "big", portfolioRole: "illustrative", estimatedCost: 900_000_000 }),
        ]}
      />
    );

    const constrained = groupNamed("First ten years", "Constrained");
    expect(within(constrained).getByText("$10,000,000 across 1 project")).toBeInTheDocument();
    // The $900M illustrative project must not appear in the constrained total.
    expect(within(constrained).queryByText(/910,000,000/)).toBeNull();
    expect(within(constrained).queryByText("Project big")).toBeNull();
  });
});

describe("read failures and empties are distinguished", () => {
  it("says the lists could not be read, not that the plan has no projects", () => {
    render(<RtpProgrammeLists bands={BANDS} readFailed entries={[]} />);

    expect(screen.getByText("The project lists could not be read")).toBeInTheDocument();
    expect(screen.queryByText("No projects are in this plan yet")).toBeNull();
  });

  it("shows the ordinary empty state when the read SUCCEEDED and there is nothing", () => {
    render(<RtpProgrammeLists bands={BANDS} readFailed={false} entries={[]} />);

    expect(screen.getByText("No projects are in this plan yet")).toBeInTheDocument();
  });
});

describe("the project's own funding is labelled as a different question", () => {
  it("does not present funding figures as the plan's programmed cost", () => {
    render(
      <RtpProgrammeLists
        bands={BANDS}
        readFailed={false}
        entries={[
          entry({
            id: "a",
            estimatedCost: 10_000_000,
            funding: {
              pipelineLabel: "Partially covered",
              pipelineStatus: "partially_covered",
              committedFundingAmount: 3_000_000,
              unfundedAfterLikelyAmount: 7_000_000,
            },
          }),
        ]}
      />
    );

    // Both numbers appear, and the funding pair is explicitly attributed to the
    // PROJECT rather than to this plan — merging them would tell a reader the
    // plan is funded when it is not.
    expect(screen.getByText(/Project funding: \$3,000,000 committed/)).toBeInTheDocument();
    expect(screen.getByText("$10,000,000")).toBeInTheDocument();
  });
});
