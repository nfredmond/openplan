import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * THE IN-APP HALF OF PROVENANCE, and the door to the review screen.
 *
 * Q2 (Nathaniel, 2026-08-11) puts a transcribed figure's source and page
 * everywhere the figure appears. The public page and the export body are
 * guarded in their own files; this one is the financial element a planner
 * edits, where the same rule has to hold against the two BIG client editors
 * that render the ledger and the measures.
 *
 * AND REACHABILITY. A capability nobody can reach from the surface it serves is
 * this repository's most expensive recurring defect — eleven instances and
 * counting. The review screen is a page with no navigation of its own, so the
 * link from the financial element is the only way a planner arrives at it, and
 * that link is asserted here rather than assumed.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { RtpFinancialElementSection } from "@/app/(app)/rtp/[rtpCycleId]/_components/rtp-financial-element-section";
import type { TranscriptionRecord } from "@/lib/rtp/extraction/display";

const CYCLE_ID = "cycle-1";
const BAND_ID = "band-near";

const transcribedLine: TranscriptionRecord = {
  candidateId: "candidate-1",
  kbDocumentId: "document-1",
  documentTitle: "Example Region RTP 2050 (adopted)",
  page: 112,
  quote: "Federal STBG revenue of $412 million is assumed over the near-term period.",
  divergentFields: [],
};

const transcribedMeasure: TranscriptionRecord = {
  candidateId: "candidate-2",
  kbDocumentId: "document-1",
  documentTitle: "Example Region RTP 2050 (adopted)",
  page: 88,
  quote: "There were 48 fatalities and serious injuries in 2024.",
  divergentFields: [],
};

function renderSection(
  transcriptions: Record<string, TranscriptionRecord> = {
    "line-transcribed": transcribedLine,
    "measure-transcribed": transcribedMeasure,
  }
) {
  return render(
    <RtpFinancialElementSection
      rtpCycleId={CYCLE_ID}
      cycleHorizonStartYear={2026}
      cycleHorizonEndYear={2050}
      cycleFinancialBasisYear={2026}
      annualInflationRate={null}
      projects={[]}
      readFailed={false}
      bands={[
        {
          id: BAND_ID,
          label: "Near-term",
          startYear: 2026,
          endYear: 2035,
          escalationTargetYear: null,
          costEstimateBasis: "itemized",
          sortOrder: 0,
        },
      ]}
      lines={[
        {
          id: "line-transcribed",
          horizonBandId: BAND_ID,
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: "412000000.00",
          amountBasisYear: 2026,
          notes: null,
        },
        {
          id: "line-typed",
          horizonBandId: BAND_ID,
          entryKind: "revenue",
          sourceName: "Local sales tax",
          amount: "80000000.00",
          amountBasisYear: 2026,
          notes: null,
        },
      ]}
      measures={[
        {
          id: "measure-transcribed",
          measureKey: "fatalities",
          label: "Fatalities and serious injuries",
          unit: "people",
          baselineValue: 48,
          baselineYear: 2024,
          targetValue: 24,
          targetYear: 2035,
          dataSource: "State crash records",
          notes: null,
          sortOrder: 0,
        },
        {
          id: "measure-typed",
          measureKey: "mode_share",
          label: "Walking and cycling mode share",
          unit: "percent",
          baselineValue: 6,
          baselineYear: 2024,
          targetValue: 10,
          targetYear: 2035,
          dataSource: "Agency travel survey",
          notes: null,
          sortOrder: 1,
        },
      ]}
      measuresReadFailed={false}
      canWrite
      lineTranscriptions={transcriptions}
      measureTranscriptions={transcriptions}
    />
  );
}

describe("the way into the document review", () => {
  it("links to it from the financial element, where a planner would otherwise retype the table", () => {
    renderSection();
    const link = screen.getByRole("link", { name: /Copy these figures out of the plan document/i });
    expect(link.getAttribute("href")).toBe(`/rtp/${CYCLE_ID}/extraction`);
  });
});

describe("a ledger line copied out of a document", () => {
  it("cites its document and page beside the figure", () => {
    renderSection();
    const chip = screen.getByText("From “Example Region RTP 2050 (adopted)”, p. 112");
    expect(chip.closest("a")?.getAttribute("href")).toBe(
      "/api/knowledge-base/documents/document-1/download"
    );
  });

  it("carries the document's own words for a screen reader", () => {
    renderSection();
    expect(
      screen.getByText(
        /The document says: Federal STBG revenue of \$412 million is assumed over the near-term period\./
      )
    ).toBeTruthy();
  });
});

describe("a line a planner typed", () => {
  it("shows no citation at all", () => {
    const { container } = renderSection();
    const typed = within(container).getByText("Local sales tax").closest("li");
    expect(typed).toBeTruthy();
    expect(typed?.textContent ?? "").not.toMatch(/From “/);
    expect(typed?.textContent ?? "").not.toMatch(/p\. \d+/);
  });

  it("leaves exactly two citations on a section with two transcribed rows", () => {
    renderSection();
    expect(screen.getAllByText(/^From “Example Region RTP 2050 \(adopted\)”/).length).toBe(2);
  });

  it("shows none at all when nothing in the plan was transcribed", () => {
    const { container } = renderSection({});
    expect(container.textContent ?? "").not.toMatch(/From “/);
  });
});

describe("a measure copied out of a document", () => {
  it("cites the page its baseline was read off", () => {
    renderSection();
    expect(screen.getByText("From “Example Region RTP 2050 (adopted)”, p. 88")).toBeTruthy();
  });
});

describe("a figure edited after it was accepted", () => {
  it("says so instead of citing a page that no longer matches it", () => {
    renderSection({
      "line-transcribed": {
        ...transcribedLine,
        divergentFields: [
          {
            key: "amount",
            label: "Amount",
            kind: "money",
            documentValue: 412_000_000,
            recordedValue: 390_000_000,
            same: false,
          },
        ],
      },
    });

    expect(
      screen.getByText("From “Example Region RTP 2050 (adopted)”, p. 112 — edited since")
    ).toBeTruthy();
  });
});

/*
  MUTATION RESULTS, 2026-08-11. Each applied, this file RUN, then restored:

    - the `<Link>` to `/rtp/{id}/extraction` removed from
      `rtp-financial-element-section.tsx` → "links to it from the financial
      element" fails. Without it the whole lane is a shipped-invisible
      capability: the review page exists, builds, and nothing reaches it.
    - `transcriptions?.[line.id]` in the ledger editor replaced with the first
      value of the map → 5 failures, including "shows no citation at all" and
      "leaves exactly two citations": the hand-typed Local sales tax line gains
      a citation to page 112 of a document it never came from.
    - the chip element deleted from the ledger editor's row → 4 failures.
    - `lineTranscriptions` dropped from the section's pass-through to the ledger
      editor → 4 failures. That is the seam a props rename would otherwise break
      in silence, since the editor's prop is optional.
*/
