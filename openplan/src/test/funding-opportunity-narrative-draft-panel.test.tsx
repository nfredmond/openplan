import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FundingOpportunityNarrativeDraftPanel,
  type FundingOpportunityNarrativeDraftRow,
} from "@/components/grants/funding-opportunity-narrative-draft-panel";

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function draftRow(
  overrides: Partial<FundingOpportunityNarrativeDraftRow> = {}
): FundingOpportunityNarrativeDraftRow {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    draft_markdown:
      "The project has a documented funding need. [fact:fact_1] Uncited filler sentence.",
    model: "claude-opus-4-8",
    source: "ai",
    created_at: "2026-07-17T00:00:00.000Z",
    grounding_json: {
      mode: "annotated",
      facts: [{ fact_id: "fact_1", claim_text: "Funding need: $2,000,000." }],
      sentences: [
        {
          text: "The project has a documented funding need. [fact:fact_1]",
          cited_fact_ids: ["fact_1"],
          is_grounded: true,
          unknown_fact_ids: [],
        },
        {
          text: "Uncited filler sentence.",
          cited_fact_ids: [],
          is_grounded: false,
          unknown_fact_ids: [],
        },
      ],
      dropped_sentences: [],
      cited_fact_ids: ["fact_1"],
      unknown_fact_ids: [],
      grounded_sentence_count: 1,
      total_sentence_count: 2,
      is_fully_grounded: false,
    },
    grounded_sentence_count: 1,
    total_sentence_count: 2,
    ...overrides,
  };
}

describe("FundingOpportunityNarrativeDraftPanel grounding", () => {
  it("shows the grounding line with grounded/total sentence counts", () => {
    render(
      <FundingOpportunityNarrativeDraftPanel opportunityId={OPPORTUNITY_ID} initialDraft={draftRow()} />
    );

    expect(screen.getByTestId("narrative-grounding-line")).toHaveTextContent(
      "1 of 2 sentences cite verifiable workspace facts"
    );
  });

  it("lists flagged sentences behind the details disclosure", () => {
    render(
      <FundingOpportunityNarrativeDraftPanel opportunityId={OPPORTUNITY_ID} initialDraft={draftRow()} />
    );

    const disclosure = screen.getByText("1 sentence flagged for operator review");
    fireEvent.click(disclosure);

    expect(screen.getByText("Uncited filler sentence.")).toBeInTheDocument();
    expect(screen.getByText("— no citation")).toBeInTheDocument();
  });

  it("labels unknown-citation sentences with the unknown fact ids", () => {
    render(
      <FundingOpportunityNarrativeDraftPanel
        opportunityId={OPPORTUNITY_ID}
        initialDraft={draftRow({
          grounding_json: {
            mode: "annotated",
            facts: [],
            sentences: [
              {
                text: "Ghost claim. [fact:fact_9]",
                cited_fact_ids: ["fact_9"],
                is_grounded: false,
                unknown_fact_ids: ["fact_9"],
              },
            ],
            dropped_sentences: [],
            cited_fact_ids: ["fact_9"],
            unknown_fact_ids: ["fact_9"],
            grounded_sentence_count: 0,
            total_sentence_count: 1,
            is_fully_grounded: false,
          },
          grounded_sentence_count: 0,
          total_sentence_count: 1,
        })}
      />
    );

    expect(screen.getByText("— unknown fact id: fact_9")).toBeInTheDocument();
  });

  it("labels unfaithful-citation sentences with the unsupported figures", () => {
    render(
      <FundingOpportunityNarrativeDraftPanel
        opportunityId={OPPORTUNITY_ID}
        initialDraft={draftRow({
          grounding_json: {
            mode: "annotated",
            facts: [{ fact_id: "fact_3", claim_text: "Local match committed: $750,000." }],
            sentences: [
              {
                text: "The expected award is $900,000. [fact:fact_3]",
                cited_fact_ids: ["fact_3"],
                is_grounded: false,
                unknown_fact_ids: [],
                unfaithful_claims: ["900000"],
              },
            ],
            dropped_sentences: [],
            cited_fact_ids: ["fact_3"],
            unknown_fact_ids: [],
            grounded_sentence_count: 0,
            total_sentence_count: 1,
            is_fully_grounded: false,
            faithfulness_checked: true,
          },
          grounded_sentence_count: 0,
          total_sentence_count: 1,
        })}
      />
    );

    // The fabricated figure the belt caught is shown, not a blank
    // "unknown fact ids" label.
    expect(screen.getByText("— figure not in cited facts: 900000")).toBeInTheDocument();
  });

  it("strips [fact:N] tokens from the rendered markdown but keeps them for copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <FundingOpportunityNarrativeDraftPanel opportunityId={OPPORTUNITY_ID} initialDraft={draftRow()} />
    );

    // Rendered prose has no citation tokens.
    expect(
      screen.getByText(/The project has a documented funding need\. Uncited filler sentence\./)
    ).toBeInTheDocument();
    expect(document.querySelector(".chapter-markdown")?.textContent).not.toContain("[fact:");

    // The copied markdown is the stored draft, tokens included.
    fireEvent.click(screen.getByRole("button", { name: /copy markdown/i }));
    expect(writeText).toHaveBeenCalledWith(
      "The project has a documented funding need. [fact:fact_1] Uncited filler sentence."
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument());
  });

  it("notes when a draft predates grounding validation", () => {
    render(
      <FundingOpportunityNarrativeDraftPanel
        opportunityId={OPPORTUNITY_ID}
        initialDraft={draftRow({
          grounding_json: null,
          grounded_sentence_count: null,
          total_sentence_count: null,
        })}
      />
    );

    expect(screen.getByTestId("narrative-grounding-line")).toHaveTextContent(
      "Grounding check not recorded for this draft"
    );
  });
});
