import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtpChapterDraftAssist } from "@/components/rtp/rtp-chapter-draft-assist";

const CYCLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const DRAFT_WITH_TOKENS =
  "The cycle is in draft. [fact:fact_1] One project is constrained. [fact:fact_2]";
const DRAFT_STRIPPED = "The cycle is in draft. One project is constrained.";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe("RtpChapterDraftAssist", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drafts, then inserts token-stripped markdown into the editor and records acceptance", async () => {
    const onInsert = vi.fn();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse(
          {
            draft: {
              id: DRAFT_ID,
              draft_markdown: DRAFT_WITH_TOKENS,
              model: "claude-opus-4-8",
              status: "draft",
              grounded_sentence_count: 2,
              total_sentence_count: 2,
            },
          },
          201
        );
      }
      return jsonResponse({
        draft: {
          id: DRAFT_ID,
          draft_markdown: DRAFT_WITH_TOKENS,
          model: "claude-opus-4-8",
          status: "accepted",
        },
      });
    });

    render(
      <RtpChapterDraftAssist rtpCycleId={CYCLE_ID} chapterId={CHAPTER_ID} onInsert={onInsert} />
    );

    fireEvent.click(screen.getByRole("button", { name: /draft chapter narrative/i }));

    await waitFor(() => {
      expect(screen.getByTestId("rtp-chapter-draft-insert")).toBeInTheDocument();
    });

    // The preview shows the token-stripped prose, never citation tokens.
    expect(screen.getByText(DRAFT_STRIPPED)).toBeInTheDocument();
    expect(screen.queryByText(/\[fact:/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("rtp-chapter-draft-insert"));

    await waitFor(() => {
      expect(screen.getByTestId("rtp-chapter-draft-inserted")).toBeInTheDocument();
    });

    // The editor receives the STRIPPED markdown — content_markdown stays the
    // operator's own text, with no provenance tokens leaking into the plan.
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(DRAFT_STRIPPED);

    // The stored row flips to accepted purely as provenance.
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCall).toBeDefined();
    expect(patchCall?.[0]).toBe(`/api/rtp-cycles/${CYCLE_ID}/chapters/${CHAPTER_ID}/draft`);
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toMatchObject({
      action: "accept",
      draftId: DRAFT_ID,
      acceptedMarkdown: DRAFT_STRIPPED,
    });
  });

  it("shows the grounding stats for the generated draft", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          draft: {
            id: DRAFT_ID,
            draft_markdown: DRAFT_WITH_TOKENS,
            model: "claude-opus-4-8",
            status: "draft",
            grounded_sentence_count: 1,
            total_sentence_count: 2,
          },
        },
        201
      )
    );

    render(<RtpChapterDraftAssist rtpCycleId={CYCLE_ID} chapterId={CHAPTER_ID} onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /draft chapter narrative/i }));

    await waitFor(() => {
      expect(screen.getByTestId("narrative-grounding-line")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/1 of 2 sentences cite verifiable workspace facts/i)
    ).toBeInTheDocument();
  });

  it("states the offline posture on a 503 ai_offline answer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "ai_offline" }, 503));

    render(<RtpChapterDraftAssist rtpCycleId={CYCLE_ID} chapterId={CHAPTER_ID} onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /draft chapter narrative/i }));

    await waitFor(() => {
      expect(screen.getByText(/AI drafting is offline/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("rtp-chapter-draft-insert")).not.toBeInTheDocument();
  });

  /**
   * DRAFTING IS ALLOWED WHILE THE FISCAL VERDICT IS UNDETERMINED — THE STATE
   * JUST MAY NOT ARRIVE QUIETLY.
   *
   * Nathaniel's decision, 2026-08-08: the chapter may still be drafted, because
   * refusing leaves a planner with no starting text for the section they most
   * need help with. What is not acceptable is the earlier behaviour, where a
   * cycle with no revenue produced prose claiming "the revenues anticipated …
   * are sufficient to cover the costs" and the only warning was a grounding
   * flag reading "no citation" — procedural wording that reads as "add a
   * source" rather than "your own finding says otherwise".
   *
   * So the panel states the finding itself, above the paragraph, in the
   * operator's reading order.
   */
  function draftPayloadWithFiscal(fiscalConstraint: unknown) {
    return {
      draft: {
        id: DRAFT_ID,
        draft_markdown: DRAFT_WITH_TOKENS,
        model: "claude-haiku-4-5",
        status: "draft",
        grounded_sentence_count: 1,
        total_sentence_count: 2,
      },
      fiscalConstraint,
    };
  }

  it("alerts the operator when the plan's fiscal constraint is not determined", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        draftPayloadWithFiscal({
          verdict: "not_determined",
          blockers: [
            { code: "no_revenue_recorded", detail: "No revenue assumptions have been recorded." },
          ],
        }),
        201
      )
    );

    render(<RtpChapterDraftAssist rtpCycleId={CYCLE_ID} chapterId={CHAPTER_ID} onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /draft chapter narrative/i }));

    const alert = await screen.findByTestId("chapter-draft-fiscal-alert");
    expect(alert).toHaveTextContent(/fiscal constraint is not determined/i);
    // The prohibition names the claim that actually shipped, not a vague caution.
    expect(alert).toHaveTextContent(/may state or imply that the plan is fiscally constrained/i);
    expect(alert).toHaveTextContent(/revenues cover programmed costs/i);
    // The engine's own blocker, so the planner knows what would settle it.
    expect(alert).toHaveTextContent(/No revenue assumptions have been recorded/i);

    // ...and drafting is NOT blocked. The draft is still offered for insertion.
    expect(screen.getByTestId("rtp-chapter-draft-insert")).toBeInTheDocument();
    expect(screen.getByText(DRAFT_STRIPPED)).toBeInTheDocument();
  });

  it("does not alert when the verdict is settled", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(draftPayloadWithFiscal({ verdict: "constrained", blockers: [] }), 201)
    );

    render(<RtpChapterDraftAssist rtpCycleId={CYCLE_ID} chapterId={CHAPTER_ID} onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /draft chapter narrative/i }));

    await waitFor(() => {
      expect(screen.getByTestId("narrative-grounding-line")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("chapter-draft-fiscal-alert")).not.toBeInTheDocument();
  });

  /**
   * A ledger that could not be READ sends null. Alerting "not determined" there
   * would assert a finding the route never made — the same false certainty the
   * alert exists to prevent, pointed the other way.
   */
  it("does not invent a verdict when none was sent", async () => {
    fetchMock.mockResolvedValue(jsonResponse(draftPayloadWithFiscal(null), 201));

    render(<RtpChapterDraftAssist rtpCycleId={CYCLE_ID} chapterId={CHAPTER_ID} onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /draft chapter narrative/i }));

    await waitFor(() => {
      expect(screen.getByTestId("narrative-grounding-line")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("chapter-draft-fiscal-alert")).not.toBeInTheDocument();
  });
});
