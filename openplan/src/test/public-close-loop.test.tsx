import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicCloseLoop, type PublicCloseLoopEntry } from "@/components/engagement/public-close-loop";
import { resolvePortalLocale, type PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import {
  loadPortalTranslationIndex,
  resolveOperatorText,
  type PortalTranslationIndex,
} from "@/lib/engagement/portal-i18n/operator-text";

function translatorFor(tag: string) {
  return createPortalTranslator(
    buildPortalMessageBundle(resolvePortalLocale({ requested: tag, acceptLanguage: null }))
  );
}

type TranslationRow = {
  entity_type: string;
  entity_id: string;
  field: string;
  translated_text: string;
  source: "operator" | "machine";
  machine_model?: string | null;
};

/**
 * An index built through the REAL loader, from rows shaped the way
 * `engagement_content_translations` stores them.
 *
 * Deliberately NOT `entries.set(...)` with a hand-built key: the index's lookup
 * key is private and has already changed once, and a test that reimplemented it
 * would go green against a lookup the product no longer performs. Going through
 * the loader also means the `unreadable` state below is produced by a read that
 * actually failed rather than asserted into existence — which matters, because
 * `engagement_content_translations` arrives in a migration and the read errors
 * until it is applied.
 */
async function indexFor(input: {
  locale: PortalLocale;
  rows?: TranslationRow[];
  translationsError?: string | null;
  sourceLocale?: PortalLocale | null;
}): Promise<PortalTranslationIndex> {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve(result),
      // The translations query is awaited directly, so the builder has to be
      // thenable the way postgrest-js's is.
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  }

  const client = {
    from: (table: string) =>
      table === "engagement_content_translations"
        ? chain({
            data: input.rows ?? [],
            error: input.translationsError ? { message: input.translationsError } : null,
          })
        : chain({ data: { default_content_locale: input.sourceLocale ?? null }, error: null }),
  } as unknown as Parameters<typeof loadPortalTranslationIndex>[0];

  return loadPortalTranslationIndex(client, {
    campaignId: "cccccccc-0000-4000-8000-00000000000c",
    locale: input.locale,
  });
}

function entryFrom(
  index: PortalTranslationIndex,
  input: { id: string; themeTitle: string; youSaid: string; weDid: string; categoryLabel: string | null }
): PublicCloseLoopEntry {
  return {
    id: input.id,
    themeTitle: input.themeTitle,
    youSaid: input.youSaid,
    weDid: input.weDid,
    categoryLabel: input.categoryLabel,
    themeTitleText: resolveOperatorText(
      index,
      { entity: "close_loop_entry", id: input.id, field: "theme_title" },
      input.themeTitle
    ),
    youSaidText: resolveOperatorText(
      index,
      { entity: "close_loop_entry", id: input.id, field: "you_said" },
      input.youSaid
    ),
    weDidText: resolveOperatorText(
      index,
      { entity: "close_loop_entry", id: input.id, field: "we_did" },
      input.weDid
    ),
    categoryLabelText: input.categoryLabel
      ? resolveOperatorText(
          index,
          { entity: "category", id: `${input.id}-cat`, field: "label" },
          input.categoryLabel
        )
      : null,
  };
}

const TWO_ENTRIES = [
  {
    id: "e1",
    themeTitle: "Safer crossings",
    youSaid: "Add a crosswalk at Main & 1st.",
    weDid: "Programmed a signal for FY26.",
    categoryLabel: "Safety",
  },
  {
    id: "e2",
    themeTitle: "Transit gaps",
    youSaid: "Buses skip the west side.",
    weDid: "",
    categoryLabel: null,
  },
] as const;

async function englishEntries(): Promise<PublicCloseLoopEntry[]> {
  const index = await indexFor({ locale: "en" });
  return TWO_ENTRIES.map((entry) => entryFrom(index, { ...entry }));
}

describe("PublicCloseLoop", () => {
  it("renders published entries with both the you-said and we-did sides", async () => {
    render(<PublicCloseLoop entries={await englishEntries()} translator={translatorFor("en")} />);
    expect(screen.getByText("Safer crossings")).toBeTruthy();
    expect(screen.getByText("Add a crosswalk at Main & 1st.")).toBeTruthy();
    expect(screen.getByText("Programmed a signal for FY26.")).toBeTruthy();
    expect(screen.getByText("Safety")).toBeTruthy();
    // Both sides are always labelled so the public reads it as accountability.
    expect(screen.getAllByText("You said").length).toBe(2);
    expect(screen.getAllByText("We did").length).toBe(2);
  });

  it("shows an honest empty state when nothing is published", () => {
    render(<PublicCloseLoop entries={[]} translator={translatorFor("en")} />);
    expect(screen.getByText(/has not published any updates/i)).toBeTruthy();
  });

  it("labels its own two headings in the participant's language", async () => {
    render(<PublicCloseLoop entries={await englishEntries()} translator={translatorFor("es")} />);
    expect(screen.getAllByText("Usted dijo").length).toBe(2);
    expect(screen.getAllByText("Nosotros hicimos").length).toBe(2);
    expect(screen.queryByText("You said")).toBeNull();
  });

  it("says the empty state in the participant's language too", () => {
    render(<PublicCloseLoop entries={[]} translator={translatorFor("es")} />);
    expect(screen.getByText(/todavía no ha publicado novedades/i)).toBeTruthy();
  });

  /**
   * A COMMITMENT AN AGENCY MADE AND A COMMITMENT A MODEL WORDED ARE DIFFERENT
   * THINGS. "Programmed a signal for FY26" is a sentence an agency can be held
   * to; a machine's paraphrase of it is not, and a resident is entitled to see
   * which one they are reading.
   */
  it("renders the agency's Spanish plainly, and marks a machine's Spanish as a machine's", async () => {
    const index = await indexFor({
      locale: "es",
      sourceLocale: "en",
      rows: [
        {
          entity_type: "close_loop_entry",
          entity_id: "e1",
          field: "theme_title",
          translated_text: "Cruces más seguros",
          source: "operator",
        },
        {
          entity_type: "close_loop_entry",
          entity_id: "e1",
          field: "we_did",
          translated_text: "Se programó un semáforo para el año fiscal 2026.",
          source: "machine",
          machine_model: "claude-test",
        },
      ],
    });

    render(
      <PublicCloseLoop
        entries={[entryFrom(index, { ...TWO_ENTRIES[0], categoryLabel: null })]}
        translator={translatorFor("es")}
      />
    );

    // The agency's own translation, with no caveat, because there is nothing to
    // caveat — and marked `es`, which is what it is.
    const heading = screen.getByRole("heading", { name: "Cruces más seguros" });
    expect(heading.getAttribute("lang")).toBe("es");

    // The machine's, labelled beside the words rather than in a footer.
    expect(screen.getByText("Se programó un semáforo para el año fiscal 2026.")).toBeTruthy();
    expect(screen.getByText("Traducción automática")).toBeTruthy();
    expect(screen.getByText(/Traducido automáticamente por conveniencia/i)).toBeTruthy();

    // The side nobody translated is marked as English, so a screen reader set to
    // Spanish does not read English with Spanish phonology.
    const untranslated = screen.getByText("Add a crosswalk at Main & 1st.");
    expect(untranslated.getAttribute("lang")).toBe("en");
    expect(screen.getByText("Sin traducir")).toBeTruthy();
  });

  /**
   * A `lang` WITHOUT A `dir` IS HALF A FIX, and the half that is missing is the
   * one a sighted reader sees. No browser derives direction from a language tag,
   * so an English commitment inside an Arabic portal inherits `dir="rtl"` from
   * the wrapper and lays out from the wrong edge — the paragraph ragged on the
   * side an English reader does not expect, its full stop thrown to the left.
   */
  it("lays an untranslated English commitment out left-to-right inside a right-to-left portal", async () => {
    // Arabic carries no message catalog yet, so this is also the ordinary state
    // of nine of the eleven languages rather than a contrived one.
    const index = await indexFor({ locale: "ar", sourceLocale: "en" });

    render(
      <PublicCloseLoop
        entries={[entryFrom(index, { ...TWO_ENTRIES[0], categoryLabel: null })]}
        translator={translatorFor("ar")}
      />
    );

    const untranslated = screen.getByText("Programmed a signal for FY26.");
    expect(untranslated.getAttribute("lang")).toBe("en");
    expect(untranslated.getAttribute("dir")).toBe("ltr");

    // The heading the agency wrote is the same fact and gets the same answer.
    expect(screen.getByRole("heading", { name: "Safer crossings" }).getAttribute("dir")).toBe("ltr");
  });

  /**
   * THE MIRROR CASE, which is the one that proves the direction comes from the
   * TEXT and not from a constant: an agency's own Arabic, read by a participant
   * who asked for English, has to run right-to-left inside a left-to-right page.
   */
  it("runs the agency's own Arabic right-to-left inside an English portal", async () => {
    const index = await indexFor({
      locale: "en",
      sourceLocale: "ar",
      rows: [
        {
          entity_type: "close_loop_entry",
          entity_id: "e1",
          field: "we_did",
          translated_text: "Programmed a signal for FY26.",
          source: "operator",
        },
      ],
    });

    render(
      <PublicCloseLoop
        entries={[entryFrom(index, { ...TWO_ENTRIES[0], categoryLabel: null })]}
        translator={translatorFor("en")}
      />
    );

    // `you_said` has no English row, so it stays in the campaign's stated
    // Arabic — and must be laid out as Arabic even though the page is English.
    const arabicSide = screen.getByText("Add a crosswalk at Main & 1st.");
    expect(arabicSide.getAttribute("lang")).toBe("ar");
    expect(arabicSide.getAttribute("dir")).toBe("rtl");
  });

  /**
   * The caveat is itself one of the strings that falls back. On a language with
   * no catalog it IS English, and declaring it as the participant's language
   * makes the warning commit the mistake it is warning about.
   */
  it("marks its own untranslated caveat as the English it is", async () => {
    const index = await indexFor({ locale: "ar", sourceLocale: "en" });

    render(
      <PublicCloseLoop
        entries={[entryFrom(index, { ...TWO_ENTRIES[0], categoryLabel: null })]}
        translator={translatorFor("ar")}
      />
    );

    // Arabic has no catalog, so this sentence came out of the English source.
    const caveat = screen.getAllByText(/has not published this in/i)[0];
    expect(caveat.getAttribute("lang")).toBe("en");
    expect(caveat.getAttribute("dir")).toBe("ltr");

    // And OpenPlan's own headings, which fell back for the same reason.
    const youSaid = screen.getAllByText("You said")[0];
    expect(youSaid.getAttribute("lang")).toBe("en");
    expect(youSaid.getAttribute("dir")).toBe("ltr");
  });

  it("says the translations could not be READ rather than that the agency did not translate", async () => {
    const index = await indexFor({
      locale: "es",
      sourceLocale: "en",
      translationsError: 'relation "engagement_content_translations" does not exist',
    });

    render(
      <PublicCloseLoop
        entries={[entryFrom(index, { ...TWO_ENTRIES[0], categoryLabel: null })]}
        translator={translatorFor("es")}
      />
    );

    expect(screen.getAllByText("Traducciones no disponibles").length).toBeGreaterThan(0);
    // The sentence that would have been a false claim about the agency.
    expect(screen.queryByText("Sin traducir")).toBeNull();
  });
});
