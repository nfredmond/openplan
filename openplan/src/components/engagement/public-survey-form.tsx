"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Loader2, Save, Send, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
import {
  SURVEY_DRAFT_RETENTION_DAYS,
  SURVEY_QUESTION_TYPES,
  budgetConfigSchema,
  fileUploadConfigSchema,
  freeTextConfigSchema,
  likertConfigSchema,
  mapPointConfigSchema,
  multipleChoiceConfigSchema,
  rankingConfigSchema,
  ratingConfigSchema,
  readSurveyVisibilityCondition,
  resolveSurveyVisibility,
  singleChoiceConfigSchema,
  type SurveyQuestionType,
} from "@/lib/engagement/survey";
import {
  PORTAL_LOCALE_DIRECTION,
  type PortalLocale,
  type PortalTextDirection,
} from "@/lib/engagement/portal-i18n/locales";
import {
  createPortalTranslator,
  type PortalMessageBundle,
  type PortalTranslator,
} from "@/lib/engagement/portal-i18n/translator";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
/**
 * NOTE FOR ANYONE ADDING AN IMPORT HERE: `messages.ts` must never be one, not
 * even a type-only one that a later edit could turn into a value import. It
 * holds every locale's catalog, so importing it into this client component would
 * ship every language to one resident's phone to render one — the exact
 * thing `translator.ts` was split out to prevent. The message KEYS this file
 * names are typed through `portalMessageView`, which is generic over them, so
 * placeholder interpolation stays a build error with no catalog in reach.
 */
import {
  portalMessageView,
  portalTextBadge,
  portalTextDisclosureView,
  portalTextIsFallback,
  portalTextLang,
  type PortalDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";
import { formatPortalDate, formatPortalMegabytes, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import { GeometryPickerMap, type EngagementDrawMode } from "./geometry-picker-map";

// ── Serializable participant-facing question shape (options folded in) ────────

/**
 * One answer option as a participant reads it.
 *
 * `label` is the SOURCE string and `labelText` is the one to render. Both are
 * required, and `labelText` is not optional, because an option label is as
 * participant-facing as the prompt above it: a Spanish survey whose answers are
 * listed in English cannot be answered, and an option a machine translated is an
 * option the agency did not word.
 */
export type PortalSurveyOption = {
  id: string;
  label: string;
  value: string | null;
  labelText: PortalText;
};

export type PortalSurveyQuestion = {
  id: string;
  questionType: SurveyQuestionType;
  prompt: string;
  helpText: string | null;
  required: boolean;
  config: unknown; // raw config_json — re-parsed defensively per widget
  /**
   * For a `map_point` question, the sentence saying where its map opens and
   * why — resolved server-side by `resolveMapPointQuestionView`, which is also
   * what filled in `config.center`/`config.zoom`. Null for every other question
   * type, and for a `map_point` question an operator framed themselves (nothing
   * was inherited, so there is no assumption to disclose).
   *
   * REQUIRED, and required on every question rather than only the one type that
   * can have it, because the defect it closes was a survey tab that opened on
   * the continental United States in silence while the portal map beside it said
   * so out loud. An optional field is one a caller forgets and nothing catches.
   *
   * KNOWN LIMIT: this sentence is composed in ENGLISH by
   * `describePortalFraming` in src/lib/engagement/public-portal-data.ts, so it
   * is English on every locale. It is rendered here marked `lang="en"` and
   * counted as untranslated rather than passed off as the page's language — see
   * `PENDING_PORTAL_COPY`.
   */
  mapFramingNote: string | null;
  /**
   * THE PROMPT AS A PARTICIPANT READS IT, WITH ITS PROVENANCE.
   *
   * A survey question a resident MISUNDERSTANDS produces a wrong answer that
   * enters the planning record and gets counted, which is worse than no answer
   * at all. So the prompt does not arrive as a bare string: it arrives with the
   * language it is actually in and with whether a person at the agency wrote
   * those words or a model did. `prompt` above stays the SOURCE string and is
   * deliberately not what this component renders.
   *
   * REQUIRED rather than optional, for the reason `mapFramingNote` is: this repo
   * keeps shipping finished capabilities that no caller reaches, and the cheapest
   * guard against a translated prompt nobody passed is a build error. Every
   * producer already has it — `loadPublicPortalBundle` resolves it through
   * `resolveOperatorText`, whose answer is never absent (an untranslated string
   * is one of its states, not a null).
   */
  promptText: PortalText;
  /** The help text, resolved the same way. Null when the question has none. */
  helpTextText: PortalText | null;
  options: PortalSurveyOption[];
};

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20";

// Sentinel option_id used when a single/multiple-choice "Other" free-text is
// chosen. The submit route drops it (storing only other_text) so it is never
// tallied as a real option — see validateSurveyAnswer's single_choice branch.
const OTHER_SENTINEL = "__other__";

// GeoJSON geometry type → GeometryPickerMap draw mode.
const GEO_TYPE_TO_MODE: Record<"Point" | "LineString" | "Polygon", EngagementDrawMode> = {
  Point: "point",
  LineString: "line",
  Polygon: "area",
};

/**
 * The language OpenPlan's own copy is WRITTEN IN.
 *
 * Not a jurisdiction assumption and not the participant's language — a fact
 * about the strings below. `messages.ts` derives every key from
 * `EN_PORTAL_MESSAGES` and falls back to it, so English is structurally the
 * source language of this product's participant copy. It is named here because
 * two different things depend on knowing it: the `lang` attribute on a run of
 * English inside a page that is not English, and the decision to disclose that
 * such runs exist.
 */
const PENDING_COPY_LOCALE: PortalLocale = "en";

/**
 * COPY THIS FORM STILL HAS NO CATALOG KEY FOR — declared in ONE place, rendered
 * in English, marked as English, and DISCLOSED to the participant.
 *
 * WHY IT EXISTS AT ALL. `EN_PORTAL_MESSAGES` carries the survey's headline
 * strings (submit, submitting, received, required, the rank/map/budget hints)
 * but not its widget-level copy: "Other", "Please specify", "Not rated", the
 * selection-count hints, the character counter, the file-upload limits, and the
 * two client-side validation messages. Those keys are proposed in this
 * component's handoff; until they land, the honest options are (a) render
 * English and say so, or (b) render English and let a resident read it as
 * something the agency chose to write in English. Under Title VI (b) is the
 * failure this whole seam exists to remove, so this is (a):
 *
 *   1. every string here renders inside `<PendingCopy>`, which sets `lang="en"`
 *      so a screen reader on a Spanish page does not pronounce it as Spanish;
 *   2. the form states, once, near the top, that part of it is not available in
 *      the participant's language — `language.partialNotice`, which is a catalog
 *      key and so is itself translated wherever a catalog exists, and marked as
 *      English by `portalMessageView` on the locales where one does not yet.
 *
 * ENGLISH PLURALS ARE APPLIED HERE ON PURPOSE. These strings are English by
 * definition, so `file${n === 1 ? "" : "s"}` is correct for them. The catalog
 * has no plural mechanism, which is a real gap for the keys these become — it
 * is called out in the handoff rather than papered over with a phrasing nobody
 * would write.
 *
 * WHAT IS NOT IN HERE. Anything a translated key already says well enough is
 * NOT duplicated here: file-type and file-size errors reuse
 * `portal.photoWrongType` / `portal.photoTooLarge` / `portal.photoFailed`, the
 * name field reuses `portal.nameLabel` / `portal.nameHint`, and the "nothing
 * answered" message reuses `survey.requiredMissing` whenever the survey has a
 * required question. Reaching for the catalog first is the point; this object
 * should get smaller and then disappear.
 */
const PENDING_PORTAL_COPY = {
  /** → survey.other */
  other: "Other",
  /** → survey.otherPlaceholder */
  otherPlaceholder: "Please specify",
  /** → survey.notRated */
  notRated: "Not rated",
  /** → survey.textPlaceholder */
  textPlaceholder: "Type your response",
  /** → survey.mapNotePlaceholder */
  mapNotePlaceholder: "Add a short note about this location (optional)",
  /** → survey.mapZoomHint */
  mapZoomHint: "Zoom to your neighbourhood before dropping a pin.",
  /** → survey.fileRemove */
  remove: "Remove",
  /** → survey.submitAnother */
  submitAnother: "Submit another response",
  /** → survey.noAnswers (only reached when NO question is required) */
  noAnswers: "Please answer at least one question.",
  /** → survey.reviewAnswer */
  reviewAnswer: "Please review this answer.",
  /** → survey.rankEvery */
  rankEveryOption: "Rank every option.",
  /** → survey.budgetUnitPoints */
  budgetUnitPoints: "pts",
  /** → survey.selectAtLeast */
  selectAtLeast: (count: string) => `Select at least ${count}.`,
  /** → survey.selectAtMost */
  selectAtMost: (count: string) => `Select at most ${count}.`,
  /** → survey.selectBetween */
  selectBetween: (min: string, max: string) => `Select at least ${min} and at most ${max}.`,
  /** → survey.ratingValue */
  ratingValue: (value: string, max: string) => `${value} of ${max}`,
  /** → survey.rankUpTo */
  rankUpTo: (count: string, one: boolean) =>
    `Rank up to ${count} option${one ? "" : "s"}, and leave the rest unranked.`,
  /** → survey.budgetAllocate */
  budgetAllocate: (amount: string) => `Allocate ${amount} across the options.`,
  /** → survey.budgetAllocateAll */
  budgetAllocateAll: (amount: string) => `Allocate the full ${amount} across the options.`,
  /** → survey.budgetAllocated */
  budgetAllocated: (allocated: string, total: string) => `Allocated ${allocated} of ${total}.`,
  /** → survey.budgetOver */
  budgetOver: (amount: string) => `That is ${amount} more than the total.`,
  /** → survey.textMinLength */
  textMinLength: (count: string) => `At least ${count} characters.`,
  /** → survey.fileHint (the max_files === 1 case reuses portal.photoHint) */
  fileHint: (count: string, one: boolean, limit: string) =>
    `Up to ${count} JPEG, PNG, or WebP file${one ? "" : "s"}, each up to ${limit}.`,
  /** → survey.fileTooMany */
  fileTooMany: (count: string, one: boolean) => `Attach at most ${count} file${one ? "" : "s"}.`,
} as const;

/**
 * A run of text in a NAMED language, wherever that differs from the page's.
 *
 * The `lang` attribute is the load-bearing part, not the wrapper: it is what a
 * screen reader uses to pick a voice, and an English sentence pronounced with
 * Farsi phonology is close to unintelligible. `dir` travels with it so an
 * English run inside an Arabic page is laid out left-to-right where it sits,
 * with its punctuation on the end a reader of THAT run expects.
 *
 * Applied UNCONDITIONALLY, including when the run is in the page's own language.
 * A conditional here is a condition somebody forgets, and the redundant
 * attribute costs nothing — the same reasoning `OperatorText` below states for
 * operator content.
 *
 * A KNOWN LIMIT of this approach: a string that is an ATTRIBUTE rather than a
 * text node — a `placeholder`, an `aria-label` — has no element of its own to
 * mark, and marking the input itself would mislabel the participant's own typed
 * value. Those are covered by the form-level disclosure instead. An `<option>`
 * cannot hold a `<span>` either, but it CAN take `lang` directly, so those are
 * marked on the element rather than left to the page.
 */
function Localized({
  lang,
  dir,
  className,
  children,
}: {
  lang: PortalLocale;
  dir: PortalTextDirection;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span lang={lang} dir={dir} className={className}>
      {children}
    </span>
  );
}

/** A run of `PENDING_PORTAL_COPY` — English by construction. */
function PendingCopy({ children }: { children: ReactNode }) {
  return (
    <Localized lang={PENDING_COPY_LOCALE} dir={PORTAL_LOCALE_DIRECTION[PENDING_COPY_LOCALE]}>
      {children}
    </Localized>
  );
}

/**
 * A sentence that is ENGLISH BY CONSTRUCTION, as a view.
 *
 * Two sources produce one: the submit route's validation messages, which are
 * English literals with a machine-readable `code` this catalog has no key for
 * yet, and `PENDING_PORTAL_COPY`. Both are held in state rather than rendered
 * inline, so both need the language travelling with them — an English sentence
 * stored now and rendered later under the page's `lang` is the same lie either
 * way, and there is no reason for the two to be told apart here.
 */
function englishSentence(text: string): PortalDisclosureView {
  return {
    sentence: text,
    lang: PENDING_COPY_LOCALE,
    dir: PORTAL_LOCALE_DIRECTION[PENDING_COPY_LOCALE],
  };
}

/**
 * ONE STRING OF PARTICIPANT-FACING COPY, CARRYING THE LANGUAGE IT CAME OUT IN.
 *
 * WHY IT IS NEEDED. `translator.t()` returns a plain string whether the catalog
 * had the participant's language or fell back to English, and every locale except
 * Spanish has no catalog at all — so on a Farsi portal EVERY sentence this form
 * renders is English while the form element around it says `lang="fa"`. Rendering
 * them bare was sanctioned by `translator.ts` ("mark each fallback, or rely on
 * the page-level disclosure"), and this form takes the first half of that choice,
 * because the page-level half alone leaves a screen reader pronouncing English
 * with Farsi phonology and leaves an English sentence laid out from the wrong
 * edge of a right-to-left page.
 *
 * WHY IT IS `provenance.ts`'s TYPE AND NOT A LOCAL ONE. `portalMessageView` is
 * already the module's answer to this exact question, and its own doc says so:
 * "anything that puts one of this catalog's strings on screen inside a page of
 * another language should get its lang and direction from here rather than
 * assume the page's". The portal, the close-the-loop list and the language
 * picker all consume it. A fourth surface with its own `{ text, lang }` would be
 * a second statement of one idea, and — because it would re-derive `dir` from
 * the locale itself — a second place for the two to drift apart. `locales.ts`
 * warns about precisely that: "a component that re-derives is a component that
 * can be forgotten."
 *
 * The shape is deliberately the SAME one a server-authored message arrives in,
 * so the two travel through one renderer: the survey submit route answers in
 * English literals, and an English validation message inside a Spanish form is
 * the same lie as an untranslated prompt.
 */
function Copy({ of, className }: { of: PortalDisclosureView; className?: string }) {
  return (
    <Localized lang={of.lang} dir={of.dir} className={className}>
      {of.sentence}
    </Localized>
  );
}

/**
 * One operator-authored string, rendered with the two things it must never be
 * rendered without: the language it is ACTUALLY in, and — via
 * `ProvenanceBadge` beside it — the label saying who wrote it.
 *
 * `lang` and `dir` are set unconditionally, including when the text is in the
 * page's own language, because a conditional here is a condition somebody
 * forgets. Setting them redundantly costs nothing; omitting them once publishes
 * an untranslated English prompt as though the agency wrote it in Spanish.
 *
 * BUT `dir` IS ONLY CLAIMED FROM A RECORDED LANGUAGE. `PortalText.textLocaleStated`
 * is false when `textLocale` is a PRESUMPTION rather than a record — the campaign
 * never said what language it was written in — and that is not an edge case: until
 * 20260729000004 is applied there is no `default_content_locale` column to state
 * it in, so EVERY operator string in the product is currently in that state.
 * Turning that presumption into `dir="ltr"` lays an Arabic-authored prompt out
 * left-to-right with its punctuation on the wrong side, which is the exact defect
 * `dir` exists to prevent. `dir="auto"` claims nothing: the browser reads the
 * first strong directional character of the string itself, which is the only
 * fact anybody actually has here.
 *
 * The `lang` half of the same problem is NOT fixed locally on purpose.
 * `portalTextLang` asserts `textLocale` as a fact even when it is presumed —
 * the very claim `portalTextDisclosure` refuses to make for the same value — and
 * three other surfaces call it. Diverging here would make four renderers
 * disagree four ways; it belongs in `provenance.ts`, once.
 */
function OperatorText({ text, className }: { text: PortalText; className?: string }) {
  return (
    <span
      lang={portalTextLang(text)}
      dir={text.textLocaleStated ? PORTAL_LOCALE_DIRECTION[text.textLocale] : "auto"}
      className={className}
    >
      {text.text}
    </span>
  );
}

/**
 * The short label on a string the agency did not write in this language.
 *
 * Renders NOTHING for operator-authored text, which is `portalTextBadge`'s
 * contract and the whole reason a badge means something: a caveat on every
 * string is a caveat residents learn to skip.
 *
 * THE BADGE'S OWN LANGUAGE IS INFERRED FROM ITS DISCLOSURE, and the inference is
 * named here rather than hidden. `portalTextBadge` returns a bare string, so
 * this component cannot ask which catalog key produced it — but the badge and
 * the disclosure sentence for one `PortalText` always come from the same
 * provenance branch (both are null for `operator` and non-null for the other
 * three), so they sit in the same section of the same catalog and fall back
 * together. The one case that would defeat it is a catalog that translates
 * `provenance.machine.label` but not `provenance.machine.caveat`. The honest fix
 * is a `portalTextBadgeView` in `provenance.ts` alongside the disclosure one;
 * that module is owned elsewhere, so it is reported rather than edited here.
 */
function ProvenanceBadge({ text, translator }: { text: PortalText; translator: PortalTranslator }) {
  const label = portalTextBadge(text, translator);
  if (!label) return null;

  const disclosure = portalTextDisclosureView(text, translator);

  return (
    <Localized
      lang={disclosure?.lang ?? translator.locale}
      dir={disclosure?.dir ?? translator.direction}
      className={cn(
        "ms-2 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 align-middle",
        "text-[0.65rem] font-medium normal-case tracking-wide",
        "border-amber-400/60 bg-amber-50 text-amber-900",
        "dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
      )}
    >
      {label}
    </Localized>
  );
}

/**
 * Operator-authored strings that live INSIDE `config_json` — a Likert scale's
 * point labels and a map question's guidance paragraph.
 *
 * They have NO translation record: `engagement_content_translations` is keyed by
 * (entity, id, field) over columns, and these are values inside a JSON blob, so
 * `loadPublicPortalBundle` cannot resolve them and no `PortalText` exists for
 * them. That is a real gap in the seam, not a gap in this component, and it is
 * in the handoff.
 *
 * Read by field NAME rather than by re-parsing each type's schema, deliberately:
 * this is one question — "does the operator have prose in here that nobody
 * translated" — and answering it through nine schemas would put the answer in
 * nine places. The two names are `likertConfigSchema.labels` and
 * `mapPointConfigSchema.guidance`; a third such field must be added here too,
 * and the test named for that keeps it honest.
 */
function configAuthoredText(question: PortalSurveyQuestion): string[] {
  const raw = (question.config ?? {}) as { labels?: unknown; guidance?: unknown };
  const found: string[] = [];

  if (Array.isArray(raw.labels)) {
    for (const label of raw.labels) {
      if (typeof label === "string" && label.trim().length > 0) found.push(label);
    }
  }
  if (typeof raw.guidance === "string" && raw.guidance.trim().length > 0) found.push(raw.guidance);

  return found;
}

/**
 * EVERY DISCLOSURE THIS QUESTION OWES ITS PARTICIPANT, deduplicated, in the
 * participant's language.
 *
 * Assembled per QUESTION rather than per string because a resident answers a
 * question, not a string: a prompt an agency wrote whose options a machine
 * translated is a question whose answer may not mean what the resident thought.
 * Deduplicated because the common case is one caveat that applies to all of it,
 * and repeating the same sentence under every option teaches people to stop
 * reading it.
 *
 * THE CONFIG-TEXT BRANCH, and its known imprecision. Strings inside
 * `config_json` (see `configAuthoredText`) can never be translated today, so
 * when the rest of the question IS translated they are the only untranslated
 * part and nothing else would say so. `provenance.untranslated.unknownSource`
 * is the right sentence: it states that the team has not published this in the
 * participant's language and claims nothing about which language it is in —
 * which is all anyone knows, since `PortalText` cannot distinguish "this string
 * is the campaign's own language" from "this string is a translation into the
 * requested language" (both arrive as `operator` + `textLocale === requested`).
 * The cost of that ambiguity is a needless caveat on a campaign authored in the
 * participant's language; the cost of the opposite choice is silence about
 * untranslated scale labels. The safe direction is to over-disclose.
 */
function questionDisclosures(question: PortalSurveyQuestion, translator: PortalTranslator): PortalDisclosureView[] {
  const texts: PortalText[] = [
    question.promptText,
    ...(question.helpTextText ? [question.helpTextText] : []),
    ...question.options.map((option) => option.labelText),
  ];

  // Keyed by sentence so the dedup is by what a resident READS. Each sentence
  // keeps the language it came out in, because a disclosure a screen reader
  // cannot pronounce is a disclosure that was not made.
  const sentences = new Map<string, PortalDisclosureView>();
  const remember = (view: PortalDisclosureView) => {
    if (!sentences.has(view.sentence)) sentences.set(view.sentence, view);
  };

  for (const text of texts) {
    const view = portalTextDisclosureView(text, translator);
    if (view) remember(view);
  }

  const hasConfigText = configAuthoredText(question).length > 0;
  const promptAlreadyDiscloses = portalTextIsFallback(question.promptText);
  if (hasConfigText && !promptAlreadyDiscloses && question.promptText.textLocaleStated) {
    remember(
      portalMessageView(translator, "provenance.untranslated.unknownSource", { language: translator.nativeName })
    );
  }

  return [...sentences.values()];
}

/** The badge for the question as a whole: the prompt's, or the first one any of its other strings carries. */
function questionBadgeText(question: PortalSurveyQuestion, translator: PortalTranslator): PortalText | null {
  if (portalTextBadge(question.promptText, translator)) return question.promptText;

  const rest: PortalText[] = [
    ...(question.helpTextText ? [question.helpTextText] : []),
    ...question.options.map((option) => option.labelText),
  ];
  return rest.find((text) => portalTextBadge(text, translator) !== null) ?? null;
}

/**
 * A saved answer as a plain record, or null.
 *
 * A draft's stored answers are read back from jsonb, so nothing here may assume
 * a shape: a widget seeded from a corrupt blob must render empty rather than
 * throw on a public form.
 */
function asAnswerRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The `{ value }` shared by the two scale widgets. */
function savedNumber(value: unknown): number | null {
  const saved = asAnswerRecord(value)?.value;
  return typeof saved === "number" && Number.isFinite(saved) ? saved : null;
}

function cfgOf<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success && parsed.data !== undefined) return parsed.data;
  const withDefaults = schema.safeParse({});
  return (withDefaults.success ? withDefaults.data : ({} as T)) as T;
}

type WidgetProps<T = unknown> = {
  question: PortalSurveyQuestion;
  /**
   * THE ANSWER THIS PARTICIPANT ALREADY GAVE, when they are resuming a saved
   * response.
   *
   * Every widget holds its own local state, so a restored answer that only
   * reached the FORM's answer map would show a blank widget over a form that
   * believes it is answered — and the participant would submit a value they
   * cannot see. Seeding is therefore per widget, from the canonical
   * `answer_json` shape the draft stored, which is the same shape the widget
   * emits. Undefined on a fresh form, which is the ordinary case.
   */
  initialAnswer?: unknown;
  /**
   * The participant's language, as a lookup. Passed EXPLICITLY to every widget
   * rather than read from a context, because a widget that can render without
   * one is a widget that will: the type is what guarantees no answer option in
   * this form can be added in English by accident.
   */
  translator: PortalTranslator;
  onChange: (answer: T | undefined) => void;
};

/** A hint above a widget — the same shape for every question type. */
function WidgetHint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// ── single_choice ─────────────────────────────────────────────────────────────
function SingleChoiceWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ allow_other?: boolean }>(singleChoiceConfigSchema, question.config);
  const saved = asAnswerRecord(initialAnswer);
  const savedOther = typeof saved?.other_text === "string" ? saved.other_text : "";
  const [selection, setSelection] = useState<string>(
    typeof saved?.option_id === "string" ? saved.option_id : savedOther ? OTHER_SENTINEL : ""
  );
  const [otherText, setOtherText] = useState(savedOther);

  function emit(nextSelection: string, nextOther: string) {
    if (!nextSelection) return onChange(undefined);
    if (nextSelection === OTHER_SENTINEL) {
      return onChange(nextOther.trim() ? { option_id: OTHER_SENTINEL, other_text: nextOther } : undefined);
    }
    onChange({ option_id: nextSelection });
  }

  return (
    <div className="space-y-2">
      <WidgetHint>
        <Copy of={portalMessageView(translator, "survey.selectOne")} />
      </WidgetHint>
      {question.options.map((option) => (
        <label key={option.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="radio"
            name={question.id}
            className="h-4 w-4"
            checked={selection === option.id}
            onChange={() => {
              setSelection(option.id);
              emit(option.id, otherText);
            }}
          />
          <OperatorText text={option.labelText} />
        </label>
      ))}
      {cfg.allow_other ? (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="radio"
              name={question.id}
              className="h-4 w-4"
              checked={selection === OTHER_SENTINEL}
              onChange={() => {
                setSelection(OTHER_SENTINEL);
                emit(OTHER_SENTINEL, otherText);
              }}
            />
            <PendingCopy>{PENDING_PORTAL_COPY.other}</PendingCopy>
          </label>
          {selection === OTHER_SENTINEL ? (
            <Input
              value={otherText}
              placeholder={PENDING_PORTAL_COPY.otherPlaceholder}
              maxLength={500}
              onChange={(event) => {
                setOtherText(event.target.value);
                emit(OTHER_SENTINEL, event.target.value);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── multiple_choice ───────────────────────────────────────────────────────────
function MultipleChoiceWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ allow_other?: boolean; min_select?: number; max_select?: number }>(
    multipleChoiceConfigSchema,
    question.config
  );
  const saved = asAnswerRecord(initialAnswer);
  const savedOther = typeof saved?.other_text === "string" ? saved.other_text : "";
  const [selected, setSelected] = useState<Set<string>>(
    new Set(Array.isArray(saved?.option_ids) ? (saved.option_ids as unknown[]).filter((id): id is string => typeof id === "string") : [])
  );
  const [otherChecked, setOtherChecked] = useState(savedOther.length > 0);
  const [otherText, setOtherText] = useState(savedOther);

  function emit(nextSelected: Set<string>, nextOtherChecked: boolean, nextOther: string) {
    const optionIds = [...nextSelected];
    const other = nextOtherChecked && nextOther.trim() ? nextOther : "";
    if (optionIds.length === 0 && !other) return onChange(undefined);
    onChange(other ? { option_ids: optionIds, other_text: other } : { option_ids: optionIds });
  }

  // The counts are formatted for the participant's locale, not stringified:
  // several of the languages here write digits differently (Arabic and Farsi
  // among them), and a limit a resident cannot read is a limit the server will
  // enforce anyway.
  const min = cfg.min_select !== undefined ? formatPortalNumber(cfg.min_select, translator.bcp47) : null;
  const max = cfg.max_select !== undefined ? formatPortalNumber(cfg.max_select, translator.bcp47) : null;
  const countHint =
    min && max
      ? PENDING_PORTAL_COPY.selectBetween(min, max)
      : min
        ? PENDING_PORTAL_COPY.selectAtLeast(min)
        : max
          ? PENDING_PORTAL_COPY.selectAtMost(max)
          : null;

  return (
    <div className="space-y-2">
      <WidgetHint>
        <Copy of={portalMessageView(translator, "survey.selectMany")} />
      </WidgetHint>
      {countHint ? (
        <WidgetHint>
          <PendingCopy>{countHint}</PendingCopy>
        </WidgetHint>
      ) : null}
      {question.options.map((option) => (
        <label key={option.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={selected.has(option.id)}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(option.id);
              else next.delete(option.id);
              setSelected(next);
              emit(next, otherChecked, otherText);
            }}
          />
          <OperatorText text={option.labelText} />
        </label>
      ))}
      {cfg.allow_other ? (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={otherChecked}
              onChange={(event) => {
                setOtherChecked(event.target.checked);
                emit(selected, event.target.checked, otherText);
              }}
            />
            <PendingCopy>{PENDING_PORTAL_COPY.other}</PendingCopy>
          </label>
          {otherChecked ? (
            <Input
              value={otherText}
              placeholder={PENDING_PORTAL_COPY.otherPlaceholder}
              maxLength={500}
              onChange={(event) => {
                setOtherText(event.target.value);
                emit(selected, otherChecked, event.target.value);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── likert ────────────────────────────────────────────────────────────────────
function LikertWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ scale: 5 | 7; labels?: string[] }>(likertConfigSchema, question.config);
  const [value, setValue] = useState<number | null>(savedNumber(initialAnswer));
  const points = Array.from({ length: cfg.scale }, (_, i) => i + 1);

  return (
    <div className="flex flex-wrap gap-2">
      {points.map((point) => {
        const label = cfg.labels?.[point - 1];
        const active = value === point;
        return (
          <button
            key={point}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setValue(point);
              onChange({ value: point });
            }}
            className={cn(
              "flex min-h-11 min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 text-sm font-semibold transition",
              active
                ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-foreground"
                : "border-border text-muted-foreground hover:border-[color:var(--pine)] hover:text-foreground"
            )}
          >
            <span>{formatPortalNumber(point, translator.bcp47)}</span>
            {/*
              A scale label is operator prose with no translation record (see
              `configAuthoredText`), so no `lang` is claimed for it: nobody
              recorded which language it is in, and asserting the page's would be
              a claim this component is not entitled to make. The question-level
              disclosure says it is not published in the participant's language.

              `dir="auto"` for the same reason the direction is not claimed in
              `OperatorText` either: an unrecorded language cannot yield a
              direction, and inheriting the page's would lay an Arabic scale
              label out left-to-right on a Spanish page. The browser reading the
              string's own first strong character is the only available fact.
            */}
            {label ? (
              <span dir="auto" className="max-w-[7rem] text-center text-[0.65rem] font-medium leading-tight">
                {label}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── rating ──────────────────────────────────────────────────────────────────
function RatingWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ max: number; allow_half?: boolean; icon?: "star" | "number" }>(ratingConfigSchema, question.config);
  const [value, setValue] = useState<number | null>(savedNumber(initialAnswer));

  const maxLabel = formatPortalNumber(cfg.max, translator.bcp47);
  const scaleLabel = (step: number) =>
    PENDING_PORTAL_COPY.ratingValue(formatPortalNumber(step, translator.bcp47), maxLabel);

  // Half-steps or a numeric icon render as a plain value picker (a star strip
  // cannot express half selections accessibly). Values start at 1 — the server
  // rejects any rating < 1 (VALUE_OUT_OF_RANGE), so 0.5 must never be offered.
  if (cfg.allow_half || cfg.icon === "number") {
    const steps: number[] = [];
    for (let v = 1; v <= cfg.max; v += cfg.allow_half ? 0.5 : 1) steps.push(v);
    return (
      <select
        className={SELECT_CLASS}
        value={value === null ? "" : String(value)}
        onChange={(event) => {
          const next = event.target.value === "" ? null : Number(event.target.value);
          setValue(next);
          onChange(next === null ? undefined : { value: next });
        }}
      >
        {/*
          The VALUES stay raw — `Number(event.target.value)` parses them and the
          server validates them, so a localized numeral here would break the
          answer. Only what a resident READS is localized.
        */}
        <option value="" lang={PENDING_COPY_LOCALE}>
          {PENDING_PORTAL_COPY.notRated}
        </option>
        {steps.map((step) => (
          // `lang` on the option itself: "3 of 5" carries an English word and an
          // `<option>` cannot hold a span to mark it with.
          <option key={step} value={step} lang={PENDING_COPY_LOCALE}>
            {scaleLabel(step)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: cfg.max }, (_, i) => i + 1).map((star) => {
        const active = value !== null && star <= value;
        return (
          <button
            key={star}
            type="button"
            aria-label={scaleLabel(star)}
            aria-pressed={active}
            onClick={() => {
              const next = value === star ? null : star;
              setValue(next);
              onChange(next === null ? undefined : { value: next });
            }}
            className="rounded p-1 text-muted-foreground transition hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Star className={cn("h-6 w-6", active ? "fill-amber-400 text-amber-400" : "")} />
          </button>
        );
      })}
      {value !== null ? (
        <span className="ms-2 text-sm text-muted-foreground">
          <PendingCopy>{scaleLabel(value)}</PendingCopy>
        </span>
      ) : null}
    </div>
  );
}

// ── ranking ──────────────────────────────────────────────────────────────────
function RankingWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ max_ranked?: number; require_full: boolean }>(rankingConfigSchema, question.config);
  const [ranks, setRanks] = useState<Record<string, number>>(() => {
    const saved = asAnswerRecord(initialAnswer)?.ranking;
    if (!Array.isArray(saved)) return {};
    const restored: Record<string, number> = {};
    saved.forEach((optionId, index) => {
      if (typeof optionId === "string") restored[optionId] = index + 1;
    });
    return restored;
  });
  const rankCap = cfg.max_ranked ?? question.options.length;
  const maxRank = Math.min(rankCap, question.options.length);

  function emit(nextRanks: Record<string, number>) {
    const ordered = question.options
      .filter((option) => nextRanks[option.id] !== undefined && nextRanks[option.id] > 0)
      .sort((left, right) => nextRanks[left.id] - nextRanks[right.id])
      .map((option) => option.id);
    onChange(ordered.length ? { ranking: ordered } : undefined);
  }

  return (
    <div className="space-y-2">
      <WidgetHint>
        <Copy of={portalMessageView(translator, "survey.rankHint")} />
      </WidgetHint>
      <WidgetHint>
        <PendingCopy>
          {cfg.require_full
            ? PENDING_PORTAL_COPY.rankEveryOption
            : PENDING_PORTAL_COPY.rankUpTo(formatPortalNumber(rankCap, translator.bcp47), rankCap === 1)}
        </PendingCopy>
      </WidgetHint>
      {question.options.map((option) => {
        const current = ranks[option.id];
        // Ranks already taken by OTHER options are hidden so two options can
        // never share a position — a tie would otherwise be emitted as a false
        // strict order (stable-sort tiebreak) and pass server validation.
        const takenByOthers = new Set(
          question.options
            .filter((other) => other.id !== option.id)
            .map((other) => ranks[other.id])
            .filter((rank): rank is number => rank !== undefined)
        );
        return (
          <div key={option.id} className="flex items-center justify-between gap-3">
            <OperatorText text={option.labelText} className="text-sm text-foreground" />
            <select
              aria-label={option.labelText.text}
              className="h-9 w-28 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
              value={current ? String(current) : ""}
              onChange={(event) => {
                const next = { ...ranks };
                if (event.target.value === "") delete next[option.id];
                else next[option.id] = Number(event.target.value);
                setRanks(next);
                emit(next);
              }}
            >
              <option value="">—</option>
              {Array.from({ length: maxRank }, (_, i) => i + 1)
                .filter((rank) => rank === current || !takenByOthers.has(rank))
                .map((rank) => (
                  // Raw value, localized label — same rule as the rating picker.
                  <option key={rank} value={rank}>
                    {formatPortalNumber(rank, translator.bcp47)}
                  </option>
                ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ── map_point ────────────────────────────────────────────────────────────────
function MapPointWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{
    geometry_types: ("Point" | "LineString" | "Polygon")[];
    guidance?: string;
    center?: [number, number];
    zoom?: number;
  }>(mapPointConfigSchema, question.config);
  const saved = asAnswerRecord(initialAnswer);
  /**
   * A RESTORED LOCATION IS KEPT, EVEN THOUGH THE MAP CANNOT REDRAW IT.
   *
   * `GeometryPickerMap` takes a camera but no starting geometry, so a resumed
   * answer cannot be shown as a shape on the map. Dropping it instead would
   * throw away the most laborious answer on the form — somebody found their
   * street on a phone — and, worse, the note field's `emit` would then overwrite
   * the saved geometry with nothing the moment they typed. So the geometry is
   * held here and the participant is TOLD it is still attached and how to
   * replace it. Silence would leave them looking at an empty map believing their
   * pin was lost.
   */
  const [geometry, setGeometry] = useState<EngagementGeometry | null>(
    (saved?.geometry as EngagementGeometry | undefined) ?? null
  );
  const [replaced, setReplaced] = useState(false);
  const [note, setNote] = useState(typeof saved?.note === "string" ? saved.note : "");

  const allowedModes = cfg.geometry_types.map((type) => GEO_TYPE_TO_MODE[type]);
  const keptFromDraft = Boolean(saved?.geometry) && !replaced;

  function emit(nextGeometry: EngagementGeometry | null, nextNote: string) {
    if (!nextGeometry) return onChange(undefined);
    onChange(nextNote.trim() ? { geometry: nextGeometry, note: nextNote } : { geometry: nextGeometry });
  }

  return (
    <div className="space-y-2">
      <WidgetHint>
        <Copy of={portalMessageView(translator, "survey.mapHint")} />
      </WidgetHint>
      {/*
        Operator prose with no translation record — see `configAuthoredText`. No
        `lang` is claimed and `dir="auto"` is used for the reason the Likert scale
        labels use it: nobody recorded which language this paragraph is in, so its
        direction is read off the text rather than presumed from the page.
      */}
      {cfg.guidance ? (
        <WidgetHint>
          <span dir="auto">{cfg.guidance}</span>
        </WidgetHint>
      ) : null}
      {/*
        Say where this map is, on the same terms as the portal's own map one tab
        over. `cfg.center` is what the picker will actually use, so the "you are
        looking at a continent" hint is keyed off the camera that exists rather
        than off a second guess about it.

        The sentence itself is composed in English server-side, so it is marked
        as English rather than shown as though it were the page's language.
      */}
      {question.mapFramingNote ? (
        <WidgetHint>
          <PendingCopy>
            {question.mapFramingNote}
            {cfg.center ? null : ` ${PENDING_PORTAL_COPY.mapZoomHint}`}
          </PendingCopy>
        </WidgetHint>
      ) : null}
      <div className="public-map-frame public-map-frame--editor">
        <GeometryPickerMap
          onGeometryChange={(next) => {
            setReplaced(true);
            setGeometry(next);
            emit(next, note);
          }}
          initialMode={allowedModes[0]}
          allowedModes={allowedModes}
          initialCenter={cfg.center}
          initialZoom={cfg.zoom}
        />
      </div>
      {keptFromDraft ? (
        <WidgetHint>
          <Copy of={portalMessageView(translator, "survey.draftLocationKept")} />
        </WidgetHint>
      ) : null}
      <Input
        value={note}
        placeholder={PENDING_PORTAL_COPY.mapNotePlaceholder}
        maxLength={500}
        onChange={(event) => {
          setNote(event.target.value);
          emit(geometry, event.target.value);
        }}
      />
    </div>
  );
}

// ── budget_allocation ─────────────────────────────────────────────────────────

/**
 * A budget amount in the participant's locale, in the unit the OPERATOR chose.
 *
 * `usd` and `percent` are formatted by `Intl`, which places the symbol where the
 * reader's language places it — a `$` glued to the front of a number is wrong in
 * most of the languages this portal carries and reads backwards in the
 * right-to-left ones. The currency
 * code is not a jurisdiction assumption invented here: it is the config's own
 * declared `unit`, and `budgetConfigSchema` offering only `usd` is an upstream
 * limit worth widening in survey.ts, not one this component may guess around.
 *
 * `points` returns the bare number. Its unit word has no catalog key, so it is
 * rendered separately beside the inputs as pending English rather than being
 * spliced into an otherwise-translated sentence.
 */
function formatBudgetAmount(amount: number, unit: "usd" | "points" | "percent", bcp47: string): string {
  if (unit === "usd") {
    return formatPortalNumber(amount, bcp47, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  // `style: "percent"` reads a fraction, and the config states whole percents.
  if (unit === "percent") {
    return formatPortalNumber(amount / 100, bcp47, { style: "percent", maximumFractionDigits: 2 });
  }
  return formatPortalNumber(amount, bcp47);
}

/**
 * The unit mark beside a budget input, WRITTEN THE WAY THIS LANGUAGE WRITES IT.
 *
 * A literal `"$"` / `"%"` stood here, and both are wrong in some of the
 * languages this portal carries:
 * Arabic writes the percent sign as ٪, and several locales set a currency mark
 * after the number rather than before it. `Intl` already carries that data, so
 * the mark is READ OUT of a formatted zero rather than typed in — which also
 * means this component holds no currency glyph of its own. The currency CODE is
 * still the config's declared unit, never a guess about where the agency is.
 *
 * Null when there is nothing to show. `points` has no `Intl` unit, and the
 * allocation sentence above the inputs states the unit in full either way, so a
 * missing mark costs no fact.
 */
function budgetUnitSymbol(unit: "usd" | "points" | "percent", bcp47: string): string | null {
  if (unit === "points") return null;

  try {
    const parts = new Intl.NumberFormat(
      bcp47,
      unit === "usd" ? { style: "currency", currency: "USD" } : { style: "percent" }
    ).formatToParts(0);
    return parts.find((part) => part.type === "currency" || part.type === "percentSign")?.value ?? null;
  } catch {
    return null;
  }
}

function BudgetWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ total: number; unit: "usd" | "points" | "percent"; must_allocate_all: boolean }>(
    budgetConfigSchema,
    question.config
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const saved = asAnswerRecord(initialAnswer)?.allocations;
    if (!Array.isArray(saved)) return {};
    const restored: Record<string, string> = {};
    for (const allocation of saved) {
      const record = asAnswerRecord(allocation);
      if (typeof record?.option_id === "string" && typeof record.amount === "number") {
        restored[record.option_id] = String(record.amount);
      }
    }
    return restored;
  });

  const total = cfg.total ?? 0;
  const sum = question.options.reduce((carried, option) => carried + (Number(amounts[option.id]) || 0), 0);
  const remaining = total - sum;
  const amount = (value: number) => formatBudgetAmount(value, cfg.unit, translator.bcp47);
  const unitSymbol = budgetUnitSymbol(cfg.unit, translator.bcp47);

  function emit(nextAmounts: Record<string, string>) {
    const allocations = question.options
      .map((option) => ({ option_id: option.id, amount: Number(nextAmounts[option.id]) || 0 }))
      .filter((allocation) => allocation.amount > 0);
    onChange(allocations.length ? { allocations } : undefined);
  }

  return (
    <div className="space-y-2">
      <WidgetHint>
        <PendingCopy>
          {cfg.must_allocate_all
            ? PENDING_PORTAL_COPY.budgetAllocateAll(amount(total))
            : PENDING_PORTAL_COPY.budgetAllocate(amount(total))}
        </PendingCopy>
      </WidgetHint>
      {question.options.map((option) => (
        <div key={option.id} className="flex items-center justify-between gap-3">
          <OperatorText text={option.labelText} className="text-sm text-foreground" />
          <div className="flex items-center gap-1.5">
            {cfg.unit === "points" ? (
              <span className="text-xs text-muted-foreground">
                <PendingCopy>{PENDING_PORTAL_COPY.budgetUnitPoints}</PendingCopy>
              </span>
            ) : unitSymbol ? (
              // No `lang`: a currency or percent mark is a symbol rather than a
              // word, and this one came out of the participant's own locale data.
              <span className="text-xs text-muted-foreground">{unitSymbol}</span>
            ) : null}
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              aria-label={option.labelText.text}
              className="h-9 w-28"
              value={amounts[option.id] ?? ""}
              onChange={(event) => {
                const next = { ...amounts, [option.id]: event.target.value };
                setAmounts(next);
                emit(next);
              }}
            />
          </div>
        </div>
      ))}
      <p className={cn("text-xs", remaining < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        <PendingCopy>{PENDING_PORTAL_COPY.budgetAllocated(amount(sum), amount(total))}</PendingCopy>{" "}
        {remaining < 0 ? (
          <PendingCopy>{PENDING_PORTAL_COPY.budgetOver(amount(Math.abs(remaining)))}</PendingCopy>
        ) : (
          // The one budget sentence the catalog carries — in the participant's
          // language where the catalog has it, marked English where it does not.
          <Copy of={portalMessageView(translator, "survey.budgetRemaining", { amount: amount(remaining) })} />
        )}
      </p>
    </div>
  );
}

// ── free_text ────────────────────────────────────────────────────────────────
function FreeTextWidget({ question, translator, initialAnswer, onChange }: WidgetProps) {
  const cfg = cfgOf<{ max_length: number; min_length?: number; multiline: boolean }>(freeTextConfigSchema, question.config);
  const savedText = asAnswerRecord(initialAnswer)?.text;
  const [text, setText] = useState(typeof savedText === "string" ? savedText : "");

  function emit(next: string) {
    onChange(next.trim() ? { text: next } : undefined);
  }

  const shared = {
    value: text,
    maxLength: cfg.max_length,
    placeholder: PENDING_PORTAL_COPY.textPlaceholder,
    "aria-label": question.promptText.text,
  };

  return (
    <div className="space-y-1">
      {cfg.multiline ? (
        <Textarea
          {...shared}
          rows={4}
          onChange={(event) => {
            setText(event.target.value);
            emit(event.target.value);
          }}
        />
      ) : (
        <Input
          {...shared}
          onChange={(event) => {
            setText(event.target.value);
            emit(event.target.value);
          }}
        />
      )}
      {/*
        `text-end` rather than `text-right`: on an Arabic or Farsi page the
        counter belongs on the left, which is where that page's line ends.
      */}
      <p className="text-end text-xs text-muted-foreground">
        {formatPortalNumber(text.length, translator.bcp47)}/{formatPortalNumber(cfg.max_length, translator.bcp47)}
        {cfg.min_length ? (
          <>
            {" · "}
            <PendingCopy>
              {PENDING_PORTAL_COPY.textMinLength(formatPortalNumber(cfg.min_length, translator.bcp47))}
            </PendingCopy>
          </>
        ) : null}
      </p>
    </div>
  );
}

// ── file_upload ──────────────────────────────────────────────────────────────
type UploadedFile = { path: string; mime: string; size: number; original_name?: string };

function FileUploadWidget({
  question,
  translator,
  shareToken,
  onChange,
  previewMode = false,
}: WidgetProps & { shareToken: string; previewMode?: boolean }) {
  const cfg = cfgOf<{ max_files: number; max_size_bytes: number; accept: string[] }>(fileUploadConfigSchema, question.config);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<PortalDisclosureView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sizeLimit = formatPortalMegabytes(cfg.max_size_bytes, translator.bcp47);
  const fileCount = formatPortalNumber(cfg.max_files, translator.bcp47);

  function emit(next: UploadedFile[]) {
    onChange(next.length ? { files: next } : undefined);
  }

  async function handleFile(file: File | null) {
    // This is the one widget that talks to the server on selection rather than
    // on submit, so the preview guard has to reach it individually.
    if (previewMode) return;
    setUploadError(null);
    if (!file) return;
    if (files.length >= cfg.max_files) {
      setUploadError(englishSentence(PENDING_PORTAL_COPY.fileTooMany(fileCount, cfg.max_files === 1)));
      return;
    }
    if (!cfg.accept.includes(file.type)) {
      // The catalog already says this well for the portal's photo field, and the
      // accepted types are the same three. `portalMessageView` reports whether THIS locale
      // actually carries it — an English sentence a Farsi resident is told is
      // Farsi is the same defect as an unlabelled untranslated prompt.
      setUploadError(portalMessageView(translator, "portal.photoWrongType"));
      return;
    }
    if (file.size > cfg.max_size_bytes) {
      setUploadError(portalMessageView(translator, "portal.photoTooLarge", { limit: sizeLimit }));
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/photo-upload`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const payload = (await response.json()) as { error?: string; photoPath?: string };
      if (!response.ok || !payload.photoPath) {
        // The route's own words, which are English. Thrown so the catch below
        // marks it as the source language rather than as the participant's.
        throw new Error(payload.error || "");
      }
      const next = [...files, { path: payload.photoPath, mime: file.type, size: file.size, original_name: file.name }];
      setFiles(next);
      emit(next);
    } catch (error) {
      const fromServer = error instanceof Error ? error.message : "";
      setUploadError(fromServer ? englishSentence(fromServer) : portalMessageView(translator, "portal.photoFailed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeFile(path: string) {
    const next = files.filter((file) => file.path !== path);
    setFiles(next);
    emit(next);
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div key={file.path} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
          {/*
            The participant's own filename — no language is claimed for it, and
            `dir="auto"` so a resident who named their photo in Arabic sees the
            name laid out the way they typed it rather than reversed into the
            page's direction.
          */}
          <span dir="auto" className="truncate text-foreground">
            {file.original_name ?? file.path.split("/").pop()}
          </span>
          <button
            type="button"
            onClick={() => removeFile(file.path)}
            className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <PendingCopy>{PENDING_PORTAL_COPY.remove}</PendingCopy>
          </button>
        </div>
      ))}
      {files.length < cfg.max_files ? (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={cfg.accept.join(",")}
            disabled={uploading || previewMode}
            aria-label={question.promptText.text}
            // `file:me-3`, not `file:mr-3` — the gap belongs after the button in
            // reading order, which is its left on an Arabic page.
            className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:border-[color:var(--pine)]"
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
          />
          {uploading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
        </label>
      ) : null}
      {uploadError ? (
        <p className="text-xs text-destructive">
          <Copy of={uploadError} />
        </p>
      ) : null}
      <WidgetHint>
        {cfg.max_files === 1 ? (
          // The catalog carries the single-file case, which is the common one.
          <Copy of={portalMessageView(translator, "portal.photoHint", { limit: sizeLimit })} />
        ) : (
          <PendingCopy>
            {PENDING_PORTAL_COPY.fileHint(fileCount, cfg.max_files === 1, sizeLimit)}
          </PendingCopy>
        )}
      </WidgetHint>
    </div>
  );
}

function QuestionField({
  question,
  translator,
  shareToken,
  error,
  initialAnswer,
  onChange,
  previewMode = false,
}: {
  question: PortalSurveyQuestion;
  translator: PortalTranslator;
  shareToken: string;
  /** The server validator's own words — English. See `englishSentence`. */
  error?: string;
  /** This participant's saved answer, when they are resuming. */
  initialAnswer?: unknown;
  onChange: (answer: unknown) => void;
  /** Operator preview — reaches only the file widget, the one that uploads on selection. */
  previewMode?: boolean;
}) {
  const def = SURVEY_QUESTION_TYPES[question.questionType];
  const badgeText = questionBadgeText(question, translator);
  const disclosures = questionDisclosures(question, translator);

  function renderWidget() {
    switch (question.questionType) {
      case "single_choice":
        return <SingleChoiceWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "multiple_choice":
        return <MultipleChoiceWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "likert":
        return <LikertWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "rating":
        return <RatingWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "ranking":
        return <RankingWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "map_point":
        return <MapPointWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "budget_allocation":
        return <BudgetWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "free_text":
        return <FreeTextWidget question={question} translator={translator} initialAnswer={initialAnswer} onChange={onChange} />;
      case "file_upload":
        return (
          <FileUploadWidget
            question={question}
            translator={translator}
            shareToken={shareToken}
            onChange={onChange}
            previewMode={previewMode}
          />
        );
      default:
        return null;
    }
  }

  return (
    <fieldset className="rounded-xl border border-border/60 p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        <OperatorText text={question.promptText} />
        {question.required ? (
          <>
            {/*
              The asterisk is decoration; the word is the accessible name. A
              screen reader reading "asterisk" tells a resident nothing, and the
              word for it belongs in their language.
            */}
            <span className="ms-1 text-red-600 dark:text-red-400" aria-hidden="true">
              *
            </span>
            <Copy of={portalMessageView(translator, "survey.required")} className="sr-only" />
          </>
        ) : null}
        {/*
          NEAR THE QUESTION, not in a footer. A resident deciding what a question
          asks needs to know a machine worded it at the moment they read it.
        */}
        {badgeText ? <ProvenanceBadge text={badgeText} translator={translator} /> : null}
      </legend>
      {question.helpTextText ? (
        <p className="mb-3 text-xs text-muted-foreground">
          <OperatorText text={question.helpTextText} />
        </p>
      ) : null}
      {disclosures.length > 0 ? (
        <p
          className={cn(
            "mb-3 rounded-lg border px-3 py-2 text-xs",
            "border-amber-300/70 bg-amber-50/70 text-amber-900",
            "dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
          )}
        >
          {/*
            Each sentence carries its OWN language rather than being joined into
            one string under the page's. Every locale except Spanish has no
            catalog, so on those pages this disclosure is itself English — and a
            disclosure a screen reader mispronounces, or lays out from the wrong
            edge of a right-to-left page, is a disclosure that was not made.
          */}
          {disclosures.map((disclosure, index) => (
            <span key={disclosure.sentence}>
              {index > 0 ? " " : null}
              <Copy of={disclosure} />
            </span>
          ))}
        </p>
      ) : null}
      <div className="mt-1">{renderWidget()}</div>
      {error ? (
        <p className="mt-2 text-xs text-destructive">
          <PendingCopy>{error}</PendingCopy>
        </p>
      ) : null}
      {/* The question TYPE, from the operator taxonomy in survey.ts — English. */}
      <p className="sr-only">
        <PendingCopy>{def?.label}</PendingCopy>
      </p>
    </fieldset>
  );
}

/**
 * WHAT THE FORM IS CURRENTLY TELLING A PARTICIPANT ABOUT THEIR SAVED ANSWERS.
 *
 * One closed set, because every one of these is a CLAIM about a resident's own
 * work and the wrong one is a lie: "saved" carries the date the promise runs to,
 * "gone" is only ever said when the server said 404, and `checkFailed` exists
 * precisely so a failed request is never reported as an absent draft. A single
 * boolean `saved` flag could not tell those apart.
 */
type DraftNotice =
  | { kind: "saved"; expiresAt: string | null; filesNotSaved: boolean }
  | { kind: "restored"; savedAt: string | null }
  | { kind: "gone" }
  | { kind: "checkFailed" }
  | { kind: "saveFailed"; serverSentence: string | null }
  | { kind: "discarded" };

/**
 * Participant survey renderer. Collects one answer per question (each widget
 * emits the canonical answer_json shape that the submit route re-validates via
 * validateSurveyAnswer), then POSTs the whole response to the confined survey
 * submit path. Mirrors the comment SubmissionForm's honeypot + banner posture.
 *
 * THE HIGHEST-STAKES PARTICIPANT SURFACE IN THE PRODUCT, and why that decides
 * how this component is typed. A comment a resident writes in the wrong language
 * is still their comment; a survey question a resident MISUNDERSTANDS produces a
 * wrong answer that enters the planning record and gets counted, and a wrong
 * answer is worse than no answer. So neither the participant's language nor a
 * question's provenance is optional here: `messages` and `PortalText` are
 * required props, and a caller that has not resolved them does not compile.
 */
export function PublicSurveyForm({
  shareToken,
  questions,
  messages,
  previewMode = false,
}: {
  shareToken: string;
  questions: PortalSurveyQuestion[];
  /**
   * Operator preview: render the survey exactly as a resident gets it, and send
   * nothing — no submit, no draft save, no draft resume. Guarded at every
   * handler as well as at the buttons; see `previewMode` on
   * `PublicEngagementPortal`, which is the only surface that sets this.
   */
  previewMode?: boolean;
  /**
   * OpenPlan's own participant copy in the participant's language, already
   * resolved server-side, plus which keys fell back to English.
   *
   * A bundle rather than a lookup function because functions cannot cross the
   * server/client boundary, and rather than a locale code because that would
   * make this component import the catalog and ship every language to one
   * resident's phone. `loadPublicPortalBundle` puts it on `PublicPortalProps`,
   * so the render site already has it.
   *
   * REQUIRED. The defect that has bitten this repo repeatedly is a finished
   * capability made unreachable by a prop nobody passed; a default English
   * bundle here would turn "the portal forgot to pass the language" into a
   * silently English survey inside a Spanish page, which is precisely the
   * failure this work exists to remove.
   */
  messages: PortalMessageBundle;
}) {
  // Answers keyed by questionId; undefined = unanswered (skipped on submit).
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submittedBy, setSubmittedBy] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<PortalDisclosureView | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Remounts every widget on "submit another" so local widget state resets.
  const [formNonce, setFormNonce] = useState(0);

  // ── Save and resume ────────────────────────────────────────────────────────
  /** The credential for this browser's saved draft, if it holds one. */
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState<DraftNotice | null>(null);
  /** Answers a resumed draft returned — seeded into the widgets themselves. */
  const [restoredAnswers, setRestoredAnswers] = useState<Record<string, unknown>>({});

  const translator = useMemo(() => createPortalTranslator(messages), [messages]);

  /**
   * WHICH QUESTIONS APPLY TO THIS PARTICIPANT RIGHT NOW.
   *
   * Computed from `resolveSurveyVisibility` — the SAME function the submit route
   * runs before it stores anything. Two implementations of one rule is how a
   * form comes to hide a question the server still requires (unsubmittable) or
   * show one the server will discard (a wasted answer). There is one rule.
   */
  const visibilityQuestions = useMemo(
    () => questions.map((question) => ({ id: question.id, question_type: question.questionType, config: question.config })),
    [questions]
  );
  const visibility = useMemo(
    () => resolveSurveyVisibility(visibilityQuestions, answers),
    [visibilityQuestions, answers]
  );
  const visibleQuestions = useMemo(
    () => questions.filter((question) => visibility.visible.has(question.id)),
    [questions, visibility]
  );
  const hasConditionalQuestions = useMemo(
    () => questions.some((question) => readSurveyVisibilityCondition(question.config) !== null),
    [questions]
  );

  const draftStorageKey = `openplan.survey.draft.${shareToken}`;

  /**
   * Browser storage, defensively.
   *
   * Safari in private mode throws on `localStorage`, and a survey that crashes
   * because it could not remember a token is worse than one that simply cannot
   * offer resume. Both helpers fail quiet; the save button then still works and
   * the participant is told what saving does and does not do.
   */
  function readStoredToken(): string | null {
    try {
      return window.localStorage.getItem(draftStorageKey);
    } catch {
      return null;
    }
  }
  function writeStoredToken(token: string | null) {
    try {
      if (token === null) window.localStorage.removeItem(draftStorageKey);
      else window.localStorage.setItem(draftStorageKey, token);
    } catch {
      // Nothing to do: the draft still exists server-side until it expires, and
      // this browser simply cannot reopen it. Claiming otherwise is the failure
      // to avoid, and the notice below never claims it.
    }
  }

  // Reopen a saved draft on arrival. Runs once per share token.
  useEffect(() => {
    // The only fetch in this form that fires without a click, so the preview
    // guard has to live here too, not just on the buttons.
    if (previewMode) return;
    let cancelled = false;
    const token = readStoredToken();
    if (!token) return;

    void (async () => {
      try {
        const response = await fetch(`/api/engage/${shareToken}/survey/draft/resume`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resumeToken: token }),
        });
        if (cancelled) return;
        if (response.status === 404) {
          // The draft expired or was discarded. The token is useless now, and
          // the participant is told rather than left wondering.
          writeStoredToken(null);
          setDraftNotice({ kind: "gone" });
          return;
        }
        if (!response.ok) {
          // A FAILED CHECK IS NOT AN ABSENT DRAFT. The token is KEPT, because
          // the answers are probably still there — telling somebody their work
          // is gone on the strength of a failed request is a false claim about
          // their own answers.
          setDraftNotice({ kind: "checkFailed" });
          return;
        }
        const payload = (await response.json()) as {
          answers?: { questionId: string; answer: unknown }[];
          savedAt?: string;
        };
        const restored: Record<string, unknown> = {};
        for (const entry of payload.answers ?? []) restored[entry.questionId] = entry.answer;
        setResumeToken(token);
        setRestoredAnswers(restored);
        setAnswers(resolveSurveyVisibility(visibilityQuestions, restored).answers);
        // Remount the widgets so each one seeds itself from the restored answer.
        setFormNonce((nonce) => nonce + 1);
        setDraftNotice({ kind: "restored", savedAt: payload.savedAt ?? null });
      } catch {
        if (!cancelled) setDraftNotice({ kind: "checkFailed" });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  function setAnswer(questionId: string, answer: unknown) {
    setAnswers((previous) => {
      const next = { ...previous };
      if (answer === undefined) delete next[questionId];
      else next[questionId] = answer;
      // ANSWERS TO QUESTIONS THAT NO LONGER APPLY ARE DROPPED HERE, not filtered
      // at submit time. A hidden question's widget unmounts and loses its local
      // state, so an answer left in this map would be one the form believes in
      // and the participant cannot see — and would then be sent to a server that
      // discards it anyway.
      return resolveSurveyVisibility(visibilityQuestions, next).answers;
    });
  }

  /**
   * A DROPPED ANSWER IS DROPPED FROM THE RESUME SEED TOO.
   *
   * Otherwise a resumed answer comes back the moment its question applies
   * again: the widget re-mounts and seeds itself from the restored draft, while
   * `answers` has already let that answer go — and a widget that seeds itself
   * does not emit. The resident would read their own sentence in the box and
   * the form would submit without it, which is the same defect as a stale
   * answer, pointing the other way. The box and the payload have to agree, and
   * blank is the one that matches what will actually be sent.
   */
  useEffect(() => {
    setRestoredAnswers((seeded) => {
      const stale = Object.keys(seeded).filter((questionId) => !visibility.visible.has(questionId));
      if (stale.length === 0) return seeded;
      const remaining = { ...seeded };
      for (const questionId of stale) delete remaining[questionId];
      return remaining;
    });
  }, [visibility]);

  /**
   * A DROPPED ANSWER IS DROPPED FROM THE RESUME SEED TOO.
   *
   * Otherwise a resumed answer comes back the moment its question applies
   * again: the widget re-mounts and seeds itself from the restored draft, while
   * `answers` has already let that answer go — and a widget that seeds itself
   * does not emit. The resident would read their own sentence in the box and
   * the form would submit without it, which is the same defect as a stale
   * answer, pointing the other way. The box and the payload have to agree, and
   * blank is the one that matches what will actually be sent.
   */

  /** The answers this participant would submit, in payload shape. */
  function currentPayloadAnswers(): { questionId: string; answer: unknown }[] {
    return Object.entries(answers)
      .filter(([questionId, answer]) => answer !== undefined && visibility.visible.has(questionId))
      .map(([questionId, answer]) => ({ questionId, answer }));
  }

  async function saveDraft() {
    if (previewMode) return;
    setDraftNotice(null);
    setIsSavingDraft(true);
    try {
      const send = (token: string | null) =>
        fetch(`/api/engage/${shareToken}/survey/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            answers: currentPayloadAnswers(),
            ...(token ? { resumeToken: token } : {}),
          }),
        });

      let response = await send(resumeToken);
      // The draft this browser knew about is gone (expired, or discarded from
      // another tab). Saving again as a NEW draft keeps the participant's work,
      // which is the only outcome that matters to them.
      if (response.status === 404 && resumeToken) {
        writeStoredToken(null);
        setResumeToken(null);
        response = await send(null);
      }

      const payload = (await response.json()) as {
        error?: string;
        resumeToken?: string;
        expiresAt?: string;
        filesNotSaved?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "");

      if (payload.resumeToken) {
        setResumeToken(payload.resumeToken);
        writeStoredToken(payload.resumeToken);
      }
      setDraftNotice({
        kind: "saved",
        expiresAt: payload.expiresAt ?? null,
        filesNotSaved: Boolean(payload.filesNotSaved),
      });
    } catch (saveError) {
      const fromServer = saveError instanceof Error ? saveError.message : "";
      setDraftNotice({ kind: "saveFailed", serverSentence: fromServer || null });
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function discardDraft() {
    if (previewMode) return;
    if (!resumeToken) return;
    setIsSavingDraft(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/survey/draft`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeToken }),
      });
      /**
       * A REQUEST THAT CAME BACK IS NOT A DELETION THAT HAPPENED.
       *
       * `fetch` rejects only on a network failure, so a 500 from the route
       * arrives here as a perfectly ordinary response. Treating it as success
       * would tell a resident "your saved answers have been discarded" about
       * answers still sitting in the database — and, worse, would then throw
       * away the ONLY credential that could ever discard them, leaving their
       * part-finished demographics there for the full retention window with
       * nobody able to reach them. The token is kept and the failure is said.
       */
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setDraftNotice({ kind: "saveFailed", serverSentence: payload.error || null });
        setIsSavingDraft(false);
        return;
      }
    } catch {
      // Reported below as a failure rather than as a discard that happened.
      setDraftNotice({ kind: "saveFailed", serverSentence: null });
      setIsSavingDraft(false);
      return;
    }
    writeStoredToken(null);
    setResumeToken(null);
    setDraftNotice({ kind: "discarded" });
    setIsSavingDraft(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewMode) return;
    setError(null);
    setFieldErrors({});

    const payloadAnswers = currentPayloadAnswers();

    if (payloadAnswers.length === 0) {
      // SAME CHECK, translated words. The condition is unchanged — nothing
      // answered, no request — because the server validator is the authority on
      // what a valid response is and its contract must not move. Only what the
      // resident READS changes.
      //
      // Which sentence: with a required question on the form, "answer the
      // required questions" is both true and in the catalog, so a Spanish
      // resident gets Spanish. With nothing required it would be false, so the
      // weaker English sentence is used and marked as English.
      setError(
        visibleQuestions.some((question) => question.required)
          ? portalMessageView(translator, "survey.requiredMissing")
          : englishSentence(PENDING_PORTAL_COPY.noAnswers)
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/survey/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: payloadAnswers,
          submittedBy: submittedBy || undefined,
          // Names the draft this response finishes, so the server deletes it.
          // A part-finished copy of somebody's answers outliving the finished
          // one is data nobody asked us to keep.
          ...(resumeToken ? { resumeToken } : {}),
          website,
        }),
      });
      const payload = (await response.json()) as { error?: string; questionId?: string };
      if (!response.ok) {
        // The route's validation messages are English literals (it returns a
        // `code` beside them, but the catalog has no key per
        // `SurveyAnswerErrorCode` yet — see the handoff). They are shown as the
        // server's own words, marked English, rather than passed off as the
        // participant's language.
        if (payload.questionId) {
          setFieldErrors({ [payload.questionId]: payload.error || PENDING_PORTAL_COPY.reviewAnswer });
        }
        throw new Error(payload.error || "");
      }
      // The response is in. The draft is the server's to delete (it was told the
      // token above); this browser forgets its credential either way, so a
      // "resume" cannot reopen answers that have already been submitted.
      writeStoredToken(null);
      setResumeToken(null);
      setDraftNotice(null);
      setSubmitted(true);
    } catch (submitError) {
      const fromServer = submitError instanceof Error ? submitError.message : "";
      setError(fromServer ? englishSentence(fromServer) : portalMessageView(translator, "survey.submitFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * WHAT THIS FORM IS NOT SAYING IN THE PARTICIPANT'S LANGUAGE.
   *
   * Rendered whenever the page is not in the language OpenPlan's copy is written
   * in. TWO different things make that necessary and one condition covers both:
   * `PENDING_PORTAL_COPY` is not empty, so some of this form's widget copy has
   * no catalog key and is English on every locale; and a locale with no catalog
   * at all falls every key back to English, which `PortalMessageBundle` reports
   * but which `translator.t` returns as a plain string. `translator.ts` offers a
   * surface two ways to be honest about that — "mark each fallback, or rely on
   * the page-level disclosure that `hasFallbacks` drives" — and this form does
   * BOTH: `portalMessageView` marks each fallback run with `lang="en"` for a screen reader,
   * and this sentence tells a reader who is not using one. Neither substitutes
   * for the other, because unlabelled English inside an otherwise-Spanish form
   * tells a resident the agency chose to write it that way, and under Title VI an
   * agency can be held to what it appears to have published.
   *
   * It uses `language.partialNotice`, a catalog key, so the disclosure is in the
   * participant's language wherever a catalog exists — and on the locales
   * where none does yet, the disclosure is itself one of the English runs it is
   * disclosing, and is marked as English like the rest. The page may carry the
   * same sentence from `PortalLanguageNotice`; that duplication is accepted
   * deliberately, because this form is reached through a tab and a disclosure a
   * resident has to scroll away to find is one they will not read.
   *
   * THE CONDITION IS THE PAGE'S LANGUAGE ALONE, and that is not a shortcut for
   * the two reasons above — it is a third fact that outlives both. The
   * question-TYPE label rendered `sr-only` in every fieldset is
   * `SURVEY_QUESTION_TYPES[...].label`, an operator-taxonomy string from
   * `survey.ts` that this catalog has no key for and is not proposed one, so a
   * screen-reader participant meets English on this form on every non-English
   * locale no matter how complete the catalog becomes. Landing the proposed keys
   * shrinks what is untranslated; it does not make this notice false, and
   * retiring it would have to wait on that label too.
   */
  /**
   * The draft notice as ONE sentence carrying the language it is in.
   *
   * Built through `portalMessageView` like every other run of copy on this form,
   * so a Spanish resident reads Spanish and a Farsi resident is TOLD the
   * sentence is English rather than having it pronounced as Farsi. The dates are
   * formatted for the participant's locale — a retention promise written
   * "7/3/2026" names a different day to most of the world.
   */
  function draftNoticeView(notice: DraftNotice): PortalDisclosureView {
    switch (notice.kind) {
      case "saved":
        return notice.expiresAt
          ? portalMessageView(translator, "survey.draftSaved", {
              date: formatPortalDate(notice.expiresAt, translator.bcp47),
            })
          : // No expiry came back, so the sentence that names one must not be
            // shown. The weaker, still-true sentence is used instead.
            portalMessageView(translator, "survey.draftDeviceOnly", {
              days: formatPortalNumber(SURVEY_DRAFT_RETENTION_DAYS, translator.bcp47),
            });
      case "restored":
        return notice.savedAt
          ? portalMessageView(translator, "survey.draftRestored", {
              date: formatPortalDate(notice.savedAt, translator.bcp47),
            })
          : portalMessageView(translator, "survey.draftDeviceOnly", {
              days: formatPortalNumber(SURVEY_DRAFT_RETENTION_DAYS, translator.bcp47),
            });
      case "gone":
        return portalMessageView(translator, "survey.draftGone");
      case "checkFailed":
        return portalMessageView(translator, "survey.draftCheckFailed");
      case "discarded":
        return portalMessageView(translator, "survey.draftDiscarded");
      case "saveFailed":
        // The route's own words when it sent any — English, and marked as such
        // rather than passed off as the participant's language.
        return notice.serverSentence
          ? englishSentence(notice.serverSentence)
          : portalMessageView(translator, "survey.draftSaveFailed");
    }
  }

  const hasUntranslatedCopy = translator.locale !== PENDING_COPY_LOCALE;

  // The whole form is one language and one direction. Set here rather than
  // inherited: this is a client island reached through a tab, and a `dir` that
  // depends on an ancestor another surface owns is a `dir` that goes missing.
  const rootLanguage = { lang: translator.bcp47, dir: translator.direction } as const;

  if (submitted) {
    return (
      <div className="public-success-state" {...rootLanguage}>
        <CheckCircle2 className="mx-auto h-9 w-9 text-[color:var(--pine)]" />
        <h3 className="mt-4 text-xl font-semibold text-foreground">
          <Copy of={portalMessageView(translator, "survey.received")} />
        </h3>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            <Copy of={portalMessageView(translator, "portal.whatHappensNext")} />
          </p>
          <p>
            <Copy of={portalMessageView(translator, "portal.receivedDetail")} />
          </p>
          <p>
            <Copy of={portalMessageView(translator, "portal.reviewNotice")} />
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => {
            setSubmitted(false);
            setAnswers({});
            // The previous response's restored answers must not seed the next
            // one — a second respondent on a shared phone would find somebody
            // else's answers already filled in.
            setRestoredAnswers({});
            setSubmittedBy("");
            setWebsite("");
            setError(null);
            setFieldErrors({});
            setFormNonce((nonce) => nonce + 1);
          }}
        >
          <PendingCopy>{PENDING_PORTAL_COPY.submitAnother}</PendingCopy>
        </Button>
      </div>
    );
  }

  return (
    <form className="public-form-shell" onSubmit={handleSubmit} {...rootLanguage}>
      {hasUntranslatedCopy ? (
        <p
          className={cn(
            "mb-4 rounded-lg border px-3 py-2 text-xs",
            "border-amber-300/70 bg-amber-50/70 text-amber-900",
            "dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
          )}
        >
          <Copy of={portalMessageView(translator, "language.partialNotice", { language: translator.nativeName })} />
        </p>
      ) : null}

      {/*
        Said BEFORE the questions, once, when the survey actually has a
        condition in it. A resident who watches a question disappear as they
        answer has been given no reason to trust the form unless it said this
        first — and a survey with no conditions must not claim to have any.
      */}
      {hasConditionalQuestions ? (
        <p className="mb-4 text-xs text-muted-foreground">
          <Copy of={portalMessageView(translator, "survey.conditionalNote")} />
        </p>
      ) : null}

      {draftNotice ? (
        <p
          role="status"
          className={cn(
            "mb-4 rounded-lg border px-3 py-2 text-xs",
            draftNotice.kind === "saveFailed" || draftNotice.kind === "checkFailed"
              ? "border-red-300/80 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              : "border-border/70 bg-muted/40 text-muted-foreground"
          )}
        >
          <Copy of={draftNoticeView(draftNotice)} />
          {draftNotice.kind === "saved" && draftNotice.filesNotSaved ? (
            <>
              {" "}
              <Copy of={portalMessageView(translator, "survey.draftFilesNotSaved")} />
            </>
          ) : null}
        </p>
      ) : null}

      <div key={formNonce} className="space-y-4">
        {/*
          ONLY THE QUESTIONS THAT APPLY. A question gated on an earlier answer is
          not rendered disabled or greyed — it is absent, because a form that
          shows somebody eight questions they cannot answer is the burden this
          feature exists to remove. The server re-decides the same thing before
          storing anything.
        */}
        {visibleQuestions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            translator={translator}
            shareToken={shareToken}
            error={fieldErrors[question.id]}
            initialAnswer={restoredAnswers[question.id]}
            onChange={(answer) => setAnswer(question.id, answer)}
            previewMode={previewMode}
          />
        ))}

        <div className="space-y-1.5">
          <label htmlFor="survey-submitted-by" className="text-sm font-medium text-foreground">
            <Copy of={portalMessageView(translator, "portal.nameLabel")} />{" "}
            <span className="font-normal text-muted-foreground">
              (<Copy of={portalMessageView(translator, "survey.optional")} />)
            </span>
          </label>
          {/*
            The translated hint replaces the old English "Leave blank to respond
            anonymously" placeholder: it carries the same fact — this is
            optional — in the participant's language, and a placeholder cannot be
            marked with a `lang` of its own.
          */}
          <p id="survey-submitted-by-hint" className="text-xs text-muted-foreground">
            <Copy of={portalMessageView(translator, "portal.nameHint")} />
          </p>
          <Input
            id="survey-submitted-by"
            aria-describedby="survey-submitted-by-hint"
            value={submittedBy}
            maxLength={200}
            onChange={(event) => setSubmittedBy(event.target.value)}
          />
        </div>
      </div>

      {/*
        Honeypot — hidden from real users; bots fill it in. Deliberately NOT
        translated: it is `aria-hidden`, so no participant and no screen reader
        ever reads it, and a translated honeypot would be a tell.

        `-start-[9999px]` rather than `-left-[9999px]`: on an Arabic page the
        offscreen direction that keeps it out of the reading flow is the other
        one.
      */}
      <div className="absolute -start-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="survey-website">Website</label>
        <input
          id="survey-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {error ? (
        <p className="mb-4 mt-4 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <Copy of={error} />
        </p>
      ) : null}

      {/*
        SAVE AND FINISH LATER, stated with exactly what it does.
        `survey.draftDeviceOnly` is not decoration: the resume credential is held
        in THIS browser and nowhere else, so a resident who saves on a library
        computer and comes back on their phone would otherwise find their answers
        missing with no explanation. The retention number in that sentence is the
        same constant the server writes into the row's expiry.
      */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-3 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSavingDraft || isSubmitting || previewMode}
          onClick={() => void saveDraft()}
        >
          {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <Copy
            of={
              isSavingDraft
                ? portalMessageView(translator, "survey.savingDraft")
                : portalMessageView(translator, "survey.saveForLater")
            }
          />
        </Button>
        {resumeToken ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isSavingDraft || isSubmitting || previewMode}
            onClick={() => void discardDraft()}
          >
            <Trash2 className="h-4 w-4" />
            <Copy of={portalMessageView(translator, "survey.draftDiscard")} />
          </Button>
        ) : null}
        <p className="basis-full text-xs text-muted-foreground">
          <Copy
            of={portalMessageView(translator, "survey.draftDeviceOnly", {
              days: formatPortalNumber(SURVEY_DRAFT_RETENTION_DAYS, translator.bcp47),
            })}
          />
        </p>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <Copy of={portalMessageView(translator, "portal.reviewNotice")} />
        </p>
        <Button
          type="submit"
          disabled={isSubmitting || previewMode}
          className="min-w-[13rem] justify-center"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <Copy of={isSubmitting ? portalMessageView(translator, "survey.submitting") : portalMessageView(translator, "survey.submit")} />
        </Button>
      </div>
    </form>
  );
}
