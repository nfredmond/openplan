import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import { resolvePortalLocale, type PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import {
  loadPortalTranslationIndex,
  resolveOperatorText,
  resolveOptionalOperatorText,
  type PortalTranslationIndex,
} from "@/lib/engagement/portal-i18n/operator-text";
import type { PortalSurveyQuestion } from "@/components/engagement/public-survey-form";
import { SURVEY_DRAFT_RETENTION_DAYS } from "@/lib/engagement/survey";

/**
 * THE PART A RESIDENT ACTUALLY MEETS, driven through the component the public
 * route renders — not the survey form in isolation.
 *
 * This repo keeps shipping capabilities that are complete, tested and reachable
 * by nobody, so the assertions below are all about what is on a screen: a
 * question that is not asked until it applies, a save control that exists on the
 * page and says what saving does, and a resumed response whose answers are
 * visible in the widgets rather than only in the form's own state.
 */

const UNFRAMED_MAP = resolvePortalMapFraming({});

function localeFor(tag: string) {
  const locale = resolvePortalLocale({ requested: tag, acceptLanguage: null });
  return { locale, messages: buildPortalMessageBundle(locale) };
}

const EN = localeFor("en");
const ES = localeFor("es");

// Real UUIDs: `visible_when.question_id` is validated as one, so a fixture with
// a friendly id would silently produce an unreadable condition — which the
// evaluator shows unconditionally, and every assertion below would pass while
// proving nothing.
const Q_MODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q_BUS_WHY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPT_BUS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPT_CAR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** No translations: the ordinary English campaign, resolved through the real index. */
async function plainIndex(locale: PortalLocale): Promise<PortalTranslationIndex> {
  const client = {
    from: (table: string) => {
      const result =
        table === "engagement_content_translations"
          ? { data: [], error: null }
          : { data: { default_content_locale: null }, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    },
  } as unknown as Parameters<typeof loadPortalTranslationIndex>[0];
  return loadPortalTranslationIndex(client, { campaignId: "campaign-1", locale });
}

type SourceQuestion = Omit<PortalSurveyQuestion, "promptText" | "helpTextText" | "options"> & {
  options: { id: string; label: string; value: string | null }[];
};

/** A bus follow-up that applies only to people who travel by bus. */
const CONDITIONAL_SURVEY: SourceQuestion[] = [
  {
    id: Q_MODE,
    questionType: "single_choice",
    prompt: "How do you usually travel here?",
    helpText: null,
    required: false,
    config: {},
    mapFramingNote: null,
    options: [
      { id: OPT_BUS, label: "Bus", value: null },
      { id: OPT_CAR, label: "Car", value: null },
    ],
  },
  {
    id: Q_BUS_WHY,
    questionType: "free_text",
    prompt: "What would make the bus work better for you?",
    helpText: null,
    required: false,
    config: { visible_when: { question_id: Q_MODE, operator: "equals", value: OPT_BUS } },
    mapFramingNote: null,
    options: [],
  },
];

async function questionsFor(locale: PortalLocale, sources = CONDITIONAL_SURVEY): Promise<PortalSurveyQuestion[]> {
  const index = await plainIndex(locale);
  return sources.map((question) => ({
    ...question,
    promptText: resolveOperatorText(index, { entity: "survey_question", id: question.id, field: "prompt" }, question.prompt),
    helpTextText: resolveOptionalOperatorText(
      index,
      { entity: "survey_question", id: question.id, field: "help_text" },
      question.helpText
    ),
    options: question.options.map((option) => ({
      ...option,
      labelText: resolveOperatorText(
        index,
        { entity: "survey_question_option", id: option.id, field: "label" },
        option.label
      ),
    })),
  }));
}

type PortalProps = Parameters<typeof PublicEngagementPortal>[0];

async function openSurveyTab(overrides: Partial<PortalProps> = {}, locale = EN) {
  const props: PortalProps = {
    mapFraming: UNFRAMED_MAP,
    shareToken: "share-token-123",
    acceptingSubmissions: true,
    engagementType: "map_feedback",
    categories: [],
    approvedItems: [],
    locale: locale.locale,
    messages: locale.messages,
    surveyQuestions: await questionsFor(locale.locale.locale),
    ...overrides,
  };
  const view = render(<PublicEngagementPortal {...props} />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(locale.messages.messages["portal.tab.survey"], "i") }));
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("a survey that only asks what applies", () => {
  it("does not ask the bus question until the resident says they take the bus", async () => {
    await openSurveyTab();

    expect(screen.getByText("How do you usually travel here?")).toBeInTheDocument();
    expect(screen.queryByText("What would make the bus work better for you?")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Bus/ }));
    await waitFor(() =>
      expect(screen.getByText("What would make the bus work better for you?")).toBeInTheDocument()
    );

    // And it goes away again when they change their mind — the answer with it.
    fireEvent.click(screen.getByRole("radio", { name: /Car/ }));
    await waitFor(() =>
      expect(screen.queryByText("What would make the bus work better for you?")).toBeNull()
    );
  });

  it("tells the resident that some questions depend on their answers", async () => {
    await openSurveyTab();
    expect(screen.getByText(EN.messages.messages["survey.conditionalNote"])).toBeInTheDocument();
  });

  it("says nothing about conditions on a survey that has none", async () => {
    await openSurveyTab({ surveyQuestions: await questionsFor("en", [CONDITIONAL_SURVEY[0]]) });
    expect(screen.queryByText(EN.messages.messages["survey.conditionalNote"])).toBeNull();
  });

  it("never sends an answer to a question that stopped applying", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await openSurveyTab();

    fireEvent.click(screen.getByRole("radio", { name: /Bus/ }));
    await waitFor(() => screen.getByText("What would make the bus work better for you?"));
    fireEvent.change(screen.getByRole("textbox", { name: "What would make the bus work better for you?" }), {
      target: { value: "more evening buses" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Car/ }));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(EN.messages.messages["survey.submit"], "i") }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: string }];
    const body = JSON.parse(init.body) as { answers: { questionId: string }[] };
    expect(body.answers.map((answer) => answer.questionId)).toEqual([Q_MODE]);
  });

  it("does not submit an answer the resident can no longer see in the box it came from", async () => {
    /**
     * THE STATE THIS CATCHES. A question is hidden, then its condition is met
     * again. Its widget remounts EMPTY, because a hidden widget unmounts and
     * loses its own state — so if the form kept the old answer in its map, the
     * resident would be looking at a blank box while the form quietly submitted
     * what they typed before they changed their mind. Filtering at submit time
     * cannot catch it: by then the question is visible again and the stale
     * answer looks perfectly legitimate.
     */
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await openSurveyTab();

    fireEvent.click(screen.getByRole("radio", { name: /Bus/ }));
    await waitFor(() => screen.getByText("What would make the bus work better for you?"));
    fireEvent.change(screen.getByRole("textbox", { name: "What would make the bus work better for you?" }), {
      target: { value: "more evening buses" },
    });

    fireEvent.click(screen.getByRole("radio", { name: /Car/ }));
    await waitFor(() => expect(screen.queryByText("What would make the bus work better for you?")).toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: /Bus/ }));

    const reshown = (await screen.findByRole("textbox", {
      name: "What would make the bus work better for you?",
    })) as HTMLTextAreaElement;
    // What the resident sees.
    expect(reshown.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: new RegExp(EN.messages.messages["survey.submit"], "i") }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: string }];
    // And what the form sends: the same thing.
    expect(init.body).not.toContain("more evening buses");
  });
});

describe("saving a part-finished survey, from the page a resident is on", () => {
  it("offers to save, and states what saving actually does", async () => {
    await openSurveyTab();

    expect(
      screen.getByRole("button", { name: new RegExp(EN.messages.messages["survey.saveForLater"], "i") })
    ).toBeInTheDocument();
    // The device limit and the retention are stated up front, because the
    // credential lives in this browser and nowhere else.
    expect(screen.getByText(/stay in this browser on this device/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${SURVEY_DRAFT_RETENTION_DAYS} days`))).toBeInTheDocument();
  });

  it("posts what has been answered so far and keeps the credential out of the address bar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ saved: true, resumeToken: "z".repeat(43), expiresAt: "2026-08-29T00:00:00.000Z" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await openSurveyTab();

    fireEvent.click(screen.getByRole("radio", { name: /Bus/ }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(EN.messages.messages["survey.saveForLater"], "i") }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/engage/share-token-123/survey/draft");
    expect(url).not.toContain("resumeToken");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).answers).toEqual([{ questionId: Q_MODE, answer: { option_id: OPT_BUS } }]);

    // The participant is told how long the answers will be there, with a date.
    await waitFor(() => expect(screen.getByText(/You can come back to this page/i)).toBeInTheDocument());
    expect(window.localStorage.getItem("openplan.survey.draft.share-token-123")).toBe("z".repeat(43));
  });

  it("brings the answers back into the widgets themselves, not only into the form's state", async () => {
    window.localStorage.setItem("openplan.survey.draft.share-token-123", "y".repeat(43));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        answers: [
          { questionId: Q_MODE, answer: { option_id: OPT_BUS } },
          { questionId: Q_BUS_WHY, answer: { text: "more evening buses" } },
        ],
        savedAt: "2026-07-28T09:00:00.000Z",
        expiresAt: "2026-08-27T09:00:00.000Z",
      }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await openSurveyTab();

    await waitFor(() => expect(screen.getByText(/brought back the answers/i)).toBeInTheDocument());
    // The conditional question is shown again BECAUSE the restored answer says
    // it applies — and it carries the resident's own words.
    const restored = await screen.findByRole("textbox", { name: "What would make the bus work better for you?" });
    expect((restored as HTMLTextAreaElement).value).toBe("more evening buses");
    expect((screen.getByRole("radio", { name: /Bus/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("does not re-fill a box with a resumed answer the form has already dropped", async () => {
    /**
     * THE MIRROR OF THE STALE-ANSWER BUG, and it survives a resume.
     *
     * A restored answer is seeded into the widget on mount. Change the earlier
     * answer and the follow-up is hidden and its answer pruned; change it back
     * and the widget mounts AGAIN from the same restored value — while the
     * form's own map no longer has it, and a widget that seeds itself does not
     * emit. The resident then reads their own sentence in the box and the form
     * submits without it. Whichever way it resolves, the box and the payload
     * have to say the same thing; blank is the honest one, because it matches
     * what the form will send.
     */
    window.localStorage.setItem("openplan.survey.draft.share-token-123", "u".repeat(43));
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) =>
      init?.body && JSON.parse(init.body).resumeToken
        ? ({
            ok: true,
            status: 200,
            json: async () => ({
              answers: [
                { questionId: Q_MODE, answer: { option_id: OPT_BUS } },
                { questionId: Q_BUS_WHY, answer: { text: "more evening buses" } },
              ],
              savedAt: "2026-07-28T09:00:00.000Z",
            }),
          } as Response)
        : ({ ok: true, status: 200, json: async () => ({ success: true }) } as Response)
    );
    vi.stubGlobal("fetch", fetchMock);

    await openSurveyTab();
    await waitFor(() => expect(screen.getByText(/brought back the answers/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: /Car/ }));
    await waitFor(() => expect(screen.queryByText("What would make the bus work better for you?")).toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: /Bus/ }));

    const reshown = (await screen.findByRole("textbox", {
      name: "What would make the bus work better for you?",
    })) as HTMLTextAreaElement;
    expect(reshown.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: new RegExp(EN.messages.messages["survey.submit"], "i") }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: string }];
    expect(init.body).not.toContain("more evening buses");
  });

  it("does not tell a resident their answers are gone when the check merely failed", async () => {
    // "We could not check" leaves their answers where they are; "they are gone"
    // tells them to start over. The credential is kept, too.
    window.localStorage.setItem("openplan.survey.draft.share-token-123", "x".repeat(43));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) } as Response)
    );

    await openSurveyTab();

    await waitFor(() => expect(screen.getByText(/could not check for saved answers/i)).toBeInTheDocument());
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    expect(window.localStorage.getItem("openplan.survey.draft.share-token-123")).toBe("x".repeat(43));
  });

  it("says the answers are gone, and forgets the credential, when the server says there are none", async () => {
    window.localStorage.setItem("openplan.survey.draft.share-token-123", "w".repeat(43));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ code: "DRAFT_NOT_FOUND" }) } as Response)
    );

    await openSurveyTab();

    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeInTheDocument());
    expect(window.localStorage.getItem("openplan.survey.draft.share-token-123")).toBeNull();
  });

  it("does not say the saved answers were discarded when the discard failed", async () => {
    /**
     * "Your saved answers have been discarded" IS A CLAIM ABOUT A ROW IN A
     * DATABASE, and `fetch` resolving is not evidence for it — only a network
     * failure rejects, so a 500 from the route arrives as an ordinary response.
     * Saying it anyway would be false twice over: the part-finished
     * demographics are still stored, AND the browser would have thrown away the
     * only credential that could ever reach them again, leaving them there for
     * the whole retention window with nobody able to delete them.
     */
    const token = "v".repeat(43);
    window.localStorage.setItem("openplan.survey.draft.share-token-123", token);
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "DELETE"
        ? ({ ok: false, status: 500, json: async () => ({ error: "Your saved answers could not be discarded right now." }) } as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ answers: [{ questionId: Q_MODE, answer: { option_id: OPT_BUS } }], savedAt: "2026-07-28T09:00:00.000Z" }),
          } as Response)
    );
    vi.stubGlobal("fetch", fetchMock);

    await openSurveyTab();
    // The discard control only exists once this browser holds a live credential.
    const discard = await screen.findByRole("button", {
      name: new RegExp(EN.messages.messages["survey.draftDiscard"], "i"),
    });
    fireEvent.click(discard);

    await waitFor(() => expect(screen.getByText(/could not be discarded/i)).toBeInTheDocument());
    expect(screen.queryByText(EN.messages.messages["survey.draftDiscarded"])).toBeNull();
    // And the credential survives, so they can try again.
    expect(window.localStorage.getItem("openplan.survey.draft.share-token-123")).toBe(token);
  });

  it("offers the same thing in Spanish", async () => {
    // A resident reading Spanish is offered saving in Spanish, or the promise
    // about their answers is one they cannot read.
    await openSurveyTab({ surveyQuestions: await questionsFor("es") }, ES);

    expect(
      screen.getByRole("button", { name: new RegExp(ES.messages.messages["survey.saveForLater"], "i") })
    ).toBeInTheDocument();
    expect(screen.getByText(/se quedan en este navegador/i)).toBeInTheDocument();
  });
});
