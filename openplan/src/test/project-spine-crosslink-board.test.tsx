import { render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSpineCrosslinkBoard } from "@/app/(app)/projects/[projectId]/_components/project-spine-crosslink-board";
import {
  PROJECT_SPINE_CROSSLINK_ROW_COUNT,
  buildProjectSpineCrosslinkSummary,
  type ProjectSpineCrosslinkInput,
} from "@/lib/projects/project-spine-crosslinks";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const emptyInput: ProjectSpineCrosslinkInput = {
  projectId: "project-1",
  geography: {
    label: null,
    isDrawn: false,
    hasResolvableIdentity: false,
    workspaceFallbackLabel: null,
  },
  linkedRtpCycleCount: 0,
  reportRecordCount: 0,
  reportAttentionCount: 0,
  evidenceBackedReportCount: 0,
  comparisonBackedReportCount: 0,
  rtpLinks: {
    constrainedCount: 0,
    illustrativeCount: 0,
    candidateCount: 0,
  },
  scenarios: {
    scenarioSetCount: 0,
    activeScenarioSetCount: 0,
    baselineCount: 0,
    readyAlternativeCount: 0,
    attachedRunCount: 0,
  },
  funding: {
    hasTargetNeed: false,
    label: "Funding target missing",
    reason: "Add a funding need before treating the project as grant-ready.",
    awardCount: 0,
    opportunityCount: 0,
    reimbursementPacketCount: 0,
    unfundedAfterLikelyAmount: 0,
    awardRiskCount: 0,
  },
  engagement: {
    label: "Not linked",
    itemCount: 0,
    handoffReadyCount: 0,
  },
  analysis: {
    recentRunCount: 0,
    comparisonBackedReportCount: 0,
  },
  safety: {
    ingestCount: 0,
    crashCount: 0,
    geocodedCount: 0,
    coverageLabel: null,
    sourceLabel: null,
  },
  aerial: {
    missionCount: 0,
    activeMissionCount: 0,
    readyPackageCount: 0,
    verificationReadiness: "none",
  },
};

const buyerSafeCaveatFragments = [
  "not adopted policy or board-ready evidence",
  "do not treat it as a validated forecast, legal finding, or autonomous prioritization decision",
  "not an award commitment, eligibility opinion, or reimbursement approval",
  "not a substitute for adopted outreach findings or public agency response records",
  "does not certify travel behavior forecasts or prioritization outcomes",
  "an adopted safety plan or an engineering study",
  "not a stamped survey, final engineering record, or autonomous verification",
] as const;

const selfServeSaasPattern = /\b(?:fully\s+)?self[- ]serve\b[^.\n;]*\bSaaS\b|\bSaaS\b[^.\n;]*\bself[- ]serve\b/i;
const autonomousPattern = /\b(?:autonomous|autonomously)\b/i;
const caveatContextPattern = /\b(?:not|no|non-autonomous|do not|does not|without|caveat|supervised|operator|human review|before reuse)\b/i;

function renderedText() {
  return document.body.textContent?.replace(/\s+/g, " ") ?? "";
}

function splitRenderedStatements(text: string) {
  return text
    .split(/[.;]/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function expectNoUnsupportedClaims(text: string) {
  expect(text, "self-serve SaaS should not appear in project-spine proof copy").not.toMatch(selfServeSaasPattern);

  const autonomousStatements = splitRenderedStatements(text).filter((statement) => autonomousPattern.test(statement));
  for (const statement of autonomousStatements) {
    expect(
      caveatContextPattern.test(statement),
      `autonomous wording must stay in caveat/negation context: ${statement}`,
    ).toBe(true);
  }
}

describe("ProjectSpineCrosslinkBoard", () => {
  it("renders an operator empty state without hiding row-level next actions", () => {
    const summary = buildProjectSpineCrosslinkSummary(emptyInput);

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getByText("Empty state")).toBeInTheDocument();
    expect(screen.getByText(/No downstream outputs are linked yet/i)).toBeInTheDocument();
    expect(screen.getByText(/clean setup queue, not a broken board/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Attach this project to the right RTP cycle/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("No evidence yet").length).toBeGreaterThan(0);
  });

  it("renders schema fallback rows as setup work instead of missing data", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...emptyInput,
      pendingSchema: {
        scenario_sets: true,
        aerial_evidence: true,
      },
    });

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getByText("Setup fallback")).toBeInTheDocument();
    expect(screen.getByText(/Some spine lanes are waiting on schema setup/i)).toBeInTheDocument();
    expect(screen.getAllByText("Schema setup pending")).toHaveLength(2);
    expect(screen.getAllByText("Setup needed")).toHaveLength(2);
    expect(screen.getAllByText(/did not treat this as missing evidence/i)).toHaveLength(2);
    expect(screen.getAllByText(/Apply the scenario spine tables/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("setup").length).toBeGreaterThan(0);
  });

  it("renders empty-state row caveats with buyer-safe language and no unsupported claims", () => {
    const summary = buildProjectSpineCrosslinkSummary(emptyInput);

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getAllByText(/Caveat:/i).length).toBeGreaterThanOrEqual(6);

    const text = renderedText();
    for (const caveat of buyerSafeCaveatFragments) {
      expect(text).toContain(caveat);
    }
    expectNoUnsupportedClaims(text);
  });

  it("frames report-lane attention as freshness, generation, or governance review", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...emptyInput,
      linkedRtpCycleCount: 1,
      reportRecordCount: 1,
      reportAttentionCount: 1,
    });

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getByText("Regeneration needed")).toBeInTheDocument();
    expect(screen.getAllByText(/1 packet need refresh, generation, or governance review before reuse/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Refresh, generate, or clear the governance hold on the lead project report before citing it/i).length
    ).toBeGreaterThan(0);
  });

  it("keeps schema-pending copy inside setup and buyer-safe claim boundaries", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...emptyInput,
      pendingSchema: {
        rtp_packets: true,
        scenario_sets: true,
        funding_profile: true,
        engagement_evidence: true,
        analysis_modeling: true,
        aerial_evidence: true,
      },
    });

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getAllByText("Schema setup pending")).toHaveLength(6);
    expect(screen.getAllByText("Setup needed")).toHaveLength(6);
    expect(screen.getAllByText(/Do not cite this lane as empty or complete/i)).toHaveLength(8);

    const text = renderedText();
    expect(text).toContain("showing setup actions instead of pretending those lanes are empty");
    expectNoUnsupportedClaims(text);
  });

  /**
   * THE BADGE IS THE WHOLE DEFECT. It is computed in exactly one place, and
   * before this it had no arm for a failed read — so a lane whose query errored
   * fell through to `row.readiness` and was stamped "Not linked", which is a
   * claim about the project, printed under a banner that had just said the
   * opposite about the same read.
   */
  it("stamps an unreadable lane Unavailable, never Not linked", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...emptyInput,
      unreadable: { safety_evidence: true },
    });

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getByText("Read failure")).toBeInTheDocument();
    expect(screen.getByText(/Some spine lanes could not be read/i)).toBeInTheDocument();

    // Scoped to the row: every OTHER lane on this empty board is legitimately
    // "Not linked", so an unscoped assertion would pass on the defect.
    const unreadableRow = screen.getByText("Could not be read").closest("a") as HTMLElement;
    expect(within(unreadableRow).getByText("Unavailable")).toBeInTheDocument();
    expect(within(unreadableRow).queryByText("Not linked")).toBeNull();
    expect(within(unreadableRow).getByText("Read failed")).toBeInTheDocument();
    expect(within(unreadableRow).getByText(/an unreadable lane is not an empty one/i)).toBeInTheDocument();

    // The inspector gains a "failed" tile beside ready/review/missing.
    const inspector = screen.getByText("Crosslink inspector").closest("aside") as HTMLElement;
    expect(within(inspector).getByText("failed")).toBeInTheDocument();
  });

  /**
   * The board renders `row.detail` as the row's own summary line, directly
   * ABOVE `sourceLabel`/`sourceDetail` — so a reader scanning the unreadable
   * card met "0 acquisitions · latest: 0 ingested / 0 geocoded" first and
   * "nothing shown here is a count of what exists" second. Asserted on the
   * rendered row rather than on the object, because the ordering is the harm.
   */
  it("renders no zero tally inside the row it stamped unreadable", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...emptyInput,
      unreadable: { safety_evidence: true },
    });

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    const unreadableRow = screen.getByText("Could not be read").closest("a") as HTMLElement;
    expect(within(unreadableRow).queryByText(/0 acquisitions/)).toBeNull();
    expect(within(unreadableRow).queryByText(/0 ingested/)).toBeNull();
    expect(within(unreadableRow).getByText(/Counts unavailable/i)).toBeInTheDocument();

    // Scoped control: every OTHER lane on this empty board still shows its real
    // tally, so an over-broad fix that silenced all of them fails here.
    const scenarioRow = screen.getByText("No scenario set").closest("a") as HTMLElement;
    expect(within(scenarioRow).getByText(/0 scenario sets/)).toBeInTheDocument();
  });

  it("shows no failed tile and no Unavailable badge when every read succeeded", () => {
    // Without this the assertions above pass on a board that always warns.
    const summary = buildProjectSpineCrosslinkSummary(emptyInput);

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.queryByText("Could not be read")).toBeNull();
    expect(screen.queryByText("Read failure")).toBeNull();
    const inspector = screen.getByText("Crosslink inspector").closest("aside") as HTMLElement;
    expect(within(inspector).queryByText("failed")).toBeNull();
    expect(screen.getAllByText("Not linked").length).toBeGreaterThan(0);
  });

  it("keeps a worksurface loading skeleton available for source reads", () => {
    const summary = buildProjectSpineCrosslinkSummary(emptyInput);

    render(<ProjectSpineCrosslinkBoard summary={summary} isLoading />);

    expect(screen.getByText("Loading state")).toBeInTheDocument();
    expect(screen.getByText("Loading crosslink queue")).toBeInTheDocument();
    expect(screen.getByText(/Keep the board open while it finishes loading/i)).toBeInTheDocument();
    // Derived from PROJECT_SPINE_CROSSLINK_ROW_COUNT rather than hard-coded, so
    // the skeleton renders the shape the board will actually take.
    expect(screen.getAllByLabelText("Loading crosslink row")).toHaveLength(
      PROJECT_SPINE_CROSSLINK_ROW_COUNT
    );
  });
});
