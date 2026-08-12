import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The row's packet action is a client component that needs the app router. It
// is not what this file is about, and mocking the hook keeps the REAL registry
// table rendering rather than substituting a fixture for it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/**
 * PREVIOUS PLANS DO NOT CROWD OUT THE ONE BEING WRITTEN.
 *
 * Transcribing an adopted plan means loading prior plans into the registry, and
 * a prior plan lives there as an ARCHIVED cycle — no fifth status was invented
 * for it, because the four the schema has already say what a previous plan is
 * (Nathaniel, 2026-08-11). What that costs, without this, is a registry where
 * the plan a planner is actually writing is the fourth row down.
 *
 * So: archived plans are hidden by default, offered by an explicit toggle that
 * carries their COUNT, and never silently absent — the "showing N cycles"
 * sentence says how many are hidden.
 *
 * And a cycle built by reading a document says so. The label is a count of
 * records, never a quality mark, and a cycle whose counts could not be READ says
 * that rather than showing zero — a failed query is not a finding that nothing
 * was copied.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

import { RtpCycleRegistryTable } from "@/app/(app)/rtp/_components/rtp-cycle-registry-table";
import type { RtpRegistryCycle } from "@/app/(app)/rtp/_components/_types";

function cycle(overrides: Partial<RtpRegistryCycle> & { id: string; title: string }): RtpRegistryCycle {
  return {
    workspace_id: "workspace-1",
    status: "draft",
    geography_label: "Example Region",
    horizon_start_year: 2026,
    horizon_end_year: 2050,
    adoption_target_date: null,
    public_review_open_at: null,
    public_review_close_at: null,
    summary: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    linkedProjectCount: 0,
    constrainedProjectCount: 0,
    illustrativeProjectCount: 0,
    fundedProjectCount: 0,
    likelyCoveredProjectCount: 0,
    unfundedProjectCount: 0,
    paidReimbursementAmount: 0,
    outstandingReimbursementAmount: 0,
    uninvoicedAwardAmount: 0,
    reimbursementInFlightCount: 0,
    packetReport: null,
    packetFreshness: { label: "No packet", tone: "neutral", detail: "" },
    packetPresetPosture: { label: "Not set", tone: "neutral", detail: "" },
    packetAttention: "missing",
    packetOperatorStatus: { label: "Not started", tone: "neutral", detail: "" },
    packetFundingReview: { label: "None", tone: "neutral", detail: "" },
    packetQueueTrace: {
      label: "Unrecorded",
      tone: "neutral",
      detail: "",
      action: null,
      actedAt: null,
      isRecent: false,
      sortTimestamp: 0,
    },
    packetQueueTraceState: { label: "Unrecorded", tone: "neutral", detail: "", state: "unrecorded" },
    packetActivityTrace: { label: "None", tone: "neutral", detail: "" },
    packetScanCue: { label: "None", tone: "neutral", detail: "" },
    packetNavigationHref: "/reports",
    grantsFollowThrough: null,
    readiness: { label: "Foundation incomplete", tone: "warning", ready: false, missing: [] },
    workflow: { label: "Drafting", detail: "", actionItems: [] },
    modelingCountyRunId: null,
    comparisonBackedProjectCount: 0,
    staleModelingProjectCount: 0,
    transcription: null,
    ...overrides,
  } as RtpRegistryCycle;
}

const CURRENT = cycle({ id: "cycle-current", title: "2050 RTP Update" });
const PRIOR = cycle({ id: "cycle-prior", title: "2020 Regional Transportation Plan", status: "archived" });

function renderTable(overrides: Partial<Parameters<typeof RtpCycleRegistryTable>[0]> = {}) {
  return render(
    <RtpCycleRegistryTable
      typedCycles={[CURRENT]}
      allCyclesCount={1}
      recentQueueCyclesCount={0}
      filtersStatus={null}
      selectedPacketFilter="all"
      recentOnly={false}
      showArchived={false}
      archivedCycleCount={3}
      transcriptionCountsUnavailable={false}
      transcriptionCountsTruncated={false}
      selectedQueueActionFilter="all"
      selectedQueueTraceStateFilter="all"
      packetAttentionCounts={{ reset: 0, generate: 0, refresh: 0, missing: 1, current: 0 }}
      queueActionScopedCyclesCount={1}
      queueActionCounts={{ createRecord: 0, resetLayout: 0, generateFirstArtifact: 0, refreshArtifact: 0 }}
      queueTraceStateScopedCyclesCount={1}
      queueTraceStateCounts={{ outpaced: 0, aligned: 0, unrecorded: 1 }}
      currentFundingReviewCount={0}
      currentFundingGapReviewCount={0}
      currentReimbursementFollowThroughCount={0}
      {...overrides}
    />
  );
}

describe("archived plans in the registry", () => {
  it("offers previous plans behind a toggle that says how many there are", () => {
    renderTable();
    const toggle = screen.getByRole("link", { name: /show archived plans/i });
    expect(toggle).toHaveTextContent("3");
    expect(toggle.getAttribute("href")).toContain("archived=1");
  });

  it("says how many are hidden rather than hiding them silently", () => {
    renderTable();
    expect(screen.getByText(/3 archived plans hidden/i)).toBeInTheDocument();
  });

  it("offers the way back, and says so, once they are shown", () => {
    renderTable({ showArchived: true, typedCycles: [CURRENT, PRIOR], allCyclesCount: 2 });
    const toggle = screen.getByRole("link", { name: /hide archived plans/i });
    // The way back must not carry `archived=1`, or the toggle is a one-way door.
    expect(toggle.getAttribute("href") ?? "").not.toContain("archived=1");
    expect(screen.getByText(/including archived plans/i)).toBeInTheDocument();
    expect(screen.getByText("2020 Regional Transportation Plan")).toBeInTheDocument();
  });

  it("keeps the archived choice across every other filter link", () => {
    // The defect this guards: eight filter links each rebuilt the query string
    // by hand, so one of them dropping `archived` would quietly re-hide the
    // previous plans a planner just asked to see.
    renderTable({ showArchived: true, typedCycles: [CURRENT, PRIOR], allCyclesCount: 2 });
    const links = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/rtp?"));
    expect(links.length).toBeGreaterThan(5);
    const dropped = links.filter((href) => !href.includes("archived=1"));
    expect(dropped, "these registry filter links lose the archived toggle").toEqual([]);
  });

  it("shows nothing about archived plans when the workspace has none", () => {
    renderTable({ archivedCycleCount: 0 });
    expect(screen.queryByRole("link", { name: /archived plans/i })).toBeNull();
    expect(screen.queryByText(/archived plan/i)).toBeNull();
  });
});

describe("a cycle read out of a document says so", () => {
  it("labels the cycle with what was saved and what is waiting, and links to the queue", () => {
    renderTable({
      typedCycles: [cycle({ ...CURRENT, transcription: { acceptedCount: 18, waitingCount: 6 } })],
    });
    expect(screen.getByText(/Read from a document · 18 saved, 6 waiting/)).toBeInTheDocument();
    const review = screen.getByRole("link", { name: /Review 6 copied from a document/i });
    expect(review.getAttribute("href")).toBe("/rtp/cycle-current/extraction");
  });

  it("does not label a cycle nothing was copied into", () => {
    renderTable({
      typedCycles: [cycle({ ...CURRENT, transcription: { acceptedCount: 0, waitingCount: 0 } })],
    });
    expect(screen.queryByText(/Read from a document/i)).toBeNull();
  });

  it("says the counts are UNKNOWN when the read failed — never zero", () => {
    // A failed query is not a finding that nothing was copied out of this
    // agency's documents.
    renderTable({
      transcriptionCountsUnavailable: true,
      typedCycles: [cycle({ ...CURRENT, transcription: null })],
    });
    expect(screen.getByText(/Copied text unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/Read from a document/i)).toBeNull();
  });

  it("marks the counts as a floor when the scan hit its ceiling", () => {
    renderTable({
      transcriptionCountsTruncated: true,
      typedCycles: [cycle({ ...CURRENT, transcription: { acceptedCount: 900, waitingCount: 100 } })],
    });
    expect(screen.getByText(/\(at least\)/)).toBeInTheDocument();
  });

  it("shows no score, percentage or certainty anywhere on the row", () => {
    const { container } = renderTable({
      typedCycles: [cycle({ ...CURRENT, transcription: { acceptedCount: 18, waitingCount: 6 } })],
    });
    expect(container.textContent ?? "").not.toMatch(/confiden|certaint|likelihood|accuracy/i);
  });
});

/*
  MUTATION RESULTS — 2026-08-11, each applied to
  `src/app/(app)/rtp/_components/rtp-cycle-registry-table.tsx` and reverted.

  1. `archived: showArchived` deleted from the shared filter-state helper →
     FAILED "keeps the archived choice across every other filter link" (1).
     This is the defect the helper exists to prevent, and it is now measured.
  2. The hidden-count clause deleted from the "showing N cycles" sentence →
     FAILED "says how many are hidden" and "offers the way back, and says so"
     (2). Right reason: the registry hid three plans and said nothing.
  3. `transcriptionCountsUnavailable` short-circuited to `false`, so a failed
     read renders as no label at all →
     FAILED "says the counts are UNKNOWN when the read failed — never zero" (1).
  4. The "(at least)" truncation marker removed →
     FAILED "marks the counts as a floor when the scan hit its ceiling" (1).
  5. The toggle hardcoded to `archived: true`, making it a one-way door →
     FAILED "offers the way back, and says so, once they are shown" (1).
*/
