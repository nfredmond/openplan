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
});
