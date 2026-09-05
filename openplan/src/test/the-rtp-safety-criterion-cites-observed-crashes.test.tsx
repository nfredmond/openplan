import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { collectAgentReachableSources } from "./helpers/reachable-write-surface";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { RtpPriorityScoreEditor } from "@/components/projects/rtp-priority-score-editor";
import { RTP_PRIORITY_CRITERIA } from "@/lib/rtp/priority-criteria";
import { resolveRtpPriorityCriteria } from "@/lib/rtp/priority-frameworks";
import { US_CA_RTP_PRIORITY_FRAMEWORK } from "@/lib/rtp/frameworks/us-ca";
import {
  RTP_SAFETY_EVIDENCE_INFORMS_ONLY,
  summarizeRtpSafetyEvidence,
  type RtpSafetyEvidence,
} from "@/lib/rtp/safety-evidence";
import {
  buildSafetyCrashEvidence,
  type SafetyCrashEvidenceIngest,
  type SafetyCrashRoleCounts,
  type SafetyCrashSeverityCounts,
} from "@/lib/safety/crash-evidence";
import { buildRtpPriorityRationale, computeRtpPriorityScore } from "@/lib/rtp/priority-scoring";

/**
 * THE DEAD SEAM THIS FILE GUARDS.
 *
 * `RtpPriorityCriterion.evidence` was declared on all eight criteria and read by
 * NOTHING — the modeling evidence was rendered by a hard-coded block above the
 * criteria list, so the field was a column nothing reads and the safety
 * criterion sat on `"manual"` while the workspace held an acquisition of the
 * actual collisions. This asserts three things that together make the seam real
 * and keep it honest:
 *
 *   1. The taxonomy says the safety criterion has crash evidence.
 *   2. The editor RENDERS that evidence, driven by the marker rather than by a
 *      second hard-coded block — proven by mutating the marker.
 *   3. The evidence never moves the score. That is the load-bearing one: an
 *      observed-crash count is not a project's expected benefit, and a derived
 *      safety rating would be a machine authoring a judgement into an adopted
 *      plan.
 *
 * The criteria come from the REAL resolver, not a fixture. A hand-written
 * criterion list would let this file pass while the shipped taxonomy still said
 * `"manual"` — the described-fixture failure this repository has already had.
 */

const CA_CRITERIA = resolveRtpPriorityCriteria(US_CA_RTP_PRIORITY_FRAMEWORK);

function ingest(over: Partial<SafetyCrashEvidenceIngest> = {}): SafetyCrashEvidenceIngest {
  return {
    id: "ingest-7",
    projectId: "project-1",
    status: "ready",
    sourceLabel: "Statewide crash reporting system",
    attribution: "Source agency (public domain).",
    severityCompleteness: "kabco_full",
    crashCount: 1180,
    geocodedCount: 1089,
    truncated: false,
    yearsRequested: [2021, 2022, 2023, 2024, 2025],
    createdAt: "2026-08-11T00:00:00.000Z",
    dimensionCoverage: {},
    partyCompleteness: "retrieved",
    partyCount: 2100,
    involvementBasis: "party_rows",
    ...over,
  };
}

const SEVERITY: SafetyCrashSeverityCounts = {
  fatal: 12,
  severe_injury: 40,
  injury: 400,
  pdo: 600,
  unknown: 37,
};

const ROLES: SafetyCrashRoleCounts = {
  driver: 1800,
  passenger: 150,
  pedestrian: 60,
  bicyclist: 55,
  motorcyclist: 30,
  parked_vehicle: 5,
  other: 0,
  unknown: 0,
};

function evidenceFor(over: Partial<SafetyCrashEvidenceIngest> = {}): RtpSafetyEvidence {
  return summarizeRtpSafetyEvidence(
    buildSafetyCrashEvidence(ingest(over), { severity: SEVERITY, role: ROLES })
  );
}

function renderEditor(safetyEvidence: RtpSafetyEvidence | null) {
  const rendered = render(
    <RtpPriorityScoreEditor
      projectId="p1"
      linkId="link-1"
      initialScores={{}}
      availableRuns={[]}
      initialEvidenceRunId={null}
      modelingEvidence={null}
      evidenceRunDisclosure={null}
      safetyEvidence={safetyEvidence}
      criteria={CA_CRITERIA}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Priority scoring/ }));
  return rendered;
}

describe("the RTP safety criterion cites observed crashes", () => {
  it("declares crash evidence on the safety criterion in the SHIPPED taxonomy", () => {
    const safety = RTP_PRIORITY_CRITERIA.find((criterion) => criterion.key === "safety");
    expect(safety).toBeDefined();
    expect(safety!.evidence).toBe("safety_crashes");
    // And the resolver carries the marker through to what the editor is handed
    // — a marker that stopped at the taxonomy would render nothing.
    expect(CA_CRITERIA.find((criterion) => criterion.key === "safety")?.evidence).toBe(
      "safety_crashes"
    );
  });

  it("shows the observed severe-crash figure beside the rating without calling crashes people", () => {
    renderEditor(evidenceFor());
    // 12 fatal + 40 severe injury, from a source that separates serious injuries.
    expect(screen.getByText(/52 fatal or serious-injury crashes/)).toBeTruthy();
    expect(screen.queryByText(/52 killed or seriously injured/)).toBeNull();
    expect(screen.getByText(/1,089 collisions mapped/)).toBeTruthy();
    // People, from the person rows — the count no crash-level flag can produce.
    expect(screen.getByText(/145 people walking, cycling or riding a motorcycle/)).toBeTruthy();
  });

  it("carries the citation and the coverage caveats with the numbers", () => {
    renderEditor(evidenceFor());
    expect(screen.getByText(/Source ingest ingest-7/)).toBeTruthy();
    // Computed from THIS extract, never a constant: 1,089 of 1,180 mapped.
    expect(screen.getByText(/91 of the 1,180 reported crashes/)).toBeTruthy();
    // The 37 collisions the source gave no casualty count for are named, so the
    // bands visibly do not have to add up to the total.
    expect(screen.getByText(/37 of these collisions carry no casualty count/)).toBeTruthy();
  });

  /**
   * WHY THIS IS NOT `getByText(RTP_SAFETY_EVIDENCE_INFORMS_ONLY)`.
   *
   * It was, and that assertion proved nothing: looking the rendered text up BY
   * the constant passes for any value the constant holds. Replacing the sentence
   * with filler kept the suite green — the screen would have said something
   * meaningless in the one place that tells a reader these numbers are not the
   * score, and no test would have noticed.
   *
   * So the meaning is asserted, in three clauses, against text found by a
   * pattern the constant does not supply. A string assertion is the honest
   * instrument for the first two — the sentence IS the surface, and there is no
   * behaviour to observe instead — but it is pinned to the load-bearing clauses
   * rather than to the whole wording, so the sentence can still be rewritten for
   * a planner without a test standing in the way. The third clause has a
   * consequence behind it as well, asserted in the two tests below.
   */
  it("says on screen that the evidence informs the rating and does not set it", () => {
    const { unmount } = renderEditor(evidenceFor());

    const line = screen.getByText(/do not set it/i);
    expect(line.textContent).toMatch(/inform(s)? this rating/i);
    expect(line.textContent).toMatch(/not derive a priority score/i);
    unmount();

    // The same statement travels with the empty state, because a planner with no
    // acquisition is the reader most likely to expect a number to appear later
    // and set the rating for them.
    renderEditor(null);
    expect(screen.getByText(/do not set it/i).textContent).toMatch(/not derive a priority score/i);
  });

  it("keeps the three clauses in the constant itself, so filler cannot replace it", () => {
    // Clause-level, deliberately: what must survive a rewording is (1) that the
    // evidence informs, (2) that it does not set the rating, and (3) that
    // OpenPlan will not derive a score from it. Asserting the full sentence
    // would make a copy edit a test failure; asserting nothing made filler text
    // a passing build.
    expect(RTP_SAFETY_EVIDENCE_INFORMS_ONLY).toMatch(/inform(s)? this rating/i);
    expect(RTP_SAFETY_EVIDENCE_INFORMS_ONLY).toMatch(/do not set it/i);
    expect(RTP_SAFETY_EVIDENCE_INFORMS_ONLY).toMatch(/will not derive a priority score/i);
  });

  it("gives the scoring engine no path to the crash evidence at all", () => {
    // THE CONSEQUENCE BEHIND THE SENTENCE. A promise that OpenPlan will not
    // derive a priority score from observed collisions is only worth the
    // arithmetic it forbids, so the module that produces the composite is walked
    // — through the functions it actually calls, not just its own file — and must
    // never reach the safety lane. Deriving a rating from crash counts would
    // require an import this fails on.
    const reachable = collectAgentReachableSources(
      path.join(process.cwd(), "src", "lib", "rtp", "priority-scoring.ts")
    );

    // The walk must actually go somewhere, or "reaches no safety module" is true
    // of an empty set.
    const files = reachable.map((chunk) => path.relative(process.cwd(), chunk.file));
    expect(files.some((file) => file.endsWith(path.join("rtp", "priority-criteria.ts")))).toBe(true);

    const safetyReach = files.filter(
      (file) =>
        file.startsWith(path.join("src", "lib", "safety")) ||
        file.endsWith(path.join("rtp", "safety-evidence.ts")) ||
        file.endsWith(path.join("safety", "crash-evidence.ts"))
    );
    expect(safetyReach, "the composite score can see crash evidence").toEqual([]);

    // And the score functions take no evidence argument to be handed one.
    expect(buildRtpPriorityRationale.length).toBe(2);
    expect(computeRtpPriorityScore.length).toBe(1);
  });

  it("leaves the safety rating and the composite untouched no matter what the crashes say", () => {
    // THE REFUSAL, asserted rather than described. Twelve deaths on the corridor
    // must not move the planner's rating by itself; if it ever does, a machine
    // has authored a priority score into an adopted plan.
    const { unmount } = renderEditor(evidenceFor());
    const withEvidence = (screen.getByLabelText("Rate: Improves safety") as HTMLSelectElement).value;
    expect(withEvidence).toBe("0");
    unmount();

    renderEditor(null);
    expect((screen.getByLabelText("Rate: Improves safety") as HTMLSelectElement).value).toBe("0");

    // And the composite is a pure function of the planner's scores — the
    // evidence is not an input to it at all.
    expect(buildRtpPriorityRationale({}, CA_CRITERIA).summary.composite).toBe(0);
  });

  it("says a missing acquisition is a gap in retrieval, never that no collisions occurred", () => {
    renderEditor(null);
    const line = screen.getByText(/No crash acquisition is linked to this project/);
    expect(line.textContent).toMatch(/not a finding that no collisions occurred/i);
    // And the planner is sent somewhere they can fix it.
    expect(screen.getByRole("link", { name: /Retrieve crash data/ }).getAttribute("href")).toBe(
      "/safety"
    );
  });

  it("refuses to print a KSI figure from a source that cannot separate serious injuries", () => {
    // Zero would read as "no serious injuries", on the exact measure a safety
    // grant is scored on. The line says the source cannot separate them instead.
    renderEditor(evidenceFor({ severityCompleteness: "fatal_injury_only" }));
    expect(screen.getByText(/serious injuries not separated by this source/)).toBeTruthy();
    expect(screen.queryByText(/killed or seriously injured/)).toBeNull();
  });

  it("does not report zero people when person rows were never retrieved", () => {
    renderEditor(
      summarizeRtpSafetyEvidence(
        buildSafetyCrashEvidence(ingest({ partyCompleteness: "not_retrieved" }), {
          severity: SEVERITY,
          role: null,
        })
      )
    );
    expect(screen.queryByText(/0 people walking/)).toBeNull();
    expect(screen.getByText(/Person-level records were not retrieved/)).toBeTruthy();
  });

  it("names a failed count read as a failure, not as an absence of collisions", () => {
    renderEditor(
      summarizeRtpSafetyEvidence(
        buildSafetyCrashEvidence(ingest(), { severity: null, role: null })
      )
    );
    expect(
      screen.getByText(/crash counts could not be read — a lookup failure/)
    ).toBeTruthy();
  });
});
