import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE TWO CARDS A PLANNER ACTUALLY TOUCHES, and the rules they enforce on the
 * screen rather than in a comment.
 *
 * THE PAIRING IS A HUMAN JUDGEMENT. The chapter picker starts empty and staging
 * is refused until somebody chooses. A default would be a machine deciding
 * which of an adopted plan's paragraphs become the next plan's policy — Q6's
 * rule for projects (the document names it, the person binds it), applied to
 * prose.
 *
 * ACCEPT IS NOT PUBLISH. `rtp_cycle_chapters.content_markdown` is written by
 * the chapter editor and by nothing else, so the card that offers "Accept this
 * text" has to say what accepting does. A card where accept reads as publish is
 * how a quotation ends up in a public plan nobody put there.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

import { TranscribedChapterBlockCard } from "@/components/rtp/transcribed-chapter-block-card";
import { TranscribedChapterDraftCard } from "@/components/rtp/transcribed-chapter-draft-card";
import { buildTranscribedChapterGrounding } from "@/lib/rtp/extraction/chapter-blocks";

const CYCLE_ID = "cycle-1";
const CHAPTER_ID = "chapter-safety";
const CANDIDATE_ID = "candidate-1";
const QUOTE =
  "Goal 3: Reduce fatalities and serious injuries on the regional roadway network to zero by 2050.";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ draft: { id: "draft-1", status: "accepted" } }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBlockCard(overrides: Partial<Parameters<typeof TranscribedChapterBlockCard>[0]> = {}) {
  return render(
    <TranscribedChapterBlockCard
      rtpCycleId={CYCLE_ID}
      candidate={{ id: CANDIDATE_ID, page: 112, quote: QUOTE, blockedReason: null }}
      chapters={[
        { id: CHAPTER_ID, title: "Safety" },
        { id: "chapter-finance", title: "Financial element" },
      ]}
      documentTitle="2020 Regional Transportation Plan"
      documentHref="/api/knowledge-base/documents/doc-1/download"
      canWrite
      {...overrides}
    />
  );
}

describe("placing a copied block", () => {
  it("shows the plan's own words and the page they are printed on", () => {
    renderBlockCard();
    expect(screen.getByText(QUOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2020 Regional Transportation Plan, page 112/ })).toBeInTheDocument();
  });

  it("picks NO chapter for the planner", () => {
    renderBlockCard();
    const select = screen.getByLabelText(/which chapter is this for\?/i) as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("refuses to stage until a chapter is chosen, and calls nothing", async () => {
    renderBlockCard();
    fireEvent.click(screen.getByRole("button", { name: /put into this chapter/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/choose which chapter/i)).toBeInTheDocument();
  });

  it("posts ONE passage to the chapter the planner chose", async () => {
    renderBlockCard();
    fireEvent.change(screen.getByLabelText(/which chapter is this for\?/i), { target: { value: CHAPTER_ID } });
    fireEvent.click(screen.getByRole("button", { name: /put into this chapter/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/rtp-cycles/${CYCLE_ID}/chapters/${CHAPTER_ID}/transcribed-blocks`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ fromExtractionCandidateId: CANDIDATE_ID });
  });

  it("posts under the field name the acceptance module owns", async () => {
    // The card cannot IMPORT that constant — `acceptance.ts` reaches
    // `next/headers` through the Supabase server client and a client component
    // that imports it fails the production build. So the literal in the card is
    // tied to the real name here, where a server module is importable. Rename
    // one without the other and this fails.
    const { FROM_EXTRACTION_CANDIDATE_FIELD } = await import("@/lib/rtp/extraction/acceptance");

    renderBlockCard();
    fireEvent.change(screen.getByLabelText(/which chapter is this for\?/i), {
      target: { value: CHAPTER_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: /put into this chapter/i }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([FROM_EXTRACTION_CANDIDATE_FIELD]);
  });

  it("offers no way to stage many at once", () => {
    renderBlockCard();
    const labels = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    expect(labels.join(" ")).not.toMatch(/all|every|bulk/i);
  });

  it("says the block is NOT in the plan after staging it", async () => {
    renderBlockCard();
    fireEvent.change(screen.getByLabelText(/which chapter is this for\?/i), { target: { value: CHAPTER_ID } });
    fireEvent.click(screen.getByRole("button", { name: /put into this chapter/i }));
    expect(await screen.findByText(/It is not in the plan yet/i)).toBeInTheDocument();
  });

  it("offers no staging at all for a block that cannot be staged, and says why", () => {
    renderBlockCard({
      candidate: {
        id: CANDIDATE_ID,
        page: 112,
        quote: QUOTE,
        blockedReason: "The text and the quoted page do not match word for word.",
      },
    });
    expect(screen.queryByRole("button", { name: /put into this chapter/i })).toBeNull();
    expect(screen.getByText(/do not match word for word/i)).toBeInTheDocument();
    // Setting it aside stays available: a planner must be able to clear it.
    expect(screen.getByRole("button", { name: /set aside/i })).toBeInTheDocument();
  });

  it("gives a reader nothing to press", () => {
    renderBlockCard({ canWrite: false });
    expect(screen.queryByRole("button", { name: /put into this chapter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set aside/i })).toBeNull();
    expect(screen.getByText(/needs permission to change plans/i)).toBeInTheDocument();
  });
});

describe("a block already waiting in a chapter", () => {
  const grounding = buildTranscribedChapterGrounding(
    { candidateId: CANDIDATE_ID, text: QUOTE, page: 112, quote: QUOTE, chunkRecheck: "matched" },
    { kbDocumentId: "doc-1", documentTitle: "2020 Regional Transportation Plan" }
  );

  function renderDraftCard(overrides: Partial<Parameters<typeof TranscribedChapterDraftCard>[0]> = {}) {
    return render(
      <TranscribedChapterDraftCard
        rtpCycleId={CYCLE_ID}
        chapterId={CHAPTER_ID}
        draft={{
          id: "draft-1",
          status: "draft",
          draftMarkdown: `> ${QUOTE}\n>\n> — Copied from “2020 Regional Transportation Plan”, page 112`,
          acceptedMarkdown: null,
          groundingJson: JSON.parse(JSON.stringify(grounding)) as unknown,
        }}
        documentHref="/api/knowledge-base/documents/doc-1/download"
        canWrite
        {...overrides}
      />
    );
  }

  it("badges the block as transcribed, naming the document and page", () => {
    renderDraftCard();
    expect(screen.getByText(/Transcribed — not written by anyone/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Copied from “2020 Regional Transportation Plan”, page 112/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/Nobody wrote this text/i)).toBeInTheDocument();
  });

  it("says plainly that accepting does not put it in the plan", () => {
    renderDraftCard();
    expect(screen.getByText(/It does not put it in the plan/i)).toBeInTheDocument();
  });

  it("accepts through the chapter's own draft review, writing no chapter content", async () => {
    renderDraftCard();
    fireEvent.click(screen.getByRole("button", { name: /accept this text/i }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/rtp-cycles/${CYCLE_ID}/chapters/${CHAPTER_ID}/draft`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ action: "accept", draftId: "draft-1" });
  });

  it("shows no score or certainty anywhere", () => {
    const { container } = renderDraftCard();
    expect(container.textContent ?? "").not.toMatch(/confiden|certaint|likelihood|probabilit|\d+\s?%/i);
  });
});

/*
  MUTATION RESULTS — 2026-08-11, each applied to the component and reverted.

  1. The chapter picker defaulted to `chapters[0].id` →
     FAILED "picks NO chapter for the planner" and "refuses to stage until a
     chapter is chosen" (2). Right reason: OpenPlan chose the chapter.
  2. The `if (!chapterId)` guard short-circuited →
     FAILED "refuses to stage until a chapter is chosen, and calls nothing" (1).
  3. A blocked block offered the stage button anyway →
     FAILED "offers no staging at all for a block that cannot be staged" (1).
  4. The draft card's accept re-pointed at the chapter route
     (`…/chapters/{id}` instead of `…/chapters/{id}/draft`) →
     FAILED "accepts through the chapter's own draft review, writing no chapter
     content" (1). That is the mutation that matters here: it is exactly the
     shape of a card that publishes instead of accepting.
  5. The "accepting does not put it in the plan" paragraph removed →
     FAILED "says plainly that accepting does not put it in the plan" (1).
*/
