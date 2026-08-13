/**
 * TWO WAYS A SENTENCE CAN LIE TO A PLANNER, AND BOTH SHIPPED.
 *
 * ═══ 1. A HARDCODED JURISDICTION IN UI COPY ═══
 *
 * Safety's sidebar told every workspace in the product, wherever it was:
 *
 *   "Pick a California county to also include reported crashes the source
 *    agency never geolocated."
 *
 * A planner in Columbus, Ohio was instructed to pick a California county. This
 * is the first product non-negotiable, and the damage is not that OpenPlan is
 * limited — it is that the sentence asserts to a reader that they are somewhere
 * they are not. The rule is settled: a geographic limit is DISCLOSED, never
 * silently applied and never stated as though it were universal.
 *
 * ═══ 2. A HARDCODED CAPABILITY, WHICH IS THE SAME BUG WEARING THE OTHER HAT ═══
 *
 * The first replacement named whichever source had answered and promised that
 * source could include the ungeocoded crashes "for a study area that is one
 * whole county it publishes". Rendered against a FARS retrieval that asserted a
 * county filter FARS does not have. Swapping a false claim about WHERE the
 * planner is for a false claim about what the SOURCE can do is not progress,
 * and the only reason it did not ship is that an existing caveat test rendered
 * the branch. Hence the second half of this file: the sentence may name a
 * source, and may not promise on its behalf.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { describeUngeocodedCountyOption } from "@/lib/safety/caveats";
import { stripSourceComments } from "./helpers/source-text";

describe("the mapped-area disclosure names no jurisdiction", () => {
  /**
   * Place names that must never appear. Deliberately spelled out here and
   * nowhere else in the product: a test fixture may name California, because a
   * fixture is a stand-in for one planner's data. Live copy may not, because it
   * is shown to all of them.
   */
  const PLACE_NAMES = [
    "California",
    "Ohio",
    "Columbus",
    "Sacramento",
    "Los Angeles",
    "Texas",
    "New York",
  ];

  it("names no place, with a source or without one", () => {
    const sentences = [
      describeUngeocodedCountyOption(null),
      describeUngeocodedCountyOption("Ohio Department of Public Safety crash file"),
      describeUngeocodedCountyOption("NHTSA Fatality Analysis Reporting System (FARS)"),
    ];

    for (const sentence of sentences) {
      for (const place of PLACE_NAMES) {
        // The SOURCE LABEL is exempt — it is the adapter's own name, supplied by
        // the descriptor, and a source called "Ohio Department of Public Safety"
        // must be printable. What is banned is this function inventing a place.
        // EVERY occurrence, not the first. `String.replace` with a string
        // pattern replaces once, and a draft of this disclosure named the
        // source twice — so "Ohio Department of Public Safety" survived the
        // strip and the test failed for the wrong reason, reporting a
        // hardcoded jurisdiction where there was only a repeated label.
        const withoutTheLabel = sentence
          .replaceAll("Ohio Department of Public Safety crash file", "")
          .replaceAll("NHTSA Fatality Analysis Reporting System (FARS)", "");
        expect(
          withoutTheLabel,
          `describeUngeocodedCountyOption names "${place}". A geographic limit is disclosed, never ` +
            `asserted as the reader's location.`
        ).not.toContain(place);
      }
    }
  });

  it("attributes the unmapped crashes to the source that reported them", () => {
    expect(describeUngeocodedCountyOption("Statewide crash file")).toContain(
      "crashes Statewide crash file reported but never geolocated"
    );
    // With no source yet, an honest generic rather than an invented name.
    expect(describeUngeocodedCountyOption(null)).toContain("the source agency");
    expect(describeUngeocodedCountyOption(null)).not.toContain("undefined");
    expect(describeUngeocodedCountyOption(null)).not.toContain("null");
  });

  /**
   * IT MAY NOT PROMISE ON THE SOURCE'S BEHALF.
   *
   * The sentence renders precisely when OpenPlan does NOT have a lossless county
   * filter for this selection, so any sentence of the form "<source> can do it
   * if you pick a county" is a claim about a capability the code has already
   * established it lacks here. The capability statement has to be about
   * OpenPlan's requirement, not about a named source's abilities.
   */
  it("makes no capability promise about the named source", () => {
    const label = "NHTSA Fatality Analysis Reporting System (FARS)";
    const sentence = describeUngeocodedCountyOption(label);

    // The banned shape: the source's name followed by a capability verb.
    //
    // Written as plain string arithmetic rather than a built RegExp on purpose.
    // The first version of this assertion escaped the label for a RegExp and got
    // the escaping wrong, so the pattern never matched anything and the check
    // was vacuous — mutation `M7` (restoring the false promise) sailed straight
    // past it and was caught only by an unrelated assertion failing for an
    // unrelated reason. A substring test cannot be broken that way.
    for (const verb of [" can ", " will ", " lets you ", " supports "]) {
      expect(
        sentence.includes(label + verb),
        `The disclosure says "${label}${verb}…". It renders exactly when OpenPlan has no county ` +
          `filter for this selection, so promising the named source can do it is a capability ` +
          `claim the code has already contradicted.`
      ).toBe(false);
    }

    // What it must say instead: the requirement is OpenPlan's, and this
    // selection does not meet it.
    expect(sentence).toContain("publishes a county identifier");
    expect(sentence).toContain("not");
  });
});

describe("no sr-only element is a machine identifier", () => {
  /**
   * `sr-only` IS NOT "HIDDEN" — IT IS "SHOWN ONLY TO ASSISTIVE TECHNOLOGY".
   *
   * The public engagement portal rendered:
   *
   *   <span className="sr-only" data-testid="portal-map-basemap">
   *     mapbox://styles/mapbox/streets-v12
   *   </span>
   *
   * with a comment reading "so a test can see that the picker's choice reached
   * the map. Not visible copy." Every word of that was true and it was the whole
   * problem: a blind resident arriving at a public consultation to comment on
   * their own neighbourhood had a Mapbox style URL read aloud to them, in the
   * slot reserved for content they cannot otherwise get.
   *
   * A `data-` attribute is exactly as readable to a test and completely silent
   * to a screen reader, so a test hook has no reason to ever be `sr-only`.
   *
   * This scans live components rather than one file, because the pattern is
   * cheap to repeat and the audience — people using screen readers on public
   * pages — is the least likely to be able to report it.
   */
  it("puts no style URL, id or JSON inside an sr-only element", async () => {
    // node:fs walks this recursively on Node 24, so the sweep needs no glob
    // package. It used to import fast-glob, which is not a declared dependency
    // — it resolved only because something else pulled it into node_modules,
    // and knip's `unlisted` rule (an error, unlike the unused-export warnings
    // beside it) failed the whole qa:gate on it.
    const files = ["src/components", "src/app"].flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((entry) => entry.endsWith(".tsx"))
        .map((entry) => join(process.cwd(), root, entry)),
    );

    // A machine identifier a person would never be read on purpose.
    const MACHINE_SHAPES = [/mapbox:\/\//, /\bhttps?:\/\/[a-z0-9.-]+\//i, /JSON\.stringify/];

    const offenders: string[] = [];
    for (const file of files) {
      /*
        COMMENTS COME OUT FIRST, VIA THE SHARED HELPER.

        They have to come out at all because the block explaining this very rule
        lives beside the fixed call site and quotes the offending markup — a
        guard that reads its own explanation as evidence proves nothing.

        And it has to be `stripSourceComments` rather than a local regex, for a
        reason this test learned the hard way. The first draft stripped line
        comments with `/\/\/[^\n]*​/g`, which is the obvious spelling and which
        silently defeated the whole test: `mapbox://styles/mapbox/…` CONTAINS
        `//`, so the stripper deleted the URL out of the middle of the markup and
        left `mapbox:`, matching nothing. Reverting the fix and re-running is the
        only reason that is known — the mutation SURVIVED.
        `stripSourceComments` already protects `://` (it was written after four
        private strippers disagreed) and it BLANKS rather than deletes, so the
        offsets below still point at the real line.
      */
      const source = stripSourceComments(readFileSync(file, "utf8"));
      // The element and roughly one element's worth of what follows it. Kept
      // deliberately tight: a whole-file scan would match the style URL in an
      // unrelated map component two hundred lines away.
      for (const match of source.matchAll(/className="[^"]*\bsr-only\b[^"]*"/g)) {
        const window = source.slice(match.index, match.index + 220);
        if (MACHINE_SHAPES.some((shape) => shape.test(window))) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(
            `${file.replace(process.cwd() + "/", "")}:${line}: ${window.replace(/\s+/g, " ").slice(0, 120)}`
          );
        }
      }
    }

    expect(
      offenders,
      "An sr-only element carries a machine identifier. sr-only is hidden from EYES and not from " +
        "assistive technology, so this is read aloud to screen-reader users. If it is a test hook, " +
        "move the value to a data- attribute: equally readable to a test, silent to a person.\n" +
        offenders.join("\n")
    ).toEqual([]);

    // Negative control: the sweep must actually be looking at something. If the
    // glob returned nothing, or the regex stopped matching `sr-only` at all,
    // the assertion above would pass vacuously.
    expect(files.length).toBeGreaterThan(100);
    const totalSrOnly = files.reduce(
      (count, file) => count + (readFileSync(file, "utf8").match(/\bsr-only\b/g)?.length ?? 0),
      0
    );
    expect(totalSrOnly).toBeGreaterThan(5);
  });
});
