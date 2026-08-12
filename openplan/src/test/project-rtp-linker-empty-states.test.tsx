import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ProjectRtpLinker } from "@/components/projects/project-rtp-linker";

/**
 * An empty attachable list has TWO causes that mean opposite things.
 *
 * Found by creating the first project in a brand-new workspace: the panel said
 * "No RTP cycles linked yet. Attach one…" and then, directly beneath it,
 * "Every available RTP cycle in this workspace is already linked to this
 * project." Both were rendered at once, they contradict each other, and the one
 * that sounds like the work is finished came last — in a workspace that had no
 * RTP cycles at all.
 *
 * The vacuous reading of an empty set is what produced it: with zero cycles,
 * "all of them are linked" is technically true and completely misleading. The
 * planner's actual next step — create a cycle — appeared nowhere on the screen.
 */
function renderLinker(overrides: {
  availableCycles?: Parameters<typeof ProjectRtpLinker>[0]["availableCycles"];
  existingLinks?: Parameters<typeof ProjectRtpLinker>[0]["existingLinks"];
}) {
  return render(
    <ProjectRtpLinker
      projectId="11111111-1111-4111-8111-111111111111"
      availableCycles={overrides.availableCycles ?? []}
      existingLinks={overrides.existingLinks ?? []}
      availableRuns={[]}
      safetyEvidence={null}
      criteria={[]}
      canWrite
    />
  );
}

const CYCLE = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "2050 Metropolitan Transportation Plan",
  status: "draft",
  geographyLabel: "Columbus, OH",
  horizonStartYear: 2026,
  horizonEndYear: 2050,
};

describe("ProjectRtpLinker — an empty cycle list says which emptiness it is", () => {
  it("tells a new workspace to create a cycle instead of claiming they are all linked", () => {
    renderLinker({ availableCycles: [], existingLinks: [] });

    expect(screen.getByText(/This workspace has no RTP cycles yet/)).toBeInTheDocument();
    // The false completion claim, which is what this workspace used to render.
    expect(screen.queryByText(/already linked to this project/)).not.toBeInTheDocument();
    // And the only action that unblocks the form is reachable from here.
    expect(screen.getByRole("link", { name: "RTP Cycles" })).toHaveAttribute("href", "/rtp");
  });

  it("still says they are all linked when cycles exist and every one is attached", () => {
    renderLinker({
      availableCycles: [CYCLE],
      existingLinks: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          rtpCycleId: CYCLE.id,
          title: CYCLE.title,
          status: CYCLE.status,
          geographyLabel: CYCLE.geographyLabel,
          horizonStartYear: CYCLE.horizonStartYear,
          horizonEndYear: CYCLE.horizonEndYear,
          portfolioRole: "candidate",
          priorityRationale: null,
          priorityScores: {},
          evidenceModelRunId: null,
          modelingEvidence: null,
          evidenceRunDisclosure: null,
          horizonBands: [],
        } as unknown as Parameters<typeof ProjectRtpLinker>[0]["existingLinks"][number],
      ],
    });

    expect(screen.getByText(/Every RTP cycle in this workspace is already linked/)).toBeInTheDocument();
    expect(screen.queryByText(/This workspace has no RTP cycles yet/)).not.toBeInTheDocument();
  });
});
