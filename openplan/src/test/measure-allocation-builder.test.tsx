import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeasureFundSetup } from "@/components/measures/measure-fund-setup";
import { PLAIN_SCHEMA_SENTENCES, normaliseReference } from "@/components/measures/allocation-rule-draft";
import { parseMeasureAllocationRule, isNarrativeRule } from "@/lib/measures/allocation";

/**
 * THE TWO CLAUSES REAL MEASURES USE, ENTERED BY A PERSON.
 *
 * `allocation.ts` learned a weighted multi-factor return-to-source split and a
 * minimum per recipient on 2026-08-12, and for a day neither was reachable: the
 * only way to record an ordinance was to hand-write the whole rule into a text
 * box. This file renders the REAL setup form — the one the measure page mounts —
 * drives it the way a planner would, and asserts on the body that leaves for
 * the route.
 *
 * WHY THE REAL FORM AND NOT THE BUILDER ALONE. A builder that composes a perfect
 * rule and is never mounted, or is mounted behind a button nobody can press, is
 * this repository's most expensive recurring defect. The submit path is
 * exercised end to end and the fetch body is the assertion.
 *
 * WHY THE SUBMITTED RULE IS RE-PARSED HERE. The form's own gate uses
 * `parseMeasureAllocationRule`; asserting only the object shape would pass for a
 * shape the parser refuses. Handing what actually went over the wire back to the
 * parser is what proves the ordinance is recordable, and the weighted/floored
 * arithmetic is proven separately against the allocator.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const MEASURE_ID = "22222222-2222-4222-8222-222222222222";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ *
 * Driving the form the way a planner does
 * ------------------------------------------------------------------ */

function setInput(label: RegExp | string, value: string, scope?: HTMLElement) {
  const field = scope ? within(scope).getByLabelText(label) : screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
}

/**
 * Pick an option by the words on it.
 *
 * The row keys behind an option's value are internal and change with every row
 * added anywhere in the session, so the test chooses the way a person does —
 * by reading the list.
 */
function selectByOptionText(select: HTMLSelectElement, optionText: string) {
  const option = within(select).getByRole("option", { name: optionText }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
}

function addFigure(name: string, sourceNote: string, index: number) {
  fireEvent.click(screen.getByRole("button", { name: "Add a figure" }));
  const row = screen.getByRole("group", { name: `Figure ${index}` });
  setInput(/What it is called/, name, row);
  setInput(/Where the number comes from/, sourceNote, row);
}

/** Everything the rule form needs besides the split itself. */
function fillVersionFields() {
  setInput(/This version takes effect/, "2026-07-01");
  setInput(/Where this reading comes from/, "Ordinance 14-3, section 4(b), as amended.");
}

function recordButton() {
  return screen.getByRole("button", { name: /Record this version/ });
}

function submittedRule(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return (JSON.parse(String(init.body)) as { rule: unknown }).rule;
}

/**
 * A category returned to source on two weighted figures, with a floor — the
 * shape of a California self-help measure's local-streets clause.
 */
function buildWeightedAndFlooredOrdinance({ weights }: { weights: [string, string] }) {
  render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

  addFigure("Population", "Certified estimate named in the ordinance.", 1);
  addFigure("Maintained road miles", "The annual mileage report the ordinance names.", 2);

  const category = screen.getByRole("group", { name: "Category 1" });
  setInput(/What this share is for/, "Local streets and roads", category);
  setInput(/Share of what is left/, "100", category);
  fireEvent.change(within(category).getByLabelText("Who gets it"), {
    target: { value: "return_to_source" },
  });

  // One figure divides the whole share until a second is added.
  fireEvent.click(within(category).getByRole("button", { name: "Add another figure" }));

  const first = screen.getByRole("group", { name: "Category 1 figure 1" });
  const second = screen.getByRole("group", { name: "Category 1 figure 2" });
  selectByOptionText(within(first).getByLabelText("Divided by") as HTMLSelectElement, "Population");
  selectByOptionText(within(second).getByLabelText("Divided by") as HTMLSelectElement, "Maintained road miles");
  setInput(/Weight/, weights[0], first);
  setInput(/Weight/, weights[1], second);

  fireEvent.click(within(category).getByLabelText(/guarantees every recipient a minimum/));
  setInput(/The least a recipient may receive/, "100000", category);
  setInput(
    "The ordinance's own words",
    "No jurisdiction shall receive less than $100,000 in any fiscal year.",
    category
  );

  fillVersionFields();
}

/* ------------------------------------------------------------------ *
 * What a planner can now compose
 * ------------------------------------------------------------------ */

describe("the ordinance split a planner can set out", () => {
  it("records a two-figure weighted split with a floor, in the shape the parser accepts", () => {
    buildWeightedAndFlooredOrdinance({ weights: ["60", "40"] });

    expect(recordButton()).toBeEnabled();
    fireEvent.click(recordButton());

    const rule = submittedRule();
    // The parser is the authority on what is recordable; a shape assertion
    // alone would pass for something the route refuses.
    const parsed = parseMeasureAllocationRule(rule);
    if (isNarrativeRule(parsed)) throw new Error("expected the split, not narrative words");

    expect(parsed.categories).toHaveLength(1);
    const distribution = parsed.categories[0].distribution;
    if (distribution.kind !== "return_to_source") throw new Error("expected a return-to-source category");

    expect(distribution.factors).toEqual([
      { basisId: "population", weight: 60 },
      { basisId: "maintained_road_miles", weight: 40 },
    ]);
    // The single-figure spelling is NOT also present — the descriptor refuses
    // both at once, and the parser above would have thrown if it were.
    expect(distribution.basisId).toBeUndefined();
    expect(distribution.minimumPerRecipient).toEqual({
      amountPerPeriod: 100000,
      statedRuleNote: "No jurisdiction shall receive less than $100,000 in any fiscal year.",
    });
    expect(parsed.basisDefinitions.map((basis) => basis.id)).toEqual(["population", "maintained_road_miles"]);
  });

  /**
   * 99 AND 101 ARE THE WHOLE POINT of a live meter. Either one leaks the
   * difference in every period forever, and the ordinance says neither.
   */
  for (const weights of [["59", "40"], ["61", "40"]] as Array<[string, string]>) {
    it(`will not record apportionment weights totalling ${Number(weights[0]) + Number(weights[1])}`, () => {
      buildWeightedAndFlooredOrdinance({ weights });

      expect(recordButton()).toBeDisabled();
      fireEvent.click(recordButton());
      expect(fetchMock).not.toHaveBeenCalled();

      // The meter says so where the planner is looking, in the parser's own
      // arithmetic rather than a float sum of the boxes.
      const total = Number(weights[0]) + Number(weights[1]);
      expect(screen.getByText(new RegExp(`add up to ${total}%`))).toBeInTheDocument();
      expect(screen.getByText(/add up to exactly 100 before this can be saved/)).toBeInTheDocument();
    });
  }

  /** The category shares get the same treatment as the weights. */
  it("will not record category shares that do not total 100", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    const first = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Local streets and roads", first);
    setInput(/Share of what is left/, "70", first);

    fireEvent.click(screen.getByRole("button", { name: "Add a category" }));
    const second = screen.getByRole("group", { name: "Category 2" });
    setInput(/What this share is for/, "Bus operations", second);
    setInput(/Share of what is left/, "25", second);

    fillVersionFields();

    expect(recordButton()).toBeDisabled();
    expect(screen.getByText(/The category shares add up to 95%/)).toBeInTheDocument();

    setInput(/Share of what is left/, "30", second);
    expect(screen.getByText(/The category shares add up to 100%/)).toBeInTheDocument();
    expect(recordButton()).toBeEnabled();
  });

  /**
   * ONE FIGURE IS THE SINGLE-FIGURE SPELLING. Every rule recorded before
   * weighted splits existed is written that way, `measureReturnToSourceFactors`
   * reads the two identically, and composing a needless one-item weighted list
   * would make the same ordinance look like a different one on the record.
   */
  it("records a one-figure category as a single apportionment figure, not a weighted list of one", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    addFigure("Population", "Certified estimate named in the ordinance.", 1);

    const category = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Local streets and roads", category);
    setInput(/Share of what is left/, "100", category);
    fireEvent.change(within(category).getByLabelText("Who gets it"), {
      target: { value: "return_to_source" },
    });
    const only = screen.getByRole("group", { name: "Category 1 figure 1" });
    selectByOptionText(within(only).getByLabelText("Divided by") as HTMLSelectElement, "Population");
    // With one figure there is no weight to state, and the form says so.
    expect(within(only).queryByLabelText("Weight (%)")).toBeNull();

    fillVersionFields();
    fireEvent.click(recordButton());

    const parsed = parseMeasureAllocationRule(submittedRule());
    if (isNarrativeRule(parsed)) throw new Error("expected the split, not narrative words");
    const distribution = parsed.categories[0].distribution;
    if (distribution.kind !== "return_to_source") throw new Error("expected a return-to-source category");
    expect(distribution.basisId).toBe("population");
    expect(distribution.factors).toBeUndefined();
  });

  /**
   * THE FLOOR'S HELP TEXT IS THE PRODUCT'S ONLY EXPLANATION of a clause that
   * moves money between jurisdictions and can hold a whole category back. A
   * planner who does not know that cannot consent to it.
   */
  it("explains, in plain words, what the guarantee does and what happens when it cannot be met", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);
    const category = screen.getByRole("group", { name: "Category 1" });
    fireEvent.change(within(category).getByLabelText("Who gets it"), {
      target: { value: "return_to_source" },
    });

    const help = within(category).getByText(/brought up to it/).textContent ?? "";
    expect(help).toContain("comes off the recipients above it");
    expect(help).toContain("No money is added to the fund");
    expect(help).toMatch(/nothing is paid out of it that period/);
    expect(help).toContain("board");
  });

  /**
   * BOTH ESCAPE HATCHES SURVIVE. An ordinance the form cannot set out must still
   * be enterable, or the product loses the agencies that have one.
   */
  it("keeps the written-out rule and the ordinance's own words available", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Write the rule out in full" }));
    expect(screen.getByLabelText("The rule, written out in full")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /record it as text/ }));
    expect(screen.getByLabelText(/in its own words/)).toBeInTheDocument();

    fillVersionFields();
    fireEvent.change(screen.getByLabelText(/in its own words/), {
      target: { value: "The board apportions the local streets share by resolution each year." },
    });
    fireEvent.click(recordButton());

    const parsed = parseMeasureAllocationRule(submittedRule());
    expect(isNarrativeRule(parsed)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * A schema refusal, in the words a clerk can act on
 * ------------------------------------------------------------------ */

/**
 * WHAT A PLANNER TYPES, AND THE SENTENCE THAT COMES BACK.
 *
 * `inPlainWords` in `allocation-rule-draft.ts` swaps zod's refusals for
 * sentences a clerk can act on. Until this block existed its entire body could
 * be replaced by `return message` — every raw zod sentence going back to the
 * planner verbatim, `Too big: expected number to be <=100` under a box labelled
 * "Share of what is left (%)" — and all 22 measure-builder tests stayed green,
 * because nothing anywhere read a refusal off the screen. The tests assert on
 * the rule that gets SUBMITTED, and a refused draft submits nothing.
 *
 * So each case here types into the real form the measure page mounts, the way a
 * planner types, and reads the rendered text. Both halves matter: the plain
 * sentence has to be on screen, and zod's own wording must not be — a
 * translation that appends instead of replacing still leaves the clerk reading
 * the schema's words.
 *
 * WHY THE TABLE IS WALKED. A hand-written list of five cases cannot see a sixth
 * sentence added to `PLAIN_SCHEMA_SENTENCES`, so the coverage case below walks
 * the exported table itself: every entry is either provoked here or recorded in
 * `UNREACHABLE_BY_CONSTRUCTION` with the construction that keeps a planner from
 * reaching it. A new entry with neither fails.
 */
type PlainWordsProvocation = {
  /** What the planner did, in their words — this becomes the test name. */
  what: string;
  /** A fragment of the plain sentence that has to be on screen. */
  plainFragment: RegExp;
  /** Zod's own wording for the same refusal, which must NOT be on screen. */
  zodWording: RegExp;
  /** Drives the real form to the point of that refusal. */
  provoke: () => void;
};

/** One category, named, so the only thing wrong is the share box. */
function categoryWithShare(share: string) {
  render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);
  const category = screen.getByRole("group", { name: "Category 1" });
  setInput(/What this share is for/, "Local streets and roads", category);
  setInput(/Share of what is left/, share, category);
  fillVersionFields();
}

const PLAIN_WORDS_PROVOCATIONS: readonly PlainWordsProvocation[] = [
  {
    what: "types a share above 100",
    plainFragment: /A percentage cannot be more than 100\./,
    zodWording: /expected number to be <=100/,
    provoke: () => categoryWithShare("150"),
  },
  {
    what: "types a negative share",
    plainFragment: /This cannot be a negative number\./,
    zodWording: /expected number to be >=0/,
    provoke: () => categoryWithShare("-5"),
  },
  {
    // A third of a fund really is typed this way, and the fifth decimal is
    // refused rather than rounded — a rounded percentage is a different
    // ordinance — so this is a sentence a real planner lands on.
    what: "states a share to five decimal places",
    plainFragment: /at most four decimal places — 33\.3333 is fine/,
    zodWording: /may carry at most four decimal places/,
    provoke: () => categoryWithShare("33.33335"),
  },
  {
    what: "leaves a category unnamed",
    plainFragment: /Something the ordinance rule needs in words has been left empty\./,
    zodWording: /expected string to have >=1 characters/,
    provoke: () => {
      render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);
      const category = screen.getByRole("group", { name: "Category 1" });
      setInput(/Share of what is left/, "100", category);
      fillVersionFields();
    },
  },
  {
    // Pasting a clause out of the ordinance into the name box is the ordinary
    // way past a 200-character label.
    what: "pastes a whole clause into the category's name",
    plainFragment: /holds more text than this ordinance rule can store\. Shorten it\./,
    zodWording: /expected string to have <=\d+ characters/,
    provoke: () => {
      render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);
      const category = screen.getByRole("group", { name: "Category 1" });
      setInput(/What this share is for/, "Streets, roads, and appurtenant facilities ".repeat(12), category);
      setInput(/Share of what is left/, "100", category);
      fillVersionFields();
    },
  },
];

/**
 * The entries a planner cannot reach through this form, and what stops them.
 *
 * Keyed on the entry's own `match.source`, so rewording a sentence in
 * `PLAIN_SCHEMA_SENTENCES` breaks the exemption rather than carrying it
 * silently onto a different refusal. These stay in the table because the parser
 * is used from places that are not this form.
 */
const UNREACHABLE_BY_CONSTRUCTION: ReadonlyArray<{ matchSource: string; why: string }> = [
  {
    matchSource: "an id must be lower-case letters, digits, hyphen or underscore",
    why:
      "every reference box runs normaliseReference on each keystroke, so the box already holds a string the " +
      "id rule accepts — asserted below rather than taken on trust",
  },
  {
    matchSource: "^Invalid input: expected number, received",
    why:
      "numberBoxValue never hands the parser a non-number: an unreadable box gets its own sentence and the " +
      "composed figure falls back to 0",
  },
];

describe("a schema refusal a planner provoked comes back in plain words", () => {
  for (const provocation of PLAIN_WORDS_PROVOCATIONS) {
    it(`says it plainly when a planner ${provocation.what}`, () => {
      provocation.provoke();
      const onScreen = document.body.textContent ?? "";

      expect(onScreen).toMatch(provocation.plainFragment);
      // The schema's own wording is what a clerk must never be handed.
      expect(onScreen).not.toMatch(provocation.zodWording);
      // And it is a refusal, not a stray paragraph: the save is shut.
      expect(recordButton()).toBeDisabled();
    });
  }

  /**
   * NO REFERENCE BOX CAN REACH THE ID RULE — the exemption above, proven.
   *
   * `normaliseReference` runs on every keystroke, so whatever a planner types
   * is either empty or already an id the descriptor accepts. Empty is a
   * different sentence ("Give this category a short reference…"), written by
   * the draft rather than by zod.
   */
  it("cannot reach the id rule from a reference box, whatever is typed into it", () => {
    const descriptorIdRule = /^[a-z0-9][a-z0-9_-]*$/;
    const typedByPeople = [
      "Transit Ops!",
      "  Local Streets & Roads  ",
      "_leading underscore",
      "99 bottles",
      "ÜBER-transit",
      "a".repeat(200),
      "transit_",
    ];
    for (const typed of typedByPeople) {
      const normalised = normaliseReference(typed);
      expect(normalised, `normaliseReference(${JSON.stringify(typed)})`).toMatch(descriptorIdRule);
      expect(normalised.length).toBeLessThanOrEqual(64);
    }
  });

  /**
   * EVERY ENTRY IN THE TABLE IS ACCOUNTED FOR. This case re-drives the
   * provocations itself rather than reading what the cases above happened to
   * leave behind, so it says the same thing when run alone with `-t`.
   */
  it("provokes or explains away every sentence the translation table carries", () => {
    const reached = new Set<string>();
    for (const provocation of PLAIN_WORDS_PROVOCATIONS) {
      cleanup();
      provocation.provoke();
      const onScreen = document.body.textContent ?? "";
      for (const entry of PLAIN_SCHEMA_SENTENCES) {
        if (onScreen.includes(entry.plain)) reached.add(entry.match.source);
      }
    }
    cleanup();

    // The table is real and the walk is not looking at an empty list.
    expect(PLAIN_SCHEMA_SENTENCES.length).toBeGreaterThan(0);
    expect(reached.size).toBeGreaterThan(0);

    const exempt = new Set(UNREACHABLE_BY_CONSTRUCTION.map((entry) => entry.matchSource));
    const tableSources = new Set(PLAIN_SCHEMA_SENTENCES.map((entry) => entry.match.source));
    // An exemption for a sentence that is no longer in the table is a stale
    // note that would go on excusing whatever replaced it.
    expect([...exempt].filter((source) => !tableSources.has(source))).toEqual([]);

    const unaccounted = PLAIN_SCHEMA_SENTENCES.filter(
      (entry) => !reached.has(entry.match.source) && !exempt.has(entry.match.source)
    ).map((entry) => entry.plain);
    expect(
      unaccounted,
      "every plain sentence must be typed into the real form here, or recorded in " +
        "UNREACHABLE_BY_CONSTRUCTION with what stops a planner reaching it"
    ).toEqual([]);
  });
});

/*
 * ==========================================================================
 * MUTATION RESULTS — 2026-08-12
 * ==========================================================================
 *
 * Each mutation was applied to the source, this file RUN with its exit code read
 * directly (never through a pipe), and then reverted by editing the text back.
 * The suite was re-run green after every revert.
 *
 *   allocation-rule-draft.ts: `factors.length === 1` -> `false`, so one figure
 *       composes a weighted list of one
 *       -> "records a one-figure category as a single apportionment figure"
 *          fails — but at the SUBMIT, not the shape: a one-item list carrying a
 *          blank weight totals 0 and the parser refuses it, so nothing is sent.
 *          Honest reading: that spelling of the mutation is caught one step
 *          away from the assertion that names it, so it was run again combined
 *          with `weight ?? 0` -> `weight ?? 100`, which the parser accepts —
 *          and the shape assertion itself then fails with
 *          "expected undefined to be 'population'". The shape assertion bites.
 *   measure-fund-setup.tsx: the builder's clause is dropped from the Record
 *       button's `disabled`
 *       -> all three refusal tests fail on `toBeDisabled()`, and 99/101 would
 *          have been POSTed. This is the gate the whole builder rests on.
 *   allocation-rule-draft.ts: `minimumPerRecipient` is dropped from the
 *       composed weighted distribution
 *       -> the weighted-and-floored test fails: "expected undefined to deeply
 *          equal { amountPerPeriod: 100000, … }". A floor a planner ticks and
 *          the rule does not carry is a guarantee that silently does nothing.
 *   allocation-rule-builder.tsx: the guarantee's help text loses "comes off the
 *       recipients above it … no money is added to the fund"
 *       -> the plain-words test fails. The clause moves money BETWEEN
 *          jurisdictions; a planner who reads it as new money is consenting to
 *          something else.
 *   measure-fund-setup.tsx: the rule form opens on the written-out rule text
 *       instead of the builder
 *       -> 6 of 7 fail. This is the reachability mutation: the builder can be
 *          perfect and mounted behind a tab nobody lands on.
 *   measure-fund-setup.tsx: the written-out-rule branch is made unreachable
 *       -> the escape-hatch test fails. Narrowing the product to the ordinances
 *          this form can draw is the failure that test exists for.
 *   allocation-rule-builder.tsx: the meter's `isExactly100` is forced true
 *       -> both weight-refusal tests fail on the missing "add up to exactly 100
 *          before this can be saved". The button would still have been
 *          disabled, so without these two assertions a meter that lied to the
 *          planner would have shipped green.
 *
 * WHAT THIS FILE CANNOT PROVE: that the ARITHMETIC of a weighted split or a
 * floor is right — `measure-allocation-arithmetic.test.ts` and
 * `measure-weighted-and-floored-apportionment.test.ts` hold that — and that the
 * route accepts what is sent, which `measure-allocation-rules` route tests hold.
 * What it proves is that a person can state the ordinance and that what leaves
 * the browser is a rule the parser accepts.
 */
