import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementTextInspection } from "@/components/engagement/engagement-text-inspection";
import { EngagementItemRegistry, type ItemRecord } from "@/components/engagement/engagement-item-registry";
import { SynthesisSourceInspection } from "@/components/engagement/synthesis-source-inspection";
import { SurveyReviewQueue } from "@/components/engagement/survey-review-queue";
import { makeSourceSnapshot, savedSource } from "./fixtures/engagement/synthesis-source";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/engagement/location-display-map", () => ({ LocationDisplayMap: () => <div>Map omitted from this component test</div> }));
vi.mock("@/components/engagement/survey-review-attachments", () => ({ SurveyReviewAttachments: () => null, SurveyHistoricalAttachments: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Exercise the native details toggle event. Keyboard/screen-reader behavior and
// actual layout remain browser acceptance work. Authored source, UNEXECUTED.
function toggleInspection(summaryText: string, open = true) {
  const summary = screen.getByText(summaryText, { selector: "summary" });
  const details = summary.parentElement as HTMLDetailsElement;
  details.open = open;
  fireEvent(details, new Event("toggle"));
  return details;
}

describe("readable and escaped engagement text", () => {
  it("keeps readable original text and provides separate open/close diagnostics", () => {
    const text = "می\u200Cروم \u202Ereview\u202C\u{E0061}";
    render(<EngagementTextInspection text={text} label="Comment" language="fa" script="Arab" />);
    const original = screen.getByLabelText("Comment, readable text");
    expect(original.textContent).toBe(text);
    expect(original).toHaveAttribute("dir", "auto");
    expect(original).toHaveAttribute("lang", "fa");
    expect(screen.queryByLabelText("Comment, escaped inspection")).toBeNull();
    const summary = "Inspect hidden characters in Comment: 4 occurrences";
    const details = toggleInspection(summary);
    expect(details).toHaveAttribute("open");
    const escaped = screen.getByLabelText("Comment, escaped inspection");
    expect(escaped.textContent).toBe("می\\u{200C}روم \\u{202E}review\\u{202C}\\u{E0061}");
    expect(escaped).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(/Contribution language: fa. Explicit script: Arab/)).toBeTruthy();
    expect(screen.getByText(/U\+200C/).closest("li")?.textContent).toContain("ZERO WIDTH NON-JOINER: 1");
    expect(screen.getByText(/Formatting observations do not determine intent/)).toBeTruthy();
    expect(original.textContent).toBe(text);
    toggleInspection(summary, false);
    expect(screen.queryByLabelText("Comment, escaped inspection")).toBeNull();
    expect(original.textContent).toBe(text);
  });

  it("renders hostile markup and literal escapes as text in both views", () => {
    const text = '<img src=x onerror="alert(1)"><script>alert(2)</script> \\u{202E} \u202E';
    const { container } = render(<EngagementTextInspection text={text} label="Markup" />);
    toggleInspection("Inspect hidden characters in Markup: 1 occurrence");
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByLabelText("Markup, readable text").textContent).toBe(text);
    expect(screen.getByLabelText("Markup, escaped inspection").textContent).toBe(text.replace("\\u{202E}", "\\\\u{202E}").replace("\u202E", "\\u{202E}"));
    expect(container.querySelector("button, input, textarea")).toBeNull();
  });

  it("does not infer language or declare character-free text safe", () => {
    render(<EngagementTextInspection text="ਪੰਜਾਬੀ বাংলা हिन्दी" label="Language" />);
    toggleInspection("Inspect hidden characters in Language: 0 occurrences");
    expect(screen.getByText(/Contribution language: not recorded in this view/)).toBeTruthy();
    expect(screen.getByText(/Observed script letters: Gurmukhi, Devanagari, Bengali/)).toBeTruthy();
    expect(screen.getByText(/This is not a content safety assessment/)).toBeTruthy();
    expect(screen.getByLabelText("Language, readable text").textContent).toBe("ਪੰਜਾਬੀ বাংলা हिन्दी");
    expect(screen.getByLabelText("Language, readable text")).not.toHaveAttribute("lang");
  });
});

describe("existing moderation and saved-source homes", () => {
  it("inspects the whole saved comment for a read-only staff viewer without requesting a scan", () => {
    const text = "Full saved text ".repeat(100) + "\u{E0061} TAIL";
    const item: ItemRecord = {
      id: "comment-1", campaign_id: "campaign-1", category_id: null, title: "Title\u202E",
      body: text, submitted_by: null, status: "pending", source_type: "public_portal",
      moderation_notes: null, updated_at: "2026-10-18T00:00:00Z",
    };
    const before = JSON.stringify(item);
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    render(<EngagementItemRegistry items={[item]} categories={[]} canWrite={false} counts={{ totalItems: 1, uncategorizedItems: 1, geographyCoverage: { geolocatedItems: 0 }, moderationQueue: { actionableCount: 1, pendingCount: 1, flaggedCount: 0 } }} />);
    expect(screen.getByLabelText("Saved comment body, readable text").textContent).toBe(text);
    toggleInspection("Inspect hidden characters in Saved comment body: 1 occurrence");
    expect(screen.getByLabelText("Saved comment body, escaped inspection").textContent).toContain("\\u{E0061} TAIL");
    expect(screen.getByLabelText("Saved comment title, readable text").textContent).toBe(item.title);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(item)).toBe(before);
  });

  it("inspects saved titles, answers and typed fields without changing source identity", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].body = "मी\u200C\u202E source";
    snapshot.items[0].title = "Title\u{E0061}";
    snapshot.answers[0].answer_text = "ক্\u200Cষ";
    snapshot.answers[0].answer_json = { nested: { text: "\u{E0062}" } };
    const saved = savedSource(snapshot), before = JSON.stringify(snapshot);
    render(<SynthesisSourceInspection snapshot={snapshot} sha256={saved.snapshotSha256} />);
    expect(screen.getByText(`Source SHA256: ${saved.snapshotSha256}`)).toBeTruthy();
    const originals = screen.getAllByLabelText("Retained contribution text, readable text");
    expect(originals.map(element => element.textContent)).toEqual([snapshot.items[0].body, snapshot.answers[0].answer_text]);
    expect(screen.getByText("Inspect hidden characters in Retained title or question: 1 occurrence", { selector: "summary" })).toBeTruthy();
    const fieldSummaries = screen.getAllByText("Inspect hidden characters in Retained fields, JSON representation: 2 occurrences", { selector: "summary" });
    expect(fieldSummaries.length).toBe(1);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(savedSource(snapshot)).toEqual(saved);
  });

  it("uses the existing survey read and preserves an empty textual answer and its typed fields", async () => {
    const answer = { id: "answer-1", session_id: "session-1", question_prompt_snapshot: "Question\u202E", answer_text: "", answer_json: { value: "বাংলা\u200C" } };
    const payload = { total: 1, sessions: [{ id: "session-1", status: "pending", created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z", configuration_version_id: null }], answers: [answer] };
    const before = JSON.stringify(payload);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchSpy);
    render(<SurveyReviewQueue campaignId="campaign-1" />);
    expect((await screen.findByLabelText("Retained survey answer, readable text")).textContent).toBe("");
    expect(screen.getByLabelText("Retained survey question, readable text").textContent).toBe(answer.question_prompt_snapshot);
    toggleInspection("Inspect hidden characters in Typed answer, JSON representation: 1 occurrence");
    expect(screen.getByLabelText("Typed answer, JSON representation, escaped inspection").textContent).toContain("বাংলা\\u{200C}");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/engagement/campaigns/campaign-1/survey/review?page=0");
    expect(JSON.stringify(payload)).toBe(before);
  });
});
