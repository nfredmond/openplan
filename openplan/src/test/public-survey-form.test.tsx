import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicSurveyForm,
  type PortalSurveyOption,
  type PortalSurveyQuestion,
} from "@/components/engagement/public-survey-form";
import { resolvePortalLocale, type PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import {
  loadPortalTranslationIndex,
  resolveOperatorText,
  resolveOptionalOperatorText,
  type PortalTranslationIndex,
} from "@/lib/engagement/portal-i18n/operator-text";
import { formatPortalNumber } from "@/lib/engagement/portal-i18n/format";

/**
 * THE SEAM THIS FILE GUARDS.
 *
 * The survey form is the highest-stakes participant surface in the product: a
 * question a resident misunderstands produces a wrong answer that enters the
 * planning record and gets counted. So these tests do NOT hand-write
 * `PortalText` values. Every question below is resolved through the SAME two
 * functions `loadPublicPortalBundle` uses — `loadPortalTranslationIndex` over
 * rows, then `resolveOperatorText` — because a fabricated provenance would let
 * the component pass a test while the loader's real answers rendered
 * differently. The only thing faked is the database.
 */

/** The source rows a campaign holds, before any translation is resolved. */
type SourceQuestion = Omit<PortalSurveyQuestion, "promptText" | "helpTextText" | "options"> & {
  options: Omit<PortalSurveyOption, "labelText">[];
};

const SOURCE_QUESTIONS: SourceQuestion[] = [
  {
    id: "q-single",
    questionType: "single_choice",
    prompt: "Top priority?",
    helpText: "Pick one.",
    required: true,
    config: { allow_other: true },
    mapFramingNote: null,
    options: [
      { id: "opt-bike", label: "Bike lane", value: null },
      { id: "opt-bus", label: "Bus stop", value: null },
    ],
  },
  {
    id: "q-multi",
    questionType: "multiple_choice",
    prompt: "Which modes do you use?",
    helpText: null,
    required: false,
    config: { min_select: 1, max_select: 2 },
    mapFramingNote: null,
    options: [
      { id: "mode-walk", label: "Walk", value: null },
      { id: "mode-bike", label: "Bike", value: null },
    ],
  },
  {
    id: "q-likert",
    questionType: "likert",
    prompt: "How satisfied are you?",
    helpText: null,
    required: false,
    config: { scale: 5 },
    mapFramingNote: null,
    options: [],
  },
  {
    id: "q-rating",
    questionType: "rating",
    prompt: "Rate the design",
    helpText: null,
    required: false,
    config: { max: 5 },
    mapFramingNote: null,
    options: [],
  },
  {
    id: "q-rank",
    questionType: "ranking",
    prompt: "Rank these",
    helpText: null,
    required: false,
    config: {},
    mapFramingNote: null,
    options: [
      { id: "rank-a", label: "Trees", value: null },
      { id: "rank-b", label: "Benches", value: null },
    ],
  },
  {
    id: "q-budget",
    questionType: "budget_allocation",
    prompt: "Spend the budget",
    helpText: null,
    required: false,
    config: { total: 100, unit: "usd" },
    mapFramingNote: null,
    options: [
      { id: "bud-a", label: "Paving", value: null },
      { id: "bud-b", label: "Lighting", value: null },
    ],
  },
  {
    id: "q-map",
    questionType: "map_point",
    prompt: "Where is the problem?",
    helpText: null,
    required: false,
    config: { geometry_types: ["Point"] },
    mapFramingNote: null,
    options: [],
  },
  {
    id: "q-text",
    questionType: "free_text",
    prompt: "Anything else?",
    helpText: null,
    required: false,
    config: { max_length: 500, multiline: true },
    mapFramingNote: null,
    options: [],
  },
  {
    id: "q-file",
    questionType: "file_upload",
    prompt: "Attach a photo",
    helpText: null,
    required: false,
    config: { max_files: 1, max_size_bytes: 5_242_880, accept: ["image/jpeg", "image/png", "image/webp"] },
    mapFramingNote: null,
    options: [],
  },
];

type TranslationRow = {
  entity_type: string;
  entity_id: string;
  field: string;
  translated_text: string;
  source: "operator" | "machine";
  machine_model?: string | null;
};

/**
 * The two reads `loadPortalTranslationIndex` makes, and nothing else.
 *
 * `translationsError` is not a hypothetical: migration 20260729000004 creates
 * `engagement_content_translations`, and in the window between a deploy and that
 * migration every translation read ERRORS. What a resident is told in that
 * window is a claim about their agency, so it is tested.
 */
function fakeTranslationClient(options: {
  rows?: TranslationRow[];
  translationsError?: { message: string };
  defaultContentLocale?: PortalLocale | null;
}) {
  const client = {
    from(table: string) {
      if (table === "engagement_content_translations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve(
                  options.translationsError
                    ? { data: null, error: options.translationsError }
                    : { data: options.rows ?? [], error: null }
                ),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { default_content_locale: options.defaultContentLocale ?? null },
                error: null,
              }),
          }),
        }),
      };
    },
  };

  return client as unknown as Parameters<typeof loadPortalTranslationIndex>[0];
}

async function indexFor(
  locale: PortalLocale,
  options: {
    rows?: TranslationRow[];
    translationsError?: { message: string };
    defaultContentLocale?: PortalLocale | null;
  } = {}
): Promise<PortalTranslationIndex> {
  return loadPortalTranslationIndex(fakeTranslationClient(options), { campaignId: "campaign-1", locale });
}

/**
 * Resolve source questions the way `loadPublicPortalBundle` does — same entity
 * names, same fields, same resolver.
 */
function resolveQuestions(
  index: PortalTranslationIndex,
  sources: SourceQuestion[] = SOURCE_QUESTIONS
): PortalSurveyQuestion[] {
  return sources.map((question) => ({
    ...question,
    promptText: resolveOperatorText(
      index,
      { entity: "survey_question", id: question.id, field: "prompt" },
      question.prompt
    ),
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

function bundleFor(locale: PortalLocale) {
  return buildPortalMessageBundle(resolvePortalLocale({ requested: locale }));
}

const EN_BUNDLE = bundleFor("en");

/** An English portal of an English campaign — the ordinary case, no disclosures. */
async function englishQuestions(sources?: SourceQuestion[]) {
  return resolveQuestions(await indexFor("en"), sources);
}

function mockOkResponse() {
  return {
    ok: true,
    json: async () => ({ success: true, message: "Thanks", sessionId: "s1", reviewStatus: "pending" }),
  } as unknown as Response;
}

/** Every class token in the rendered markup, for the physical-property guard. */
function classTokens(container: HTMLElement): string[] {
  const tokens = new Set<string>();
  // `getAttribute` rather than `className` — on an SVG element (the lucide icons)
  // `className` is an SVGAnimatedString, not a string.
  for (const element of container.querySelectorAll("[class]")) {
    for (const token of (element.getAttribute("class") ?? "").split(/\s+/)) if (token) tokens.add(token);
  }
  return [...tokens];
}

describe("PublicSurveyForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a widget for every question type", async () => {
    render(<PublicSurveyForm shareToken="token12345678" questions={await englishQuestions()} messages={EN_BUNDLE} />);
    expect(screen.getByText("Top priority?")).toBeTruthy();
    expect(screen.getByText("Which modes do you use?")).toBeTruthy();
    expect(screen.getByText("How satisfied are you?")).toBeTruthy();
    expect(screen.getByText("Rate the design")).toBeTruthy();
    expect(screen.getByText("Rank these")).toBeTruthy();
    expect(screen.getByText("Spend the budget")).toBeTruthy();
    expect(screen.getByText("Where is the problem?")).toBeTruthy();
    expect(screen.getByText("Anything else?")).toBeTruthy();
    expect(screen.getByText("Attach a photo")).toBeTruthy();
    // required marker on the single_choice question
    expect(screen.getByText("Pick one.")).toBeTruthy();
  });

  /**
   * A `map_point` question inherits the campaign's camera, and used to inherit
   * nothing else — so when the campaign had no area to give, the survey tab
   * opened on the continental United States in silence while the portal's own
   * map, one tab over, said so out loud. The sentence travels on the question
   * because the question is the only thing that reaches this widget.
   */
  it("says where a map_point question's map opens, and says when it is the whole country", async () => {
    const unframed: SourceQuestion = {
      id: "q-map-unframed",
      questionType: "map_point",
      prompt: "Where is the problem?",
      helpText: null,
      required: false,
      config: { geometry_types: ["Point"] },
      mapFramingNote:
        "No study area has been set for this campaign and no locations have been marked yet, so this map opens on the whole country.",
      options: [],
    };
    const { unmount } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={await englishQuestions([unframed])}
        messages={EN_BUNDLE}
      />
    );
    expect(screen.getByText(/so this map opens on the whole country/i)).toBeTruthy();
    // With no camera the participant is also told what to do about it.
    expect(screen.getByText(/zoom to your neighbourhood before dropping a pin/i)).toBeTruthy();
    unmount();

    const framed: SourceQuestion = {
      ...unframed,
      id: "q-map-framed",
      config: { geometry_types: ["Point"], center: [-83.0, 39.98], zoom: 10 },
      mapFramingNote: "This map opens on Franklin County, Ohio — the linked project's study area.",
    };
    render(
      <PublicSurveyForm shareToken="token12345678" questions={await englishQuestions([framed])} messages={EN_BUNDLE} />
    );
    expect(
      screen.getByText(/This map opens on Franklin County, Ohio — the linked project's study area\./i)
    ).toBeTruthy();
    // The continental instruction belongs only to the unframed case.
    expect(screen.queryByText(/zoom to your neighbourhood before dropping a pin/i)).toBeNull();
  });

  it("blocks submission when nothing is answered and never calls the network", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<PublicSurveyForm shareToken="token12345678" questions={await englishQuestions()} messages={EN_BUNDLE} />);
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));
    // The catalog's own sentence, because this survey has a required question.
    expect(screen.getByText("Please answer the required questions before submitting.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * The pre-flight check is a CLIENT convenience; the server validator is the
   * authority. Translating its words must not move its condition, so the guard
   * is that a survey with nothing required still refuses an empty submission and
   * still never calls the network — only the sentence differs.
   */
  it("still refuses an empty submission when no question is required", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const optional = SOURCE_QUESTIONS.filter((question) => !question.required);
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={await englishQuestions(optional)}
        messages={EN_BUNDLE}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));
    expect(screen.getByText("Please answer at least one question.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * THE HEADLINE REQUIREMENT, GUARDED IN THE LANGUAGE IT IS ABOUT. An English
   * "please answer the required questions" on a Spanish form is the failure this
   * whole seam exists to remove, and the English-bundle test above cannot see it:
   * `survey.requiredMissing` and a hardcoded English literal render identically
   * on an English page, so that assertion passes either way. This one does not —
   * it reads the Spanish sentence and requires that it is NOT marked as English
   * copy, which is what a hardcoded literal would have to be.
   */
  it("refuses an empty submission in the participant's language, not in English", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"))}
        messages={bundleFor("es")}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /enviar encuesta/i }));

    const message = screen.getByText("Responda las preguntas obligatorias antes de enviar.");
    expect(message.closest("[lang]")?.getAttribute("lang")).toBe("es");
    expect(screen.queryByText("Please answer the required questions before submitting.")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the canonical per-type answer shapes to the confined survey submit path", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockOkResponse());
    render(<PublicSurveyForm shareToken="token12345678" questions={await englishQuestions()} messages={EN_BUNDLE} />);

    fireEvent.click(screen.getByLabelText("Bike lane")); // single_choice → {option_id:"opt-bike"}
    fireEvent.click(screen.getByLabelText("Walk")); // multiple_choice → {option_ids:["mode-walk"]}
    fireEvent.click(screen.getByRole("button", { name: "4" })); // likert value 4
    fireEvent.change(screen.getByPlaceholderText("Type your response"), { target: { value: "More trees" } });

    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engage/token12345678/survey/submit");
    const body = JSON.parse((init as RequestInit).body as string) as {
      answers: { questionId: string; answer: unknown }[];
      website: string;
    };
    expect(body.website).toBe(""); // honeypot travels empty
    const byId = Object.fromEntries(body.answers.map((a) => [a.questionId, a.answer]));
    expect(byId["q-single"]).toEqual({ option_id: "opt-bike" });
    expect(byId["q-multi"]).toEqual({ option_ids: ["mode-walk"] });
    expect(byId["q-likert"]).toEqual({ value: 4 });
    expect(byId["q-text"]).toEqual({ text: "More trees" });
    // untouched questions are omitted entirely (server decides required-emptiness)
    expect(byId["q-rating"]).toBeUndefined();
    expect(byId["q-map"]).toBeUndefined();

    await screen.findByText("Thank you — your survey response has been received.");
  });

  it("drops the selected option_id and stores only free text when 'Other' is chosen", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockOkResponse());
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={await englishQuestions([SOURCE_QUESTIONS[0]])}
        messages={EN_BUNDLE}
      />
    );

    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByPlaceholderText("Please specify"), { target: { value: "Traffic calming" } });
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      answers: { questionId: string; answer: { option_id: string; other_text: string } }[];
    };
    expect(body.answers[0].answer.other_text).toBe("Traffic calming");
    expect(body.answers[0].answer.option_id).toBe("__other__"); // sentinel — dropped server-side
  });

  it("surfaces a server validation error against the offending question", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This question is required.", code: "REQUIRED_EMPTY", questionId: "q-single" }),
    } as unknown as Response);
    render(<PublicSurveyForm shareToken="token12345678" questions={await englishQuestions()} messages={EN_BUNDLE} />);

    fireEvent.change(screen.getByPlaceholderText("Type your response"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    // The error text appears both as the field error and the top banner.
    await waitFor(() => expect(screen.getAllByText("This question is required.").length).toBeGreaterThan(0));
  });

  /**
   * The submit route answers with English literals and a machine-readable
   * `code`; the catalog has no key per `SurveyAnswerErrorCode` yet. Until it
   * does, the server's words must be marked as the server's language rather than
   * rendered as though the agency wrote them in the participant's.
   */
  it("marks a server validation message as English inside a Spanish form", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This question is required.", code: "REQUIRED_EMPTY", questionId: "q-single" }),
    } as unknown as Response);
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"))}
        messages={bundleFor("es")}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Type your response"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar encuesta/i }));

    const shown = await waitFor(() => {
      const found = screen.getAllByText("This question is required.");
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const node of shown) {
      expect(node.closest("[lang]")?.getAttribute("lang")).toBe("en");
    }
  });

  it("never offers a ranking position two options can share (ties would be a false strict order)", async () => {
    const rankQuestion: SourceQuestion = {
      id: "q-rank",
      questionType: "ranking",
      prompt: "Rank these",
      helpText: null,
      required: false,
      config: {},
      mapFramingNote: null,
      options: [
        { id: "rank-a", label: "Trees", value: null },
        { id: "rank-b", label: "Benches", value: null },
      ],
    };
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={await englishQuestions([rankQuestion])}
        messages={EN_BUNDLE}
      />
    );
    const selects = screen.getAllByRole("combobox");
    // Assign rank 1 to the first option.
    fireEvent.change(selects[0], { target: { value: "1" } });
    // The second option's select must no longer offer rank 1.
    const secondOptions = Array.from((selects[1] as HTMLSelectElement).options).map((option) => option.value);
    expect(secondOptions).not.toContain("1");
    expect(secondOptions).toContain("2");
  });

  it("never offers a half-star rating below 1 (the server rejects value < 1)", async () => {
    const ratingQuestion: SourceQuestion = {
      id: "q-half",
      questionType: "rating",
      prompt: "Rate it (half steps)",
      helpText: null,
      required: false,
      config: { max: 5, allow_half: true },
      mapFramingNote: null,
      options: [],
    };
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={await englishQuestions([ratingQuestion])}
        messages={EN_BUNDLE}
      />
    );
    const values = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options)
      .map((option) => option.value)
      .filter((value) => value !== "");
    expect(values).not.toContain("0.5");
    expect(values).toContain("1");
    expect(values).toContain("1.5");
    expect(values.every((value) => Number(value) >= 1)).toBe(true);
  });

  it("keeps a honeypot field bots can fill but users cannot see", async () => {
    render(<PublicSurveyForm shareToken="token12345678" questions={await englishQuestions()} messages={EN_BUNDLE} />);
    const honeypot = screen.getByLabelText("Website") as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
  });

  // ── The language of the question ───────────────────────────────────────────

  it("asks its question in the participant's language", async () => {
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"))}
        messages={bundleFor("es")}
      />
    );
    expect(screen.getByRole("button", { name: /enviar encuesta/i })).toBeTruthy();
    // Field labels and the review notice are OpenPlan's own copy.
    expect(screen.getByText("Su nombre, o el nombre que quiera usar")).toBeTruthy();
    expect(
      screen.getAllByText(
        "Alguien del equipo del proyecto lee lo que usted envía antes de mostrarlo en esta página o usarlo en un informe."
      )
        .length
    ).toBeGreaterThan(0);
    // The required marker's accessible word, not an asterisk read aloud.
    expect(screen.getByText("Obligatorio")).toBeTruthy();
  });

  /**
   * A machine translation and an operator-authored one are different promises:
   * an agency can be held to what it published, and it did not publish what a
   * model wrote. The label has to sit where the resident is deciding what the
   * question asks — inside the question, not in a page footer.
   */
  it("labels a machine-translated question beside the question itself", async () => {
    const rows: TranslationRow[] = [
      {
        entity_type: "survey_question",
        entity_id: "q-single",
        field: "prompt",
        translated_text: "¿Cuál es la prioridad principal?",
        source: "machine",
        machine_model: "claude-test",
      },
      {
        entity_type: "survey_question_option",
        entity_id: "opt-bike",
        field: "label",
        translated_text: "Carril para bicicletas",
        source: "machine",
        machine_model: "claude-test",
      },
    ];
    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es", { rows }), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );

    const prompt = screen.getByText("¿Cuál es la prioridad principal?");
    expect(prompt.getAttribute("lang")).toBe("es");

    // The badge is INSIDE the same fieldset as the prompt a resident is reading.
    const fieldset = container.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.textContent).toContain("Traducción automática");
    expect(fieldset?.textContent).toContain(
      "Traducido automáticamente por conveniencia. La redacción original del equipo del proyecto es la versión oficial."
    );
    // The translated option is rendered, not the English source.
    expect(screen.getByLabelText("Carril para bicicletas")).toBeTruthy();
  });

  it("adds no caveat to a translation the agency wrote itself", async () => {
    const rows: TranslationRow[] = SOURCE_QUESTIONS[0].options.map((option) => ({
      entity_type: "survey_question_option",
      entity_id: option.id,
      field: "label",
      translated_text: `${option.label} (es)`,
      source: "operator" as const,
    }));
    rows.push(
      {
        entity_type: "survey_question",
        entity_id: "q-single",
        field: "prompt",
        translated_text: "¿Cuál es la prioridad principal?",
        source: "operator",
      },
      {
        entity_type: "survey_question",
        entity_id: "q-single",
        field: "help_text",
        translated_text: "Elija una.",
        source: "operator",
      }
    );

    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es", { rows }), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );

    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.textContent).not.toContain("Traducción automática");
    expect(fieldset?.textContent).not.toContain("Sin traducir");
    expect(fieldset?.textContent).not.toContain("Traducciones no disponibles");
  });

  /**
   * Unlabelled English inside an otherwise-Spanish page tells a resident the
   * agency chose to write it that way. An untranslated prompt is labelled AND
   * marked with the language it is actually in, so a screen reader does not
   * pronounce English with Spanish phonemes.
   */
  it("says an untranslated question is untranslated, in the language it is actually in", async () => {
    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es", { defaultContentLocale: "en" }), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );

    const prompt = screen.getByText("Top priority?");
    expect(prompt.getAttribute("lang")).toBe("en");

    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.textContent).toContain("Sin traducir");
    expect(fieldset?.textContent).toContain(
      "El equipo del proyecto no ha publicado este texto en Español. Se muestra en English."
    );
  });

  /**
   * THE STATE THIS DEPLOYMENT IS IN RIGHT NOW. Migration 20260729000004 creates
   * `engagement_content_translations`; until it is applied, the translation read
   * ERRORS. A failed lookup is not an absent translation — reporting "not
   * translated" would state a broken query as a decision the agency made — so
   * the form says it could not load its translations and says nothing about
   * whether a Spanish version exists.
   */
  it("says the translations could not be loaded rather than that nothing was translated", async () => {
    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(
          await indexFor("es", {
            translationsError: { message: 'relation "engagement_content_translations" does not exist' },
          }),
          [SOURCE_QUESTIONS[0]]
        )}
        messages={bundleFor("es")}
      />
    );

    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.textContent).toContain("Traducciones no disponibles");
    expect(fieldset?.textContent).toContain(
      "Esta página no pudo cargar sus traducciones, así que este texto se muestra tal como lo escribió el equipo del proyecto. No se sabe si existe una versión en Español."
    );
    // The two states must stay distinguishable.
    expect(fieldset?.textContent).not.toContain("Sin traducir");
  });

  /**
   * Scale labels and map guidance live inside `config_json`, which the
   * translation table cannot key on, so they are the one part of a fully
   * translated question that stays in the operator's own words. Silence about
   * that would publish them as the agency's Spanish.
   */
  it("discloses operator text inside a question's config that no translation can reach", async () => {
    const likert: SourceQuestion = {
      id: "q-likert-labels",
      questionType: "likert",
      prompt: "How satisfied are you?",
      helpText: null,
      required: false,
      config: { scale: 5, labels: ["Very poor", "Poor", "Fair", "Good", "Very good"] },
      mapFramingNote: null,
      options: [],
    };
    const rows: TranslationRow[] = [
      {
        entity_type: "survey_question",
        entity_id: likert.id,
        field: "prompt",
        translated_text: "¿Qué tan satisfecho está?",
        source: "operator",
      },
    ];

    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es", { rows }), [likert])}
        messages={bundleFor("es")}
      />
    );

    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.textContent).toContain(
      "El equipo del proyecto no ha publicado este texto en Español. Se muestra tal como lo escribió."
    );
    // The labels themselves still render — disclosure, not suppression.
    expect(screen.getByText("Very good")).toBeTruthy();
  });

  it("discloses that part of the form is not available in the participant's language", async () => {
    const { unmount } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );
    expect(
      screen.getByText(
        "Esta página solo está disponible parcialmente en Español. Lo que aún no está traducido se muestra en inglés."
      )
    ).toBeTruthy();
    unmount();

    // Nothing to disclose on an English form: the copy IS in English.
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={await englishQuestions([SOURCE_QUESTIONS[0]])}
        messages={EN_BUNDLE}
      />
    );
    expect(screen.queryByText(/solo está disponible parcialmente/i)).toBeNull();
    expect(screen.queryByText(/only partly available/i)).toBeNull();
  });

  it("marks its remaining English copy as English", async () => {
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );
    // "Other" has no catalog key yet; it must not read as the agency's Spanish.
    expect(screen.getByText("Other").closest("[lang]")?.getAttribute("lang")).toBe("en");
  });

  // ── Right-to-left, and numbers ────────────────────────────────────────────

  /**
   * Farsi is one of the eleven. A form that declares `dir="rtl"` and then lays
   * itself out with `ml-`/`text-right` underneath is broken with extra steps, so
   * both halves are asserted: the declaration, and the absence of physical
   * direction classes.
   *
   * `map_point` is excluded because its map picker is a different component with
   * its own markup — this guard is about the form's own classes.
   */
  it("lays a Farsi form out right to left, with no physical direction classes", async () => {
    const sources = SOURCE_QUESTIONS.filter((question) => question.questionType !== "map_point");
    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("fa"), sources)}
        messages={bundleFor("fa")}
      />
    );

    const form = container.querySelector("form");
    expect(form?.getAttribute("dir")).toBe("rtl");
    expect(form?.getAttribute("lang")).toBe("fa");

    const physical = classTokens(container).filter((token) =>
      /^-?(ml|mr|pl|pr)-/.test(token) || /^-?(left|right)-/.test(token) || token === "text-left" || token === "text-right"
    );
    expect(physical).toEqual([]);
  });

  /**
   * A DIRECTION IS ONLY CLAIMED FROM A RECORDED LANGUAGE.
   *
   * `PortalText.textLocaleStated` is false when the campaign never said what
   * language it was written in, and that is the state EVERY campaign is in until
   * 20260729000004 adds the column to say it in. Turning that presumption into
   * `dir="ltr"` would lay an Arabic-authored prompt out left-to-right; `dir="auto"`
   * claims nothing and lets the browser read the string itself. A campaign that DID
   * state its language still gets the direction that language actually has.
   */
  it("claims a direction for operator text only when its language was recorded", async () => {
    const { unmount } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );
    // No stated source language: the locale on this text is a presumption.
    expect(screen.getByText("Top priority?").getAttribute("dir")).toBe("auto");
    unmount();

    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es", { defaultContentLocale: "ar" }), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("es")}
      />
    );
    // Recorded as Arabic: the recorded language's own direction, not the page's.
    const stated = screen.getByText("Top priority?");
    expect(stated.getAttribute("lang")).toBe("ar");
    expect(stated.getAttribute("dir")).toBe("rtl");
  });

  // ── The language OpenPlan's OWN copy came out in ───────────────────────────

  /**
   * NINE OF THE ELEVEN LOCALES HAVE NO CATALOG, and that is the case these
   * guards are about. On a Farsi portal every sentence this form renders is
   * English, while the form element around it says `lang="fa" dir="rtl"`. A
   * screen reader believes the element: it pronounces English words with Farsi
   * phonology, which is close to unintelligible, and an English sentence with no
   * direction of its own is laid out from the wrong edge of the page.
   *
   * The Spanish tests above cannot see any of this — Spanish is complete, so
   * every key resolves and there is nothing marked either way. Farsi is the
   * locale where the claim is actually made.
   */
  it("marks its own copy as English on a locale it has not been translated into", async () => {
    const { container } = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("fa"), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("fa")}
      />
    );

    // The page still declares itself Farsi — the fallback is disclosed, not hidden.
    const form = container.querySelector("form");
    expect(form?.getAttribute("lang")).toBe("fa");
    expect(form?.getAttribute("dir")).toBe("rtl");

    // …and every English run inside it says so, and lays itself out left to right.
    for (const english of ["Submit survey", "Choose one", "Your name, or any name you want to use", "Required"]) {
      const node = screen.getByText(english);
      expect(node.getAttribute("lang")).toBe("en");
      expect(node.getAttribute("dir")).toBe("ltr");
    }
  });

  /**
   * A machine-translation badge is the sentence with the most legal weight on
   * this page, so it is the last one that may be mispronounced. Its caveat has
   * to carry its own language too — `provenance.ts` built
   * `portalTextDisclosureView` for exactly this and nothing called it.
   */
  it("marks a machine-translation badge and its caveat with the language they are in", async () => {
    const rows: TranslationRow[] = [
      {
        entity_type: "survey_question",
        entity_id: "q-single",
        field: "prompt",
        translated_text: "اولویت اصلی چیست؟",
        source: "machine",
        machine_model: "claude-test",
      },
    ];
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("fa", { rows }), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("fa")}
      />
    );

    // The badge and the caveat are both English on a locale with no catalog.
    expect(screen.getByText("Machine translation").getAttribute("lang")).toBe("en");
    const caveat = screen.getByText(
      "Translated by machine for convenience. The project team's original wording is the official version."
    );
    expect(caveat.getAttribute("lang")).toBe("en");
    expect(caveat.getAttribute("dir")).toBe("ltr");

    // The machine's Farsi is still rendered as Farsi — this is about OpenPlan's
    // own copy, not about the operator content it wraps.
    expect(screen.getByText("اولویت اصلی چیست؟").getAttribute("lang")).toBe("fa");
  });

  it("refuses an empty submission in words marked as the language they are in", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("fa"), [SOURCE_QUESTIONS[0]])}
        messages={bundleFor("fa")}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    // Same condition, same refusal, no request — only the marking differs.
    expect(
      screen.getByText("Please answer the required questions before submitting.").getAttribute("lang")
    ).toBe("en");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * THE FALSE CLAIM THIS FIXES. The upload validator used to assert that a
   * catalog string was "in the participant's language" because it came from the
   * catalog — which is true for Spanish and false for the nine locales the
   * catalog falls back on. Both directions are asserted here: the Farsi form
   * marks it English, and the Spanish form does not.
   */
  it("tells a participant a file was the wrong type in the language that sentence is actually in", async () => {
    const fileQuestion = SOURCE_QUESTIONS.find((question) => question.questionType === "file_upload");
    expect(fileQuestion).toBeTruthy();
    const wrongType = new File(["not an image"], "notes.txt", { type: "text/plain" });

    const farsi = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("fa"), [fileQuestion!])}
        messages={bundleFor("fa")}
      />
    );
    fireEvent.change(farsi.container.querySelector('input[type="file"]')!, {
      target: { files: [wrongType] },
    });
    const english = await screen.findByText("Please choose a JPEG, PNG, or WebP image.");
    expect(english.getAttribute("lang")).toBe("en");
    farsi.unmount();

    const spanish = render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("es"), [fileQuestion!])}
        messages={bundleFor("es")}
      />
    );
    fireEvent.change(spanish.container.querySelector('input[type="file"]')!, {
      target: { files: [wrongType] },
    });
    const translated = await screen.findByText("Elija una imagen JPEG, PNG o WebP.");
    expect(translated.getAttribute("lang")).toBe("es");
  });

  /**
   * A budget input's unit mark used to be a literal `"$"`. Arabic writes the US
   * dollar as «US$» and sets it after the number, so the literal was both the
   * wrong glyph and in the wrong place. The mark is now read out of `Intl`,
   * which is also why no currency glyph appears in the component at all.
   *
   * The expectation is computed from `Intl` rather than written out, because the
   * exact string is ICU-version data. On a runtime whose ICU lacks Arabic this
   * degrades to asserting the English mark, which is weaker but never wrong.
   */
  it("writes a budget's currency mark the way the participant's language writes it", async () => {
    const budget = SOURCE_QUESTIONS.find((question) => question.questionType === "budget_allocation");
    expect(budget).toBeTruthy();

    const expected = new Intl.NumberFormat("ar", { style: "currency", currency: "USD" })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value;
    expect(expected).toBeTruthy();

    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("ar"), [budget!])}
        messages={bundleFor("ar")}
      />
    );
    expect(screen.getAllByText(expected!).length).toBeGreaterThan(0);
  });

  it("writes its numbers in the participant's numerals", async () => {
    const sources = SOURCE_QUESTIONS.filter((question) => question.questionType === "free_text");
    render(
      <PublicSurveyForm
        shareToken="token12345678"
        questions={resolveQuestions(await indexFor("fa"), sources)}
        messages={bundleFor("fa")}
      />
    );

    // 500 is the free-text max_length. In Farsi that is not "500".
    const farsiLimit = formatPortalNumber(500, "fa");
    expect(farsiLimit).not.toBe("500");
    expect(screen.getByText(new RegExp(farsiLimit))).toBeTruthy();
  });
});
