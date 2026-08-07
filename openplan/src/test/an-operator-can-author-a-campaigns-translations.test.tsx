import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerRefreshMock = vi.fn();
// The panel refreshes the route after every write so the server-computed
// coverage is re-read rather than guessed at in the browser.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefreshMock }) }));

import {
  MACHINE_TRANSLATION_BATCH_MAX,
  TRANSLATION_ACCEPT_BATCH_MAX,
  buildCampaignTranslatableFields,
  buildCampaignTranslationView,
  campaignTranslationFieldKey,
  hashTranslationSource,
  loadCampaignTranslatableFields,
  loadCampaignTranslationState,
  type CampaignTranslatableField,
  type CampaignTranslationRow,
} from "@/lib/engagement/campaign-translations";
import { loadSurveyDefinition } from "@/lib/engagement/survey-responses";
import { loadPublishedCloseLoopEntries } from "@/lib/engagement/close-loop";
import { CampaignTranslationsPanel } from "@/components/engagement/campaign-translations-panel";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * THE TWO THINGS A DEPLOYMENT WITHOUT 20260729000004 ACTUALLY SAYS.
 *
 * Both captured from a running PostgREST against a database with the migration
 * unapplied, not paraphrased — the exact wording is the whole test, because the
 * panel picks between "apply the pending migration" and "a read is broken" by
 * matching these strings. The migration adds a TABLE and a COLUMN, and they fail
 * with completely different messages: only the first says anything the shared
 * `looksLikePendingSchema` recognizes.
 */
const MISSING_TABLE_MESSAGE =
  "Could not find the table 'public.engagement_content_translations' in the schema cache";
const MISSING_COLUMN_MESSAGE = "column engagement_campaigns.default_content_locale does not exist";

/**
 * AN AGENCY CAN NOW SAY ITS OWN WORDS IN SOMEBODY ELSE'S LANGUAGE — and cannot
 * claim more than it has done.
 *
 * The engagement module could translate a resident's comment into eleven
 * languages and could not ask its own question in any of them. The storage
 * (20260729000004), the resolver (`portal-i18n/operator-text.ts`) and every
 * participant surface already existed; NOTHING WROTE THEM, so every per-locale
 * branch was unreachable. These assertions are about the three things the write
 * side is not allowed to get wrong:
 *
 *   1. WHAT COUNTS. "Complete" is a claim an agency will make out loud from this
 *      screen, so the inventory must be exactly what a participant reads — and
 *      must not silently shrink when a read fails, because a shrunken inventory
 *      reports "complete" for a language missing every survey question.
 *   2. WHO IS ANSWERABLE. An operator translation and a machine translation are
 *      different promises. Accepting promotes one into the other, which removes
 *      a caveat a resident was reading, and the screen has to say so BEFORE the
 *      click.
 *   3. WHAT IS UNKNOWN. A failed translation read is not an untranslated
 *      campaign.
 */

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

function sourceFixture() {
  return {
    campaign: {
      id: CAMPAIGN_ID,
      title: "Downtown safety listening campaign",
      summary: "Tell us where you feel unsafe walking.",
      public_description: "This campaign runs through the spring.",
    },
    categories: [
      { id: "cat-1", label: "Crossings", description: "Anything about crossing the street" },
      // A topic with no description contributes ONE string, not two: there is
      // nothing to translate, and counting it would make "complete" unreachable.
      { id: "cat-2", label: "Lighting", description: "   " },
    ],
    surveyQuestions: [
      {
        id: "q-1",
        prompt: "How safe do you feel walking here after dark?",
        help_text: "Answer for the block you live on.",
        options: [
          { id: "opt-1", label: "Very safe" },
          { id: "opt-2", label: "Not safe at all" },
        ],
      },
      { id: "q-2", prompt: "What would help most?", help_text: null, options: [] },
    ],
    closeLoopEntries: [
      {
        id: "loop-1",
        theme_title: "Lighting on the bridge",
        you_said: "The bridge is too dark at night.",
        we_did: "Lighting was added to the capital list.",
      },
    ],
  };
}

/** Every field key the fixture above produces, for the coverage arithmetic. */
function fixtureFields(): CampaignTranslatableField[] {
  return buildCampaignTranslatableFields(sourceFixture());
}

function row(overrides: Partial<CampaignTranslationRow>): CampaignTranslationRow {
  return {
    entity_type: "campaign",
    entity_id: CAMPAIGN_ID,
    field: "title",
    locale: "es",
    translated_text: "Campaña de escucha sobre seguridad en el centro",
    source: "operator",
    machine_model: null,
    source_text_hash: null,
    ...overrides,
  };
}

// ── 1. What counts as translatable ───────────────────────────────────────────

describe("the translatable inventory is exactly what a participant reads", () => {
  it("collects every operator-authored string the portal resolves, and nothing else", () => {
    const fields = fixtureFields();

    expect(fields.map((field) => field.key)).toEqual([
      campaignTranslationFieldKey("campaign", CAMPAIGN_ID, "title"),
      campaignTranslationFieldKey("campaign", CAMPAIGN_ID, "summary"),
      campaignTranslationFieldKey("campaign", CAMPAIGN_ID, "public_description"),
      campaignTranslationFieldKey("category", "cat-1", "label"),
      campaignTranslationFieldKey("category", "cat-1", "description"),
      // cat-2 contributes its label only — its description is whitespace.
      campaignTranslationFieldKey("category", "cat-2", "label"),
      campaignTranslationFieldKey("survey_question", "q-1", "prompt"),
      campaignTranslationFieldKey("survey_question", "q-1", "help_text"),
      campaignTranslationFieldKey("survey_question_option", "opt-1", "label"),
      campaignTranslationFieldKey("survey_question_option", "opt-2", "label"),
      campaignTranslationFieldKey("survey_question", "q-2", "prompt"),
      campaignTranslationFieldKey("close_loop_entry", "loop-1", "theme_title"),
      campaignTranslationFieldKey("close_loop_entry", "loop-1", "you_said"),
      campaignTranslationFieldKey("close_loop_entry", "loop-1", "we_did"),
    ]);
  });

  it("names every field with the operator's own words, so a long list stays navigable", () => {
    const fields = fixtureFields();
    const byKey = new Map(fields.map((field) => [field.key, field]));

    expect(byKey.get(campaignTranslationFieldKey("category", "cat-1", "label"))?.groupLabel).toBe(
      "Topic: Crossings"
    );
    expect(byKey.get(campaignTranslationFieldKey("survey_question", "q-2", "prompt"))?.groupLabel).toBe(
      "Question 2: What would help most?"
    );
    // An answer option belongs to its question's group, because translating a
    // prompt without its answers leaves a survey nobody can complete.
    expect(byKey.get(campaignTranslationFieldKey("survey_question_option", "opt-1", "label"))?.groupKey).toBe(
      "survey_question:q-1"
    );
  });

  it("asks the database for what a participant sees, with the portal's own filters", async () => {
    // THE COUPLING THAT KEEPS "COMPLETE" HONEST. The portal shows only ACTIVE
    // questions and options and only PUBLISHED close-loop entries. If this
    // inventory counted archived questions, no language could ever be complete;
    // if it counted draft updates, "complete" would include text no resident can
    // reach. Both loaders are run against recording clients and compared.
    const inventoryFilters = recordingClient();
    await loadCampaignTranslatableFields(inventoryFilters.client, { id: CAMPAIGN_ID, title: "x" });

    const portalSurvey = recordingClient();
    await loadSurveyDefinition(portalSurvey.client as never, CAMPAIGN_ID);

    const portalCloseLoop = recordingClient();
    await loadPublishedCloseLoopEntries(portalCloseLoop.client as never, CAMPAIGN_ID);

    expect(inventoryFilters.filtersFor("engagement_survey_questions")).toEqual(
      portalSurvey.filtersFor("engagement_survey_questions")
    );
    expect(inventoryFilters.filtersFor("engagement_survey_question_options")).toEqual(
      portalSurvey.filtersFor("engagement_survey_question_options")
    );
    expect(inventoryFilters.filtersFor("engagement_closeloop_entries")).toEqual(
      portalCloseLoop.filtersFor("engagement_closeloop_entries")
    );

    // Stated explicitly too, so a change to BOTH sides at once is still visible.
    // `status = published` was added on 2026-08-07 with the draft state, and
    // this line is where that change had to be looked at: an unpublished
    // question's untranslated prompt is not a gap in what the public reads, and
    // counting it would both put "complete" out of reach and send wording that
    // may never be published to machine translation.
    expect(inventoryFilters.filtersFor("engagement_survey_questions")).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["is_active", true],
      ["status", "published"],
    ]);
    expect(inventoryFilters.filtersFor("engagement_closeloop_entries")).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["status", "published"],
    ]);
  });

  it("reports a failed inventory read instead of shrinking the thing it measures", async () => {
    const failing = recordingClient({
      engagement_survey_questions: { data: [], error: { message: "connection reset" } },
    });

    const result = await loadCampaignTranslatableFields(failing.client, {
      id: CAMPAIGN_ID,
      title: "Downtown safety listening campaign",
    });

    // The label is a whole noun phrase so it reads correctly in either of the
    // panel's two failure sentences. See CampaignTranslationReadFailure.label.
    expect(result.readFailures.map((failure) => failure.label)).toEqual(["this campaign's survey questions"]);
    expect(result.readFailures[0].message).toContain("connection reset");
    expect(result.readFailures[0].schemaPending).toBe(false);
  });

  it("classifies an unapplied migration as a pending schema rather than a broken read", async () => {
    const pending = recordingClient({
      engagement_content_translations: { data: [], error: { message: MISSING_TABLE_MESSAGE } },
    });

    const state = await loadCampaignTranslationState(pending.client, {
      id: CAMPAIGN_ID,
      title: "Downtown safety listening campaign",
    });

    expect(state.readFailures.some((failure) => failure.schemaPending)).toBe(true);
    expect(state.translationsReadable).toBe(false);
    // THE POINT: coverage is WITHHELD, not zeroed. Eleven "not translated" cards
    // built out of a database failure would be a claim about the agency.
    expect(state.coverage).toBeNull();
  });

  it("treats a column the migration has not added yet as pending too, not as a fault to investigate", async () => {
    // 20260729000004 adds a table AND a column, and they fail differently:
    // PGRST205 for the table (which the shared predicate matches) and 42703 for
    // the column (which it does not, because the message says "column", never
    // "relation"). Left unrecognized, the one deployment window this feature was
    // built to survive told an operator to investigate a broken read whose fix
    // is `supabase migration up`.
    const pending = recordingClient({
      engagement_campaigns: { data: [], error: { message: MISSING_COLUMN_MESSAGE } },
    });

    const state = await loadCampaignTranslationState(pending.client, {
      id: CAMPAIGN_ID,
      title: "Downtown safety listening campaign",
    });

    const failure = state.readFailures.find((entry) => entry.message === MISSING_COLUMN_MESSAGE);
    expect(failure, "the source-language read failure must be reported").toBeDefined();
    expect(failure?.schemaPending).toBe(true);
    // And the failure is carried as its own fact, so the panel can avoid saying
    // nobody recorded a language when nobody could READ one.
    expect(state.sourceLocaleReadable).toBe(false);
    expect(state.coverage).toBeNull();
  });

  it("withholds coverage when the inventory it would be measured against is short", async () => {
    // The translations read SUCCEEDS here. Only the questions fail — and that
    // shrinks `total`, so a language with a translated title and no translated
    // questions would compute as complete. Coverage has to be withheld on the
    // strength of the inventory failure alone.
    const partial = recordingClient({
      engagement_survey_questions: { data: [], error: { message: "connection reset" } },
    });

    const state = await loadCampaignTranslationState(partial.client, {
      id: CAMPAIGN_ID,
      title: "Downtown safety listening campaign",
    });

    expect(state.translationsReadable).toBe(true);
    expect(state.inventoryComplete).toBe(false);
    expect(state.coverage).toBeNull();
  });

  it("reports coverage when every read it rests on succeeded", async () => {
    // Non-vacuity for the three tests above: the same loader over a healthy
    // client MUST produce coverage, or "withheld" would be indistinguishable
    // from "never computed at all".
    const healthy = recordingClient();

    const state = await loadCampaignTranslationState(healthy.client, {
      id: CAMPAIGN_ID,
      title: "Downtown safety listening campaign",
    });

    expect(state.translationsReadable).toBe(true);
    expect(state.inventoryComplete).toBe(true);
    expect(state.sourceLocaleReadable).toBe(true);
    expect(state.coverage).not.toBeNull();
  });

  it("names only columns the translations table actually has", () => {
    // The other half of the untyped-client defect: a projection naming a column
    // that does not exist fails the whole query at runtime, and `tsc` is silent.
    const schema = loadSchemaInventory();
    const columns = schema.columns("engagement_content_translations");
    expect(columns, "the 20260729000004 migration must declare this table").toBeDefined();

    const projection = readFileSync(
      path.join(process.cwd(), "src/lib/engagement/campaign-translations.ts"),
      "utf8"
    ).match(/CAMPAIGN_TRANSLATION_COLUMNS =\s*"([^"]+)"/);
    expect(projection).not.toBeNull();

    for (const column of (projection?.[1] ?? "").split(",").map((part) => part.trim())) {
      expect(columns?.has(column), `engagement_content_translations has no column "${column}"`).toBe(true);
    }

    // Every column the route writes, too — an insert naming a column the table
    // lacks is the same defect one verb over.
    for (const column of ["workspace_id", "campaign_id", "created_by", "updated_at"]) {
      expect(columns?.has(column), `engagement_content_translations has no column "${column}"`).toBe(true);
    }
  });
});

/**
 * A Supabase double that records the filters each table was queried with.
 *
 * Deliberately answers whatever result the caller registered per table, so a
 * failing read is a first-class fixture rather than a special case.
 */
function recordingClient(results: Record<string, { data: unknown[]; error: { message: string } | null }> = {}) {
  const filters = new Map<string, Array<[string, unknown]>>();

  return {
    filtersFor: (table: string) => filters.get(table) ?? [],
    client: {
      from: (table: string) => {
        const recorded: Array<[string, unknown]> = [];
        filters.set(table, recorded);
        const chain: Record<string, unknown> = {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          eq: (column: string, value: unknown) => {
            recorded.push([column, value]);
            return chain;
          },
          maybeSingle: async () => ({
            data: null,
            error: results[table]?.error ?? null,
          }),
          then: (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown) =>
            resolve(results[table] ?? { data: [], error: null }),
        };
        return chain;
      },
    } as never,
  };
}

// ── 2. What may be claimed ───────────────────────────────────────────────────

describe("what a campaign may claim about a language", () => {
  const fields = fixtureFields();
  const unstatedSource = { locale: "en" as const, stated: false, failure: null };

  function coverageFor(rows: CampaignTranslationRow[], locale: string) {
    const view = buildCampaignTranslationView({ fields, rows, sourceLocale: unstatedSource });
    return view.coverage.find((entry) => entry.locale === locale)!;
  }

  it("calls a language complete only when every string a participant reads is translated", () => {
    const complete = fields.map((field) =>
      row({
        entity_type: field.entity,
        entity_id: field.entityId,
        field: field.field,
        translated_text: `es: ${field.sourceText}`,
      })
    );

    expect(coverageFor(complete, "es").state).toBe("operator_complete");
    expect(coverageFor(complete, "es").missingCount).toBe(0);

    // One string short is PARTLY translated. Rounding this up is the whole
    // failure mode: "we published in Spanish" said over an English survey.
    expect(coverageFor(complete.slice(1), "es").state).toBe("partial");
    expect(coverageFor(complete.slice(1), "es").missingCount).toBe(1);
  });

  it("never calls a language the agency's own wording when a machine wrote any of it", () => {
    const mixed = fields.map((field, index) =>
      row({
        entity_type: field.entity,
        entity_id: field.entityId,
        field: field.field,
        source: index === 0 ? "machine" : "operator",
        machine_model: index === 0 ? "claude-haiku-4-5-20251001" : null,
      })
    );

    const coverage = coverageFor(mixed, "es");
    // Covered, yes — but not the agency's statement, and the state says so.
    expect(coverage.missingCount).toBe(0);
    expect(coverage.state).toBe("machine_assisted");
    expect(coverage.machineCount).toBe(1);
    expect(coverage.operatorCount).toBe(fields.length - 1);
  });

  it("treats the campaign's own language as needing nothing, and says whether that was recorded", () => {
    const presumed = buildCampaignTranslationView({ fields, rows: [], sourceLocale: unstatedSource });
    const english = presumed.coverage.find((entry) => entry.locale === "en")!;
    expect(english.isSourceLocale).toBe(true);
    expect(english.state).toBe("source_language");
    expect(english.missingCount).toBe(0);

    // A campaign an agency wrote in Spanish: Spanish is the source and English
    // becomes a language that needs translating like any other.
    const stated = buildCampaignTranslationView({
      fields,
      rows: [],
      sourceLocale: { locale: "es", stated: true, failure: null },
    });
    expect(stated.coverage.find((entry) => entry.locale === "es")!.state).toBe("source_language");
    expect(stated.coverage.find((entry) => entry.locale === "en")!.state).toBe("untranslated");
  });

  it("does not count a translation of something a participant no longer reads", () => {
    // An archived question's Spanish row still sits in the table. Counting it
    // would inflate coverage — the one direction of error that cannot be
    // forgiven here, because it is what turns into a false public claim.
    const orphan = row({ entity_type: "survey_question", entity_id: "q-archived", field: "prompt" });
    const view = buildCampaignTranslationView({ fields, rows: [orphan], sourceLocale: unstatedSource });

    expect(view.entries).toEqual([]);
    expect(view.coverage.find((entry) => entry.locale === "es")!.operatorCount).toBe(0);
  });

  it("ignores a row it cannot render rather than publishing a blank translation", () => {
    const view = buildCampaignTranslationView({
      fields,
      rows: [
        row({ translated_text: "   " }),
        row({ locale: "klingon" }),
        row({ source: "somebody_else" }),
      ],
      sourceLocale: unstatedSource,
    });

    expect(view.entries).toEqual([]);
  });

  it("flags a translation whose original has since been edited", () => {
    const title = fields[0];
    const fresh = row({ source_text_hash: hashTranslationSource(title.sourceText) });
    const stale = row({ source_text_hash: hashTranslationSource("What the title used to say") });

    const view = buildCampaignTranslationView({ fields, rows: [stale], sourceLocale: unstatedSource });
    expect(view.entries[0].stale).toBe(true);
    expect(view.coverage.find((entry) => entry.locale === "es")!.staleCount).toBe(1);

    expect(
      buildCampaignTranslationView({ fields, rows: [fresh], sourceLocale: unstatedSource }).entries[0].stale
    ).toBe(false);

    // A row with no hash is not stale. A translation typed straight in may never
    // have had one captured, and inventing a verdict from an absent record is
    // worse than reporting nothing.
    expect(
      buildCampaignTranslationView({ fields, rows: [row({})], sourceLocale: unstatedSource }).entries[0].stale
    ).toBe(false);
  });

  it("hashes trimmed text, so a trailing newline is not an edit and a changed word is", () => {
    expect(hashTranslationSource("Bike lane\n")).toBe(hashTranslationSource("Bike lane"));
    expect(hashTranslationSource("Bike lane")).not.toBe(hashTranslationSource("bike lane"));
  });
});

// ── 3. The screen an operator uses ───────────────────────────────────────────

describe("the operator panel", () => {
  const fields = fixtureFields();

  function panelProps(overrides: Partial<Parameters<typeof CampaignTranslationsPanel>[0]> = {}) {
    return {
      campaignId: CAMPAIGN_ID,
      fields,
      entries: [],
      coverage: buildCampaignTranslationView({
        fields,
        rows: [],
        sourceLocale: { locale: "en" as const, stated: false, failure: null },
      }).coverage,
      sourceLocale: "en" as const,
      sourceLocaleStated: false,
      readFailures: [],
      translationsReadable: true,
      inventoryComplete: true,
      sourceLocaleReadable: true,
      machineTranslationAvailable: true,
      machineBatchMax: MACHINE_TRANSLATION_BATCH_MAX,
      acceptBatchMax: TRANSLATION_ACCEPT_BATCH_MAX,
      canWrite: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("imports its shared vocabulary type-only, keeping node:crypto out of the browser", () => {
    // `campaign-translations.ts` hashes source text with node:crypto. A VALUE
    // import from a client component would drag that into a browser bundle and
    // break the build at deploy time rather than here.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/engagement/campaign-translations-panel.tsx"),
      "utf8"
    );
    const imports = source.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+"@\/lib\/engagement\/campaign-translations"/g);
    const found = [...imports];
    expect(found).toHaveLength(1);
    expect(found[0][1], "the panel must use `import type` for campaign-translations").toBe("type ");
  });

  it("gives a right-to-left language a right-to-left editor", () => {
    render(<CampaignTranslationsPanel {...panelProps()} />);

    // Arabic and Farsi are two of the eleven. A declared language with a
    // left-to-right editor underneath is broken with extra steps.
    fireEvent.click(screen.getByRole("button", { name: /العربية/ }));

    const editors = screen.getAllByLabelText(/^In .*Arabic/);
    expect(editors.length).toBe(fields.length);
    expect(editors[0]).toHaveAttribute("dir", "rtl");
    expect(editors[0]).toHaveAttribute("lang", "ar");
  });

  it("marks the campaign's own text with the campaign's own language", () => {
    render(<CampaignTranslationsPanel {...panelProps()} />);

    const group = screen.getByRole("region", { name: "This campaign" });
    const original = within(group).getByText("Downtown safety listening campaign");
    // A screen reader told the page is Arabic pronounces an English paragraph
    // inside it as Arabic. Marking the run in its actual language is the fix.
    expect(original).toHaveAttribute("lang", "en");
    expect(original).toHaveAttribute("dir", "ltr");
  });

  it("shows a machine translation as machine, with the caveat a resident will read", () => {
    const titleKey = fields[0].key;
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          entries: [
            {
              fieldKey: titleKey,
              locale: "es",
              text: "Campaña de escucha sobre seguridad en el centro",
              source: "machine",
              model: "claude-haiku-4-5-20251001",
              stale: false,
            },
          ],
        })}
      />
    );

    expect(screen.getByText(/Machine translation — participants are told/)).toBeInTheDocument();
    // The SENTENCE, in Spanish, produced by the same resolver the portal calls —
    // not a paraphrase an operator has to trust.
    const caveat = screen.getByText(/Traducido automáticamente por conveniencia/);
    expect(caveat).toBeInTheDocument();
    // Spanish HAS a catalog, so the sentence really is Spanish and is marked so.
    expect(caveat).toHaveAttribute("lang", "es");
    expect(screen.getByText(/claude-haiku-4-5-20251001/)).toBeInTheDocument();
  });

  it("does not tell a screen reader an untranslated caveat is in the language being edited", () => {
    // Nine of the eleven locales have no message catalog, so this preview comes
    // back as the ENGLISH source while the language being edited is Arabic. The
    // element it lands in must say so: `lang="ar" dir="rtl"` over English words
    // is the exact mistake the source text beside it already avoids, and it is
    // the one that makes a screen reader unintelligible and lays the sentence
    // out from the wrong edge. Asserted on Arabic because it fails BOTH ways
    // there, and only that combination proves the direction moved with the
    // language rather than being hard-coded to the page.
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          entries: [
            { fieldKey: fields[0].key, locale: "ar", text: "حملة الاستماع", source: "machine", model: null, stale: false },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /العربية/ }));

    const caveat = screen.getByText(/Translated by machine for convenience/i);
    expect(caveat).toHaveAttribute("lang", "en");
    expect(caveat).toHaveAttribute("dir", "ltr");
    // …while the editor beside it is still Arabic, so this is not the direction
    // plumbing having been switched off wholesale.
    expect(screen.getAllByLabelText(/^In .*Arabic/)[0]).toHaveAttribute("dir", "rtl");
  });

  it("says what accepting a machine translation does before it is clicked", () => {
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          entries: [
            { fieldKey: fields[0].key, locale: "es", text: "Campaña", source: "machine", model: null, stale: false },
          ],
        })}
      />
    );

    expect(
      screen.getByText(/Accepting makes these words your agency's own\. The machine-translation caveat/)
    ).toBeInTheDocument();
    expect(screen.getByText(/disappears, and the text is published as if someone here wrote it/)).toBeInTheDocument();
  });

  it("asks again before promoting a machine translation, and sends the promotion the route expects", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, published: "done" }), { status: 200 })
    );

    render(
      <CampaignTranslationsPanel
        {...panelProps({
          entries: [
            { fieldKey: fields[0].key, locale: "es", text: "Campaña", source: "machine", model: null, stale: false },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^accept as our wording$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toContain("Accepting makes these words your agency's own");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      action: "accept",
      locale: "es",
      fieldKeys: [fields[0].key],
    });
  });

  it("does not promote anything when the operator declines the consequence", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <CampaignTranslationsPanel
        {...panelProps({
          entries: [
            { fieldKey: fields[0].key, locale: "es", text: "Campaña", source: "machine", model: null, stale: false },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^accept as our wording$/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps hand authoring available, and names the reason, with no model key", () => {
    render(<CampaignTranslationsPanel {...panelProps({ machineTranslationAvailable: false })} />);

    expect(screen.getByText(/no Anthropic API key is configured/i)).toBeInTheDocument();
    // The capability is hand authoring; the model is an accelerator.
    expect(screen.getAllByRole("button", { name: /save as our wording/i }).length).toBe(fields.length);
    expect(screen.queryByRole("button", { name: /draft with machine translation/i })).not.toBeInTheDocument();
  });

  it("discloses that OpenPlan's own page text is not translated into every language", () => {
    render(<CampaignTranslationsPanel {...panelProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /한국어/ }));

    // Translating every operator string still leaves a page with English
    // buttons on it. An agency told that can decide what to claim.
    expect(screen.getByText(/OpenPlan’s own page text is 0 of/)).toBeInTheDocument();
    expect(screen.getByText(/sees the rest of the page in English/)).toBeInTheDocument();
  });

  it("says coverage is unknown, not zero, when the translations could not be read", () => {
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          coverage: null,
          translationsReadable: false,
          readFailures: [
            {
              label: "this campaign's saved translations",
              // The message PostgREST actually returns for this table when
              // 20260729000004 has not been applied, captured from a running
              // instance rather than imagined. See MISSING_TABLE_MESSAGE.
              message: MISSING_TABLE_MESSAGE,
              schemaPending: true,
            },
          ],
        })}
      />
    );

    expect(screen.getByText(/does not have the translation storage yet/i)).toBeInTheDocument();
    expect(screen.getByText(/That is not the same as none/)).toBeInTheDocument();
    expect(screen.queryByText("Not translated")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Unknown — could not be read/).length).toBe(fields.length);
  });

  it("writes a read failure as one sentence rather than two possessives", () => {
    // "This campaign's this campaign's translations could not be read" is what
    // an operator on an unmigrated deployment was shown, because the label
    // carried its own possessive and the sentence prefixed another. The labels
    // are whole noun phrases now, and this pins the sentence they land in.
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          coverage: null,
          translationsReadable: false,
          readFailures: [
            { label: "this campaign's saved translations", message: "connection reset", schemaPending: false },
          ],
        })}
      />
    );

    expect(screen.getByText(/OpenPlan could not read this campaign's saved translations/)).toBeInTheDocument();
    expect(screen.queryByText(/This campaign's this campaign's/)).not.toBeInTheDocument();
  });

  /**
   * THE CLAIM THAT MUST NOT BE MADE OUT OF A SHORT LIST.
   *
   * A failed inventory read does not look like an error on screen — it looks
   * like a campaign with less text in it. Every count computed from it then
   * rounds UP, so a language missing every survey question can be badged
   * "Complete — your wording", and "we published in Spanish" is a sentence an
   * agency will say out loud from this screen. Inflating coverage is the one
   * direction of error this module cannot forgive.
   */
  it("withholds coverage rather than measuring it against a list it knows is short", () => {
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          coverage: null,
          translationsReadable: true,
          inventoryComplete: false,
          readFailures: [
            { label: "this campaign's survey questions", message: "connection reset", schemaPending: false },
          ],
        })}
      />
    );

    expect(screen.getByText(/report a language as complete while the strings that failed to load/)).toBeInTheDocument();
    expect(screen.queryByText(/Complete — your wording/)).not.toBeInTheDocument();
    expect(screen.queryByText(/strings translated/)).not.toBeInTheDocument();
    // And no write control, because the route refuses in this state anyway.
    expect(screen.queryByRole("button", { name: /save as our wording/i })).not.toBeInTheDocument();
    expect(screen.getByText(/the list below is known to be short/i)).toBeInTheDocument();
  });

  /**
   * THE FINDING ABOUT THE AGENCY THAT A FAILED QUERY DOES NOT ESTABLISH.
   *
   * "Nobody has recorded which language this campaign is written in" is the same
   * class of statement as "this campaign has not been translated": both are
   * claims about what the agency did, and neither may be manufactured out of a
   * read that failed. The portal resolver keeps `untranslated` and `unreadable`
   * apart for exactly this reason; the operator side has to do it too.
   */
  it("does not report an unreadable source language as a language nobody recorded", () => {
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          coverage: null,
          sourceLocaleReadable: false,
          sourceLocaleStated: false,
          readFailures: [
            {
              label: "the language this campaign is written in",
              message: MISSING_COLUMN_MESSAGE,
              schemaPending: true,
            },
          ],
        })}
      />
    );

    expect(screen.queryByText(/Nobody has recorded which language/)).not.toBeInTheDocument();
    expect(screen.getByText(/could not be read, so OpenPlan is falling back/)).toBeInTheDocument();
    expect(screen.getByText(/a fallback, not a record/)).toBeInTheDocument();
  });

  it("never offers to accept more translations than the route will take", async () => {
    // The bulk control is the flagship action, and a campaign with a long survey
    // passes the route's cap without being unusual. A button that sends more
    // than the cap gets a 400 talking about machine translation; one that says
    // "all N" and sends fewer has misreported which sentences the agency just
    // put its name to.
    //
    // The cap is driven through the PROP rather than by rendering a campaign
    // large enough to exceed the real one — the slicing is the behaviour under
    // test, and the real constant is pinned to the route separately below.
    const machineEntries = fields.map((field) => ({
      fieldKey: field.key,
      locale: "es" as const,
      text: "traducción",
      source: "machine" as const,
      model: "claude-haiku-4-5-20251001",
      stale: false,
    }));
    expect(machineEntries.length).toBeGreaterThan(2);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 2 }), { status: 200 }));

    render(<CampaignTranslationsPanel {...panelProps({ entries: machineEntries, acceptBatchMax: 2 })} />);

    // The button counts what will actually be sent, not what is on screen.
    fireEvent.click(screen.getByRole("button", { name: /Accept 2 machine translations as our wording/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.action).toBe("accept");
    expect(body.fieldKeys).toHaveLength(2);
  });

  it("bounds the accept button by the same constant the route enforces", () => {
    // The other half: a cap the panel honours but the route does not share is
    // two numbers drifting apart. Both must name the one exported constant.
    const route = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/engagement/campaigns/[campaignId]/translations/route.ts"
      ),
      "utf8"
    );
    expect(route).toContain("fieldKeys: z.array(fieldKeySchema).min(1).max(TRANSLATION_ACCEPT_BATCH_MAX)");

    const page = readFileSync(
      path.join(process.cwd(), "src/app/(app)/engagement/[campaignId]/page.tsx"),
      "utf8"
    );
    expect(page).toContain("acceptBatchMax={TRANSLATION_ACCEPT_BATCH_MAX}");
    expect(TRANSLATION_ACCEPT_BATCH_MAX).toBeGreaterThan(MACHINE_TRANSLATION_BATCH_MAX);
  });

  it("says which strings the original moved under", () => {
    render(
      <CampaignTranslationsPanel
        {...panelProps({
          entries: [
            { fieldKey: fields[0].key, locale: "es", text: "Campaña", source: "operator", model: null, stale: true },
          ],
        })}
      />
    );

    expect(screen.getByText(/The original changed after this was translated/)).toBeInTheDocument();
  });
});
