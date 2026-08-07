/**
 * THE OPERATOR SIDE OF PORTAL TRANSLATION — what an agency has to say in
 * another language, what it has already said, and what it may claim about that.
 *
 * WHAT WAS MISSING. `portal-i18n/` can resolve one operator-authored string into
 * a participant's language and label its provenance, and
 * `engagement_content_translations` (20260729000004) can store the rows. Nothing
 * WROTE them. Every per-locale branch of the resolver was therefore unreachable:
 * a campaign could never be anything but its own language plus OpenPlan's own
 * chrome. This module is the write side's vocabulary, and it is deliberately the
 * ONE place that answers three questions the UI and the API must never answer
 * differently.
 *
 *   1. WHICH STRINGS COUNT. The inventory below is built from the SAME reads the
 *      public portal makes — active survey questions, active options, PUBLISHED
 *      close-loop entries. An archived question's untranslated prompt is not a
 *      gap in what the public sees, and counting it would make "complete" a
 *      claim nobody could ever reach. `loadCampaignTranslatableFields` filters
 *      the way `loadSurveyDefinition` and `loadPublishedCloseLoopEntries` filter,
 *      and a test pins the two together so they cannot drift apart.
 *
 *   2. WHAT "COMPLETE" MEANS. Every translatable field, not some — because "we
 *      published in Spanish" is a claim an agency will make from this screen and
 *      may be held to. And a page whose operator strings are all translated is
 *      still partly English if OpenPlan's own chrome is not, so the panel reads
 *      `portalMessageCoverage` alongside this and states both halves.
 *
 *   3. WHETHER THE ORIGINAL MOVED. An agency edits the English title and the
 *      Spanish quietly becomes a translation of a sentence that no longer
 *      exists — worse than having no Spanish, because it looks maintained.
 *      `source_text_hash` exists for exactly this; `hashTranslationSource` is
 *      the one definition of it, used by the writer and by the reader.
 *
 * WHY THE ROUTE REBUILDS THE INVENTORY INSTEAD OF TRUSTING THE REQUEST. A
 * translation is addressed polymorphically (`entity_type` + `entity_id`), so a
 * client that could name its own address could write a translation onto ANOTHER
 * campaign's category. Validating every requested field against this
 * campaign's own inventory is what makes that impossible — the campaign scope
 * comes from the database, never from the body.
 *
 * SERVER MODULE. `createHash` is a node import, so a CLIENT COMPONENT MUST
 * IMPORT FROM HERE WITH `import type` ONLY — the same contract, and the same
 * hazard, as `src/lib/reports/narrative-drafts.ts`. Everything a panel needs at
 * runtime is precomputed here and handed over as props;
 * `campaign-translations-panel-imports-types-only` in
 * `an-operator-can-author-a-campaigns-translations.test.tsx` fails the build if
 * that slips.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PORTAL_DEFAULT_LOCALE, PORTAL_LOCALES, isPortalLocale, type PortalLocale } from "./portal-i18n/locales";
import type { PortalTranslatableEntity } from "./portal-i18n/operator-text";
import {
  TRANSLATION_LANGUAGE_LABELS,
  TRANSLATION_LANGUAGE_NATIVE_LABELS,
} from "./translation-languages";
import { looksLikePendingSchema } from "@/lib/workspaces/membership";
// One answer to "does this deployment have the survey draft column?", shared
// with the portal loader this inventory is pinned to.
import { looksLikePendingSurveyStatusColumn } from "./survey-responses";

/**
 * Only `from` is used, so a caller-RLS client and a service-role client both
 * fit. Spelled as a `Pick` rather than a hand-written builder chain for the
 * reason `operator-text.ts` records: describing the overloaded chain explicitly
 * blows the compiler's instantiation depth at every call site.
 */
type QueryClient = Pick<SupabaseClient, "from">;

/** Who produced a stored translation. The table's `source` domain. */
export type CampaignTranslationSource = "operator" | "machine";

/**
 * The projection every read here uses. Named once because the untyped-client
 * convention means a column typo is `undefined` at runtime and silent at build;
 * a test asserts every column in this string exists on the table.
 */
export const CAMPAIGN_TRANSLATION_COLUMNS =
  "entity_type, entity_id, field, locale, translated_text, source, machine_model, source_text_hash";

/** How many strings one machine-translation request may ask for. */
export const MACHINE_TRANSLATION_BATCH_MAX = 25;

/**
 * How many translations one `accept` request may promote.
 *
 * Larger than the machine batch because accepting spends nothing and touches
 * rows that already exist, and because the control an operator actually reaches
 * for is "accept ALL the machine translations in this language" — a campaign
 * with a thirty-question survey passes two hundred translatable strings without
 * being unusual. Exported so the panel slices to the same number the route
 * enforces: a button that offers a batch the API answers 400 to is a refusal
 * nobody can act on.
 */
export const TRANSLATION_ACCEPT_BATCH_MAX = 200;

/**
 * The usage bucket machine translation of PORTAL CONTENT meters into.
 *
 * Its own key rather than a borrowed one: recording a campaign-title
 * translation as `engagement_synthesis` would make the usage record lie about
 * what was spent on what. It is NOT yet a member of
 * `AI_RATE_LIMIT_BUCKET_KEYS`, so the route passes it explicitly when it counts
 * — which bounds this route by everything including itself. Adding it to that
 * list is a one-line change in a file this one does not own.
 */
export const ENGAGEMENT_CONTENT_TRANSLATION_BUCKET = "engagement_content_translation";

/** Which part of the campaign a string belongs to, for grouping on screen. */
export type CampaignTranslatableGroup = "campaign" | "category" | "survey_question" | "close_loop_entry";

export type CampaignTranslatableField = {
  /**
   * `entity:id:field` — one stable identity for a React key, for the client's
   * draft map, and for the write request. The route resolves it back to an
   * address through this campaign's own inventory, so a key naming something
   * outside this campaign resolves to nothing.
   */
  key: string;
  entity: PortalTranslatableEntity;
  entityId: string;
  /** The source column's own name, which is what the table stores. */
  field: string;
  /** Operator-facing name of the string. English: this is the staff console. */
  label: string;
  /** The text as the agency wrote it, in the campaign's own language. */
  sourceText: string;
  /** Whether the editor should be a textarea rather than a single line. */
  multiline: boolean;
  group: CampaignTranslatableGroup;
  /** Heading the field sits under — the operator's own words for the thing. */
  groupKey: string;
  groupLabel: string;
};

export function campaignTranslationFieldKey(
  entity: PortalTranslatableEntity,
  entityId: string,
  field: string
): string {
  return `${entity}:${entityId}:${field}`;
}

/**
 * The hash stored in `source_text_hash`, and the hash compared against it.
 *
 * TRIMMED AND NOTHING ELSE. Collapsing whitespace or folding case would hide a
 * real edit — "Bike lane" becoming "bike lane" changes what a translator should
 * see — while trimming only absorbs the trailing newline a textarea adds, which
 * is not a change to the sentence. One function, called by the writer and by
 * the reader, because two definitions of "the same text" is how a staleness
 * flag comes to be permanently on or permanently off.
 */
export function hashTranslationSource(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

function snippet(text: string, max = 60): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A field is only translatable if there is something there to translate. */
function present(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

export type CampaignTranslatableSource = {
  campaign: {
    id: string;
    title?: string | null;
    summary?: string | null;
    public_description?: string | null;
  };
  categories: Array<{ id: string; label?: string | null; description?: string | null }>;
  surveyQuestions: Array<{
    id: string;
    prompt?: string | null;
    help_text?: string | null;
    options: Array<{ id: string; label?: string | null }>;
  }>;
  closeLoopEntries: Array<{
    id: string;
    theme_title?: string | null;
    you_said?: string | null;
    we_did?: string | null;
  }>;
};

/**
 * Every string a participant reads in the campaign's own language, in the order
 * a portal presents them.
 *
 * PURE, so the whole "what counts as complete" rule is testable without a
 * database. The reads that feed it are below.
 */
export function buildCampaignTranslatableFields(
  source: CampaignTranslatableSource
): CampaignTranslatableField[] {
  const fields: CampaignTranslatableField[] = [];

  const push = (
    entity: PortalTranslatableEntity,
    entityId: string,
    field: string,
    label: string,
    text: string | null,
    options: { multiline: boolean; group: CampaignTranslatableGroup; groupKey: string; groupLabel: string }
  ) => {
    if (!text) return;
    fields.push({
      key: campaignTranslationFieldKey(entity, entityId, field),
      entity,
      entityId,
      field,
      label,
      sourceText: text,
      multiline: options.multiline,
      group: options.group,
      groupKey: options.groupKey,
      groupLabel: options.groupLabel,
    });
  };

  const campaignGroup = {
    group: "campaign" as const,
    groupKey: "campaign",
    groupLabel: "This campaign",
  };
  push("campaign", source.campaign.id, "title", "Campaign title", present(source.campaign.title), {
    multiline: false,
    ...campaignGroup,
  });
  push("campaign", source.campaign.id, "summary", "Campaign summary", present(source.campaign.summary), {
    multiline: true,
    ...campaignGroup,
  });
  push(
    "campaign",
    source.campaign.id,
    "public_description",
    "Public description",
    present(source.campaign.public_description),
    { multiline: true, ...campaignGroup }
  );

  for (const category of source.categories) {
    const label = present(category.label);
    const group = {
      group: "category" as const,
      groupKey: `category:${category.id}`,
      groupLabel: label ? `Topic: ${label}` : "Topic",
    };
    push("category", category.id, "label", "Topic name", label, { multiline: false, ...group });
    push("category", category.id, "description", "Topic description", present(category.description), {
      multiline: true,
      ...group,
    });
  }

  source.surveyQuestions.forEach((question, index) => {
    const prompt = present(question.prompt);
    const group = {
      group: "survey_question" as const,
      groupKey: `survey_question:${question.id}`,
      groupLabel: prompt ? `Question ${index + 1}: ${snippet(prompt)}` : `Question ${index + 1}`,
    };
    push("survey_question", question.id, "prompt", "Question", prompt, { multiline: true, ...group });
    push("survey_question", question.id, "help_text", "Question help text", present(question.help_text), {
      multiline: true,
      ...group,
    });
    for (const option of question.options) {
      // An answer option is as participant-facing as the question above it: a
      // Spanish survey whose answers are in English cannot be answered.
      push("survey_question_option", option.id, "label", "Answer option", present(option.label), {
        multiline: false,
        ...group,
      });
    }
  });

  for (const entry of source.closeLoopEntries) {
    const theme = present(entry.theme_title);
    const group = {
      group: "close_loop_entry" as const,
      groupKey: `close_loop_entry:${entry.id}`,
      groupLabel: theme ? `Update: ${snippet(theme)}` : "Update",
    };
    push("close_loop_entry", entry.id, "theme_title", "Theme", theme, { multiline: false, ...group });
    push("close_loop_entry", entry.id, "you_said", "“You said”", present(entry.you_said), {
      multiline: true,
      ...group,
    });
    push("close_loop_entry", entry.id, "we_did", "“We did”", present(entry.we_did), {
      multiline: true,
      ...group,
    });
  }

  return fields;
}

/** A read that failed, named the way the panel discloses it. */
export type CampaignTranslationReadFailure = {
  /**
   * What could not be read, as a SELF-CONTAINED lowercase noun phrase that reads
   * correctly mid-sentence — "this campaign's survey questions", not "survey
   * questions". The panel drops it into more than one sentence, and a label that
   * relies on the surrounding wording to supply its article produced "This
   * campaign's this campaign's translations could not be read" the moment a
   * second sentence was added. Carrying the whole phrase is what makes the label
   * portable between them.
   */
  label: string;
  message: string;
  /**
   * True when the message says the relation is absent — a deployment whose
   * database has not had 20260729000004 applied yet. A different sentence from
   * "the read failed", because the fix is a migration rather than a policy.
   */
  schemaPending: boolean;
};

/**
 * A COLUMN this build names that the database does not have yet.
 *
 * `looksLikePendingSchema` recognizes a missing TABLE — "relation … does not
 * exist", "could not find the table", "schema cache". 20260729000004 adds BOTH a
 * table and a column (`engagement_campaigns.default_content_locale`), and a
 * missing column says none of those things.
 *
 * Checked against PostgREST rather than reasoned about, because the exact string
 * is the whole test. On a database with this migration unapplied the table
 * answers PGRST205 "Could not find the table
 * 'public.engagement_content_translations' in the schema cache" — matched by the
 * shared predicate — while the column answers 42703 "column
 * engagement_campaigns.default_content_locale does not exist", which is matched
 * by neither. Without this line the one deployment window this feature was
 * designed to survive tells an operator to investigate a broken read whose
 * actual fix is applying a migration.
 *
 * Composed here rather than widened in `looksLikePendingSchema`, which is shared
 * by unrelated callers whose 503-vs-500 behaviour is not this module's to change
 * — AND WIDENING IT WOULD BE WRONG ANYWAY, not merely out of scope. This repo's
 * Supabase clients are deliberately untyped, so a `.select()` string is not
 * checked against the schema and a column TYPO produces this same message. A
 * typo is a code defect that never resolves on its own; answering it with 503
 * tells every caller to come back later for something that will never arrive,
 * while 500 tells someone to go look. The narrow reading is safe HERE only
 * because this module names the exact column an unapplied migration adds.
 */
const MISSING_COLUMN_MESSAGE = /column .* does not exist/i;

function readFailure(label: string, message: string | null | undefined): CampaignTranslationReadFailure {
  const text = typeof message === "string" && message.trim() ? message.trim() : "no message reported";
  return {
    label,
    message: text,
    schemaPending: looksLikePendingSchema(text) || MISSING_COLUMN_MESSAGE.test(text),
  };
}

/**
 * The inventory, read from the database.
 *
 * FOUR SEPARATE READS, EACH REPORTING ITS OWN FAILURE. The portal's own loaders
 * (`loadSurveyDefinition`, `loadPublishedCloseLoopEntries`) swallow errors and
 * return empty collections, which is tolerable for a portal — a missing survey
 * renders as no survey — and intolerable here: an unreported failure would
 * SHRINK the inventory, and a shrunken inventory reports "complete" for a
 * language that is missing every question on the page. So the filters are
 * reproduced and the errors are surfaced, and
 * `the-translation-inventory-counts-what-a-participant-reads` asserts these
 * filters against the portal loaders' own so the two cannot drift.
 *
 * The campaign's own text arrives as a PARAMETER rather than being re-read: both
 * callers already hold it (the page from its detail read, the route from
 * `loadCampaignAccess`), and a third read of the same row could disagree with
 * what the caller is rendering.
 */
/**
 * The questions a participant is shown — active AND published.
 *
 * A DRAFT MUST NOT ENTER THE INVENTORY, for two reasons that point the same way.
 * It would report a translation gap for wording nobody can read, so "complete"
 * would move out of reach for every campaign with an unreviewed draft sitting in
 * the builder. And it would send that wording to machine translation, spending
 * an agency's Anthropic budget on sentences that may never be published — and,
 * worse, producing a Spanish string that outlives an edit to the English draft.
 *
 * The pre-migration fallback is the same one `loadSurveyDefinition` takes and is
 * correct for the same reason: with no `status` column there are no drafts.
 */
async function readTranslatableQuestions(
  supabase: QueryClient,
  campaignId: string
): Promise<{ data: unknown; error: { message: string } | null }> {
  const base = () =>
    supabase
      .from("engagement_survey_questions")
      .select("id, prompt, help_text")
      .eq("campaign_id", campaignId)
      // Only what a participant is shown. An archived question is not a gap.
      .eq("is_active", true);

  const filtered = await base()
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!filtered.error || !looksLikePendingSurveyStatusColumn(filtered.error.message)) return filtered;


  return base()
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
}

export async function loadCampaignTranslatableFields(
  supabase: QueryClient,
  campaign: CampaignTranslatableSource["campaign"]
): Promise<{ fields: CampaignTranslatableField[]; readFailures: CampaignTranslationReadFailure[] }> {
  const [categories, questions, options, closeLoop] = await Promise.all([
    supabase
      .from("engagement_categories")
      .select("id, label, description")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    readTranslatableQuestions(supabase, campaign.id),
    supabase
      .from("engagement_survey_question_options")
      .select("id, question_id, label")
      .eq("campaign_id", campaign.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("engagement_closeloop_entries")
      .select("id, theme_title, you_said, we_did")
      .eq("campaign_id", campaign.id)
      // Drafts never left the operator, so they are not part of what the public
      // reads and not part of what "complete" measures.
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const readFailures: CampaignTranslationReadFailure[] = [];
  if (categories.error) readFailures.push(readFailure("this campaign's feedback topics", categories.error.message));
  if (questions.error) readFailures.push(readFailure("this campaign's survey questions", questions.error.message));
  if (options.error) readFailures.push(readFailure("this campaign's survey answer options", options.error.message));
  if (closeLoop.error) readFailures.push(readFailure("this campaign's published updates", closeLoop.error.message));

  const optionRows = (options.data ?? []) as Array<{ id: string; question_id: string; label: string | null }>;
  const optionsByQuestion = new Map<string, Array<{ id: string; label: string | null }>>();
  for (const option of optionRows) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push({ id: option.id, label: option.label });
    optionsByQuestion.set(option.question_id, list);
  }

  const fields = buildCampaignTranslatableFields({
    campaign,
    categories: (categories.data ?? []) as CampaignTranslatableSource["categories"],
    surveyQuestions: ((questions.data ?? []) as Array<{ id: string; prompt: string | null; help_text: string | null }>).map(
      (question) => ({ ...question, options: optionsByQuestion.get(question.id) ?? [] })
    ),
    closeLoopEntries: (closeLoop.data ?? []) as CampaignTranslatableSource["closeLoopEntries"],
  });

  return { fields, readFailures };
}

export type CampaignTranslationRow = {
  entity_type?: string | null;
  entity_id?: string | null;
  field?: string | null;
  locale?: string | null;
  translated_text?: string | null;
  source?: string | null;
  machine_model?: string | null;
  source_text_hash?: string | null;
};

/**
 * Every translation this campaign has, in every language.
 *
 * ONE READ, NOT ONE PER LOCALE: the operator question is "which languages are we
 * complete in", which cannot be answered a language at a time, and one query per
 * language to answer one question is one chance to half-fail per language.
 *
 * A failed read is REPORTED, never returned as an empty set. Empty means "this
 * campaign has been translated into nothing", which is a claim about the agency;
 * a failure is a claim about the database. The panel renders the two
 * differently, and coverage is withheld entirely rather than shown as zero.
 */
export async function loadCampaignTranslations(
  supabase: QueryClient,
  campaignId: string
): Promise<{ rows: CampaignTranslationRow[]; failure: CampaignTranslationReadFailure | null }> {
  const result = await supabase
    .from("engagement_content_translations")
    .select(CAMPAIGN_TRANSLATION_COLUMNS)
    .eq("campaign_id", campaignId);

  if (result.error) {
    return { rows: [], failure: readFailure("this campaign's saved translations", result.error.message) };
  }

  return { rows: (result.data ?? []) as CampaignTranslationRow[], failure: null };
}

export type CampaignSourceLocale = {
  locale: PortalLocale;
  /**
   * FALSE when nobody recorded the campaign's language and `locale` is the
   * portal default, PRESUMED. Carried rather than hidden for the reason
   * `PortalText.textLocaleStated` exists: only one of the two sentences it
   * produces may name a language.
   */
  stated: boolean;
  failure: CampaignTranslationReadFailure | null;
};

/**
 * What language the campaign itself was written in.
 *
 * A SEPARATE READ, and deliberately so — the same split, for the same reason, as
 * `loadPortalTranslationIndex`. `default_content_locale` arrives in
 * 20260729000004, and between a deploy and its migration a select naming it
 * ERRORS. Folded into the campaign read this page already makes, that window
 * would 404 the entire campaign console. Read apart, it costs only the
 * source-language label, and the presumption is reported as a presumption.
 */
export async function loadCampaignSourceLocale(
  supabase: QueryClient,
  campaignId: string
): Promise<CampaignSourceLocale> {
  const result = await supabase
    .from("engagement_campaigns")
    .select("default_content_locale")
    .eq("id", campaignId)
    .maybeSingle();

  if (result.error) {
    return {
      locale: PORTAL_DEFAULT_LOCALE,
      stated: false,
      failure: readFailure("the language this campaign is written in", result.error.message),
    };
  }

  const candidate = (result.data ?? null) as { default_content_locale?: unknown } | null;
  const stated = isPortalLocale(candidate?.default_content_locale);

  return {
    locale: stated ? (candidate?.default_content_locale as PortalLocale) : PORTAL_DEFAULT_LOCALE,
    stated,
    failure: null,
  };
}

export type CampaignTranslationEntry = {
  /** The field this translates — `campaignTranslationFieldKey`. */
  fieldKey: string;
  locale: PortalLocale;
  text: string;
  source: CampaignTranslationSource;
  /** The model that produced a machine translation. Null for operator text. */
  model: string | null;
  /**
   * TRUE when the source text changed after this translation was made.
   *
   * Null-hash rows are never stale: a translation typed straight in may never
   * have had a hash captured, and inventing a verdict from an absent record
   * would be worse than reporting nothing.
   */
  stale: boolean;
};

/**
 * What a language can honestly be said to be, from most to least finished.
 *
 * `machine_assisted` exists because collapsing it into `operator_complete`
 * would let an agency say "we published in Spanish" about wording no person at
 * the agency ever approved — the exact distinction Title VI turns on.
 */
export type CampaignLocaleState =
  | "source_language"
  | "operator_complete"
  | "machine_assisted"
  | "partial"
  | "untranslated";

export type CampaignLocaleCoverage = {
  locale: PortalLocale;
  /** For the operator console, which is in English. */
  englishName: string;
  /** In its own script — what the language chooser a resident sees will show. */
  nativeName: string;
  /** This is the language the campaign was written in; nothing to translate. */
  isSourceLocale: boolean;
  total: number;
  operatorCount: number;
  machineCount: number;
  missingCount: number;
  staleCount: number;
  state: CampaignLocaleState;
};

function localeState(input: {
  isSourceLocale: boolean;
  total: number;
  operatorCount: number;
  machineCount: number;
  missingCount: number;
}): CampaignLocaleState {
  if (input.isSourceLocale) return "source_language";
  if (input.total === 0) return "untranslated";
  if (input.missingCount > 0) {
    return input.operatorCount + input.machineCount > 0 ? "partial" : "untranslated";
  }
  return input.machineCount > 0 ? "machine_assisted" : "operator_complete";
}

/**
 * Turn stored rows into what the panel renders, and into what the agency may
 * claim.
 *
 * PURE over data both callers already hold. Rows addressing a field that is no
 * longer part of what a participant reads — an archived question, a deleted
 * category, a field this build does not know — are DROPPED rather than counted:
 * counting them would make a language look more finished than it is, and
 * inflating coverage is the one direction of error that cannot be forgiven here.
 */
export function buildCampaignTranslationView(input: {
  fields: CampaignTranslatableField[];
  rows: CampaignTranslationRow[];
  sourceLocale: CampaignSourceLocale;
}): { entries: CampaignTranslationEntry[]; coverage: CampaignLocaleCoverage[] } {
  const fieldByKey = new Map(input.fields.map((field) => [field.key, field]));
  const entries: CampaignTranslationEntry[] = [];

  for (const row of input.rows) {
    const entity = row.entity_type;
    const entityId = row.entity_id;
    const field = row.field;
    const locale = row.locale;
    const text = typeof row.translated_text === "string" ? row.translated_text.trim() : "";
    const source = row.source === "machine" ? "machine" : row.source === "operator" ? "operator" : null;

    if (!entity || !entityId || !field || !text || !source) continue;
    if (!isPortalLocale(locale)) continue;

    const key = campaignTranslationFieldKey(entity as PortalTranslatableEntity, entityId, field);
    const target = fieldByKey.get(key);
    if (!target) continue;

    entries.push({
      fieldKey: key,
      locale,
      text,
      source,
      model: source === "machine" ? row.machine_model ?? null : null,
      stale:
        typeof row.source_text_hash === "string" && row.source_text_hash.length > 0
          ? row.source_text_hash !== hashTranslationSource(target.sourceText)
          : false,
    });
  }

  const total = input.fields.length;
  const coverage = PORTAL_LOCALES.map((locale) => {
    // The default locale counts as the source language even when nobody stated
    // one, because that is exactly what the resolver does with it — see
    // `resolveOperatorText`. The PRESUMPTION is disclosed once by the panel
    // rather than repeated on every locale's row.
    const isSourceLocale = input.sourceLocale.stated
      ? locale === input.sourceLocale.locale
      : locale === PORTAL_DEFAULT_LOCALE;

    const forLocale = entries.filter((entry) => entry.locale === locale);
    const operatorCount = forLocale.filter((entry) => entry.source === "operator").length;
    const machineCount = forLocale.filter((entry) => entry.source === "machine").length;
    const staleCount = forLocale.filter((entry) => entry.stale).length;
    const missingCount = isSourceLocale ? 0 : Math.max(total - operatorCount - machineCount, 0);

    return {
      locale,
      englishName: TRANSLATION_LANGUAGE_LABELS[locale],
      nativeName: TRANSLATION_LANGUAGE_NATIVE_LABELS[locale],
      isSourceLocale,
      total,
      operatorCount,
      machineCount,
      missingCount,
      staleCount,
      state: localeState({ isSourceLocale, total, operatorCount, machineCount, missingCount }),
    };
  });

  return { entries, coverage };
}

/**
 * The whole operator-side state of one campaign's translations, assembled from
 * the three reads above.
 *
 * THREE SEPARATE BOOLEANS, NOT ONE. Each names a different thing that may be
 * unknown, and the surface says a different sentence about each. They were one
 * derived flag once (`coverage !== null`), which quietly made "we could not read
 * the translations" and "we could not read the questions" the same fact — and a
 * render site that derives a prop is a render site where the prop drifts from
 * what it is named after. They are computed here, once, and passed through.
 *
 * `coverage` is NULL unless ALL THREE hold, and that is structural rather than
 * cosmetic. Coverage is a CLAIM — "we published this campaign in Spanish" is a
 * sentence an agency will say out loud from this screen and may be held to under
 * Title VI — and it is computed from all three reads at once: the inventory says
 * WHAT COUNTS, the translations say WHAT IS DONE, and the source locale says
 * WHICH LANGUAGE NEEDS NOTHING. Any one of them failing makes the claim
 * uncomputable, not zero, and each fails differently:
 *
 *   - translations unreadable → every language would read "not translated",
 *     which is a statement about the agency made out of a database error.
 *   - inventory incomplete → `total` SHRINKS, so a language missing every survey
 *     question can be badged "Complete — your wording". Inflating coverage is
 *     the one direction of error this module cannot forgive, and it is the more
 *     dangerous of the two because it reads as good news.
 *   - source locale unreadable → which language needs no translation at all is a
 *     guess, so both the language marked "the campaign's own" and the counts for
 *     every other language may be measured against the wrong baseline.
 *
 * Making the field nullable is what stops the false claim being made by
 * forgetting a branch.
 */
export type CampaignTranslationState = {
  fields: CampaignTranslatableField[];
  entries: CampaignTranslationEntry[];
  coverage: CampaignLocaleCoverage[] | null;
  sourceLocale: PortalLocale;
  sourceLocaleStated: boolean;
  /**
   * The translations read itself succeeded. False means every editor below is
   * empty because nothing could be READ — not because nothing is translated.
   */
  translationsReadable: boolean;
  /** Every inventory read succeeded, so `fields` is all of what a participant reads. */
  inventoryComplete: boolean;
  /**
   * FALSE when the campaign's recorded language could not be read at all.
   *
   * Distinct from `sourceLocaleStated`, and collapsing the two is exactly the
   * `untranslated`-versus-`unreadable` error the resolver documents at length
   * and then must not commit here: "nobody recorded which language this campaign
   * is written in" is a finding about the AGENCY, and it may not be manufactured
   * out of a failed query.
   */
  sourceLocaleReadable: boolean;
  /** Reads that failed. Anything absent below is unknown, not zero. */
  readFailures: CampaignTranslationReadFailure[];
};

export async function loadCampaignTranslationState(
  supabase: QueryClient,
  campaign: CampaignTranslatableSource["campaign"]
): Promise<CampaignTranslationState> {
  const [inventory, translations, sourceLocale] = await Promise.all([
    loadCampaignTranslatableFields(supabase, campaign),
    loadCampaignTranslations(supabase, campaign.id),
    loadCampaignSourceLocale(supabase, campaign.id),
  ]);

  const readFailures = [
    ...inventory.readFailures,
    ...(translations.failure ? [translations.failure] : []),
    ...(sourceLocale.failure ? [sourceLocale.failure] : []),
  ];

  const view = buildCampaignTranslationView({
    fields: inventory.fields,
    rows: translations.rows,
    sourceLocale,
  });

  const translationsReadable = translations.failure === null;
  const inventoryComplete = inventory.readFailures.length === 0;
  const sourceLocaleReadable = sourceLocale.failure === null;

  return {
    fields: inventory.fields,
    entries: view.entries,
    // Withheld, not zeroed, whenever any read the claim rests on failed.
    coverage: translationsReadable && inventoryComplete && sourceLocaleReadable ? view.coverage : null,
    sourceLocale: sourceLocale.locale,
    sourceLocaleStated: sourceLocale.stated,
    translationsReadable,
    inventoryComplete,
    sourceLocaleReadable,
    readFailures,
  };
}
