import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeasureFundSetup } from "@/components/measures/measure-fund-setup";
import { parseMeasureAllocationRule } from "@/lib/measures/allocation";

/**
 * THE PARTS OF THE ORDINANCE FORM THAT NOTHING WAS WATCHING.
 *
 * `measure-allocation-builder.test.tsx` proves a planner can state a weighted,
 * floored split and that what leaves the browser is a rule the parser accepts.
 * It proved four other things not at all — an adversarial review on 2026-08-12
 * ran the mutations and all seven of its tests stayed green while the composer
 * threw away every deduction and every reserve, forgot which category takes the
 * odd cent, swapped a flat deduction for a percentage one, and printed every
 * refusal in a banner at the bottom of a form with a dozen boxes.
 *
 * This file is the other half:
 *
 *   1. WHICH BOX A REFUSAL BELONGS NEXT TO.
 *   2. THE DEDUCTIONS, THE RESERVES AND THE RESIDUAL actually reaching the rule.
 *   3. WHAT A NUMBER BOX HOLDS — empty, unreadable, or a number — and the fact
 *      that `0x64` is not one hundred.
 *   4. AN AMENDMENT STARTING FROM THE ORDINANCE IN FORCE, and refusing to
 *      silently orphan the allocations and claims filed against a category
 *      reference it drops.
 *
 * As in the sibling file, the assertion of record is the fetch body handed back
 * to `parseMeasureAllocationRule`: a shape assertion alone would pass for a
 * shape the route refuses.
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

function selectByOptionText(select: HTMLSelectElement, optionText: string) {
  const option = within(select).getByRole("option", { name: optionText }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
}

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

function descriptorSubmitted() {
  const parsed = parseMeasureAllocationRule(submittedRule());
  if ("kind" in parsed && parsed.kind === "narrative") throw new Error("expected the split, not narrative words");
  return parsed;
}

/** A single pooled category taking the whole of what is left. */
function fillOnePooledCategory(label: string) {
  const category = screen.getByRole("group", { name: "Category 1" });
  setInput(/What this share is for/, label, category);
  setInput(/Share of what is left/, "100", category);
  return category;
}

/* ------------------------------------------------------------------ *
 * 1. Which box a refusal belongs next to
 * ------------------------------------------------------------------ */

describe("where a refusal is printed", () => {
  /**
   * The parser names the offending row by its reference. Attribution is the
   * only thing standing between that and a banner at the bottom of a form with
   * a dozen identical-looking boxes, and nothing was testing it.
   */
  it("prints a refusal that names a category next to that category, not on the form", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    const first = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Transit", first);
    setInput(/Share of what is left/, "50", first);

    fireEvent.click(screen.getByRole("button", { name: "Add a category" }));
    const second = screen.getByRole("group", { name: "Category 2" });
    // The same words, so the same derived short reference — which is exactly
    // the mistake a planner makes when an ordinance has two "Transit" clauses.
    setInput(/What this share is for/, "Transit", second);
    setInput(/Share of what is left/, "50", second);

    // Attribution resolves a duplicated reference to the LAST row that claimed
    // it, which is the row the planner just typed.
    expect(within(second).getByText(/duplicate category id "transit"/)).toBeInTheDocument();
    expect(recordButton()).toBeDisabled();
  });

  /**
   * THE LIKELIEST MISTAKE IN THE WHOLE FORM used to be typing `Transit` in a box
   * labelled "Short reference", which came back as "an id must be lower-case
   * letters, digits, hyphen or underscore" attached to nothing. The box now
   * normalises what is typed, so the refusal has no way to happen.
   */
  it("normalises what is typed into a short reference instead of refusing it", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    const category = fillOnePooledCategory("Local streets and roads");
    const reference = within(category).getByLabelText(/Short reference/) as HTMLInputElement;
    fireEvent.change(reference, { target: { value: "Local Streets & Roads" } });

    expect(reference.value).toBe("local_streets_roads");
    expect(screen.queryByText(/lower-case letters, digits, hyphen or underscore/)).toBeNull();

    fillVersionFields();
    fireEvent.click(recordButton());
    expect(descriptorSubmitted().categories[0].id).toBe("local_streets_roads");
  });
});

/* ------------------------------------------------------------------ *
 * 2. The parts of the ordinance the composer used to be free to drop
 * ------------------------------------------------------------------ */

describe("everything the ordinance says, reaching the rule", () => {
  /**
   * A deduction and a reserve are money that never reaches the split. A
   * composer that silently drops them produces a rule whose category shares
   * still sum to 100 and whose apportionment is wrong in every period, with
   * nothing on screen to say so.
   */
  it("carries the deductions and the reserves the ordinance takes before the split", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a deduction" }));
    const administration = screen.getByRole("group", { name: "Deduction 1" });
    setInput(/What it is for/, "Administration", administration);
    setInput(/Percentage of the receipt/, "1", administration);

    fireEvent.click(screen.getByRole("button", { name: "Add a deduction" }));
    const collection = screen.getByRole("group", { name: "Deduction 2" });
    setInput(/What it is for/, "Collecting authority fee", collection);
    // A FLAT AMOUNT, and a big one: composed as a percentage instead it would
    // be over 100 and the parser would refuse the whole rule, so this value
    // also proves the two spellings are not interchangeable.
    fireEvent.change(within(collection).getByLabelText(/How it is worked out/), {
      target: { value: "amount" },
    });
    setInput(/Amount each period/, "250000", collection);
    fireEvent.click(within(collection).getByLabelText(/caps this deduction/));
    setInput(/The most it may take/, "1000000", collection);
    fireEvent.change(within(collection).getByLabelText(/Over what stretch/), {
      target: { value: "fiscal_year" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add a reserve" }));
    const reserve = screen.getByRole("group", { name: "Reserve 1" });
    setInput(/What it is for/, "Rainy day", reserve);
    setInput(/Percentage held/, "5", reserve);
    selectByOptionText(
      within(reserve).getByLabelText(/Taken from/) as HTMLSelectElement,
      "What is left after the deductions"
    );

    fillOnePooledCategory("Bus operations");
    fillVersionFields();
    fireEvent.click(recordButton());

    const rule = descriptorSubmitted();
    expect(rule.offTheTop).toEqual([
      { id: "administration", label: "Administration", percent: 1 },
      {
        id: "collecting_authority_fee",
        label: "Collecting authority fee",
        amount: 250000,
        capAmount: 1000000,
        capBasis: "fiscal_year",
      },
    ]);
    expect(rule.reserves).toEqual([
      { id: "rainy_day", label: "Rainy day", basis: "after_off_the_top", percent: 5 },
    ]);
  });

  /** A reserve on ONE category comes out of that category alone. */
  it("holds a reserve against the category the planner chose, by that category's reference", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    const first = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Local streets and roads", first);
    setInput(/Share of what is left/, "70", first);

    fireEvent.click(screen.getByRole("button", { name: "Add a category" }));
    const second = screen.getByRole("group", { name: "Category 2" });
    setInput(/What this share is for/, "Bus operations", second);
    setInput(/Share of what is left/, "30", second);

    fireEvent.click(screen.getByRole("button", { name: "Add a reserve" }));
    const reserve = screen.getByRole("group", { name: "Reserve 1" });
    setInput(/What it is for/, "Bus fleet replacement", reserve);
    setInput(/Percentage held/, "10", reserve);
    selectByOptionText(within(reserve).getByLabelText(/Taken from/) as HTMLSelectElement, "Bus operations only");

    fillVersionFields();
    fireEvent.click(recordButton());

    expect(descriptorSubmitted().reserves[0].basis).toBe("category:bus_operations");
  });

  /**
   * THE ODD CENT HAS TO LAND SOMEWHERE. Dropped, the rule falls back to "the
   * last category by reference" — a silent, alphabetical choice that is not the
   * one the ordinance made and not the one the planner picked off the list.
   */
  it("records which category the ordinance says takes the odd cent", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    const first = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Bus operations", first);
    setInput(/Share of what is left/, "40", first);

    fireEvent.click(screen.getByRole("button", { name: "Add a category" }));
    const second = screen.getByRole("group", { name: "Category 2" });
    setInput(/What this share is for/, "Local streets and roads", second);
    setInput(/Share of what is left/, "60", second);

    // Chosen by reading the list, and deliberately NOT the last by reference:
    // "bus_operations" sorts first, so a dropped residual would be invisible if
    // the planner had picked the alphabetically-last one.
    selectByOptionText(screen.getByLabelText(/takes the odd cent/) as HTMLSelectElement, "Bus operations");

    fillVersionFields();
    fireEvent.click(recordButton());

    expect(descriptorSubmitted().residualCategoryId).toBe("bus_operations");
  });
});

/* ------------------------------------------------------------------ *
 * 3. What a number box holds
 * ------------------------------------------------------------------ */

describe("reading a number box", () => {
  /**
   * `Number("0x64")` is 100 and `Number("1e2")` is 100. A share silently
   * recorded as one hundred percent because a paste carried a stray character
   * is the worst available outcome for a fund an oversight committee audits.
   */
  for (const spelling of ["0x64", "1e2"]) {
    it(`refuses "${spelling}" rather than reading it as one hundred`, () => {
      render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

      const category = screen.getByRole("group", { name: "Category 1" });
      setInput(/What this share is for/, "Bus operations", category);
      setInput(/Share of what is left/, spelling, category);
      fillVersionFields();

      expect(within(category).getByText(new RegExp(`"${spelling}" is not a number`))).toBeInTheDocument();
      expect(screen.getByText(/The category shares add up to 0%/)).toBeInTheDocument();
      expect(recordButton()).toBeDisabled();
      fireEvent.click(recordButton());
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  /**
   * AN EMPTY BOX AND A FILLED ONE ARE DIFFERENT SITUATIONS. "State this
   * category's share" printed under a box a planner has just filled sends them
   * looking for a box that does not exist.
   */
  it("does not tell a planner to fill in a box they have already filled in", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    const category = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Bus operations", category);

    expect(within(category).getByText(/State this category's share/)).toBeInTheDocument();

    setInput(/Share of what is left/, "thirty", category);
    expect(within(category).queryByText(/State this category's share/)).toBeNull();
    expect(within(category).getByText(/"thirty" is not a number this form can read/)).toBeInTheDocument();
  });

  /** A planner types a percent sign in a percent box and commas in an amount. */
  it("reads a trailing percent sign and thousands separators as the number they are", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a figure" }));
    const figure = screen.getByRole("group", { name: "Figure 1" });
    setInput(/What it is called/, "Population", figure);
    setInput(/Where the number comes from/, "Certified estimate named in the ordinance.", figure);

    const first = screen.getByRole("group", { name: "Category 1" });
    setInput(/What this share is for/, "Local streets and roads", first);
    setInput(/Share of what is left/, "66.5%", first);
    fireEvent.change(within(first).getByLabelText("Who gets it"), { target: { value: "return_to_source" } });
    const only = screen.getByRole("group", { name: "Category 1 figure 1" });
    selectByOptionText(within(only).getByLabelText("Divided by") as HTMLSelectElement, "Population");
    fireEvent.click(within(first).getByLabelText(/guarantees every recipient a minimum/));
    setInput(/The least a recipient may receive/, "1,000,000", first);
    setInput("The ordinance's own words", "No jurisdiction shall receive less than $1,000,000.", first);

    fireEvent.click(screen.getByRole("button", { name: "Add a category" }));
    const second = screen.getByRole("group", { name: "Category 2" });
    setInput(/What this share is for/, "Bus operations", second);
    setInput(/Share of what is left/, "33.5", second);

    expect(screen.getByText(/The category shares add up to 100%/)).toBeInTheDocument();

    fillVersionFields();
    fireEvent.click(recordButton());

    const rule = descriptorSubmitted();
    expect(rule.categories[0].percentOfAllocable).toBe(66.5);
    const distribution = rule.categories[0].distribution;
    if (distribution.kind !== "return_to_source") throw new Error("expected a return-to-source category");
    expect(distribution.minimumPerRecipient?.amountPerPeriod).toBe(1000000);
  });
});

/* ------------------------------------------------------------------ *
 * 4. A floor on a category the agency programs itself
 * ------------------------------------------------------------------ */

describe("a minimum ticked on a category that is then pooled", () => {
  /**
   * The pooled branch of the composer returns before the floor is read, so a
   * guarantee a planner ticked, priced and quoted the ordinance for was
   * composed away in silence. The boxes keep their contents — switching back is
   * one click — but the rule may not disagree with the form on screen.
   */
  it("says the minimum does not apply rather than composing a rule without it", () => {
    render(<MeasureFundSetup programId="p-1" measureId={MEASURE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a figure" }));
    const figure = screen.getByRole("group", { name: "Figure 1" });
    setInput(/What it is called/, "Population", figure);
    setInput(/Where the number comes from/, "Certified estimate named in the ordinance.", figure);

    const category = fillOnePooledCategory("Local streets and roads");
    fireEvent.change(within(category).getByLabelText("Who gets it"), {
      target: { value: "return_to_source" },
    });
    const only = screen.getByRole("group", { name: "Category 1 figure 1" });
    selectByOptionText(within(only).getByLabelText("Divided by") as HTMLSelectElement, "Population");
    fireEvent.click(within(category).getByLabelText(/guarantees every recipient a minimum/));
    setInput(/The least a recipient may receive/, "100000", category);
    setInput("The ordinance's own words", "No jurisdiction shall receive less than $100,000.", category);
    fillVersionFields();
    expect(recordButton()).toBeEnabled();

    fireEvent.change(within(category).getByLabelText("Who gets it"), { target: { value: "pooled" } });

    expect(within(category).getByText(/minimum for each recipient does not apply/)).toBeInTheDocument();
    expect(recordButton()).toBeDisabled();
    fireEvent.click(recordButton());
    expect(fetchMock).not.toHaveBeenCalled();

    // The typing survives the round trip, so the planner is not retyping the
    // ordinance's own words to correct a choice made one box away.
    fireEvent.change(within(category).getByLabelText("Who gets it"), {
      target: { value: "return_to_source" },
    });
    expect((within(category).getByLabelText(/The least a recipient may receive/) as HTMLInputElement).value).toBe(
      "100000"
    );
    expect(recordButton()).toBeEnabled();
  });
});

/* ------------------------------------------------------------------ *
 * 5. Amending an ordinance that is already in force
 * ------------------------------------------------------------------ */

/**
 * A REAL RECORDED SPLIT, whose first category's short reference is NOT what its
 * label would derive. `Local streets & roads` derives `local_streets_roads`;
 * what is on the record is `local_streets_and_roads`. That gap is the whole
 * defect: a planner retyping this ordinance into a blank form produces a rule
 * that looks right and orphans every allocation and claim filed under it.
 */
const RULE_IN_FORCE = {
  version: 1,
  offTheTop: [{ id: "administration", label: "Administration", percent: 1 }],
  reserves: [
    { id: "rainy_day", label: "Rainy day", basis: "after_off_the_top", percent: 5 },
    // A reserve held against ONE category. Read back into the form it becomes
    // that category's draft row, so it follows the category through a rename.
    { id: "bus_fleet", label: "Bus fleet replacement", basis: "category:bus_operations", percent: 10 },
  ],
  categories: [
    {
      id: "local_streets_and_roads",
      label: "Local streets & roads",
      percentOfAllocable: 70,
      distribution: {
        kind: "return_to_source",
        factors: [
          { basisId: "population", weight: 50 },
          { basisId: "maintained_road_miles", weight: 50 },
        ],
        minimumPerRecipient: {
          amountPerPeriod: 100000,
          statedRuleNote: "No jurisdiction shall receive less than $100,000 in any fiscal year.",
        },
      },
    },
    { id: "bus_operations", label: "Bus operations", percentOfAllocable: 30, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [
    { id: "population", label: "Population", statedSourceNote: "Certified estimate named in the ordinance." },
    {
      id: "maintained_road_miles",
      label: "Maintained road miles",
      statedSourceNote: "The annual mileage report the ordinance names.",
    },
  ],
  residualCategoryId: "bus_operations",
};

const FILED = [
  { reference: "local_streets_and_roads", allocations: 12, claims: 3 },
  { reference: "bus_operations", allocations: 4, claims: 0 },
];

describe("amending an ordinance that is already in force", () => {
  /**
   * THE FORM OPENS ON THE ORDINANCE, NOT ON A BLANK PAGE. Recording an
   * amendment that changes one percentage must not require retyping a split
   * from memory — that is how a reference changes spelling.
   */
  it("starts from the version in force and re-records it unchanged, to the letter", () => {
    render(
      <MeasureFundSetup
        programId="p-1"
        measureId={MEASURE_ID}
        ruleInForce={RULE_IN_FORCE}
        filedCategoryReferences={FILED}
      />
    );

    expect(screen.getByText(/starts from the version currently in force/)).toBeInTheDocument();

    const category = screen.getByRole("group", { name: "Category 1" });
    // The reference on the record, NOT the one this label would derive.
    expect((within(category).getByLabelText(/Short reference/) as HTMLInputElement).value).toBe(
      "local_streets_and_roads"
    );

    fillVersionFields();
    fireEvent.click(recordButton());

    expect(descriptorSubmitted()).toEqual(parseMeasureAllocationRule(RULE_IN_FORCE));
  });

  /** An amendment that changes a percentage changes only that percentage. */
  it("amends one share without disturbing the deductions, reserves, floor or residual", () => {
    render(
      <MeasureFundSetup
        programId="p-1"
        measureId={MEASURE_ID}
        ruleInForce={RULE_IN_FORCE}
        filedCategoryReferences={FILED}
      />
    );

    setInput(/Share of what is left/, "60", screen.getByRole("group", { name: "Category 1" }));
    setInput(/Share of what is left/, "40", screen.getByRole("group", { name: "Category 2" }));

    fillVersionFields();
    fireEvent.click(recordButton());

    const rule = descriptorSubmitted();
    expect(rule.categories.map((category) => [category.id, category.percentOfAllocable])).toEqual([
      ["local_streets_and_roads", 60],
      ["bus_operations", 40],
    ]);
    expect(rule.offTheTop).toEqual(RULE_IN_FORCE.offTheTop);
    expect(rule.reserves).toEqual(RULE_IN_FORCE.reserves);
    expect(rule.residualCategoryId).toBe("bus_operations");
    const distribution = rule.categories[0].distribution;
    if (distribution.kind !== "return_to_source") throw new Error("expected a return-to-source category");
    expect(distribution.minimumPerRecipient).toEqual(RULE_IN_FORCE.categories[0].distribution.minimumPerRecipient);
  });

  /**
   * THE SILENT ORPHAN. `resolveMeasureClaimCategories` answers with the NEW
   * rule's ids for a descriptor rule, so a reference dropped from a version is
   * a reference no city can claim against any more — with nothing said, and
   * twelve allocations and three claims still pointing at it.
   */
  it("will not record an amendment that drops a filed reference until someone says they mean it", () => {
    render(
      <MeasureFundSetup
        programId="p-1"
        measureId={MEASURE_ID}
        ruleInForce={RULE_IN_FORCE}
        filedCategoryReferences={FILED}
      />
    );
    fillVersionFields();

    // Nothing is retired yet, so nothing is claimed to be.
    expect(screen.queryByRole("group", { name: "Categories this amendment retires" })).toBeNull();
    expect(recordButton()).toBeEnabled();

    // The rename that looks harmless: the label is tidied and the reference
    // follows it. This is the exact keystroke the defect rode in on.
    const category = screen.getByRole("group", { name: "Category 1" });
    fireEvent.change(within(category).getByLabelText(/Short reference/), {
      target: { value: "local_streets_roads" },
    });

    const warning = screen.getByRole("group", { name: "Categories this amendment retires" });
    expect(
      within(warning).getByText(/"local_streets_and_roads" — 12 recorded allocations and 3 claims are filed against it/)
    ).toBeInTheDocument();
    // The category still in the rule is not reported as retired.
    expect(within(warning).queryByText(/"bus_operations"/)).toBeNull();

    expect(recordButton()).toBeDisabled();
    fireEvent.click(recordButton());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(warning).getByLabelText(/The ordinance retires this category/));
    expect(recordButton()).toBeEnabled();
    fireEvent.click(recordButton());
    expect(descriptorSubmitted().categories[0].id).toBe("local_streets_roads");
  });

  /**
   * A RULE THIS BUILD CANNOT READ IS NOT A BLANK FORM. Silently starting empty
   * would hide from the planner that the version they are replacing is one
   * nothing on this page could parse.
   */
  it("says so when the version in force cannot be read back into the form", () => {
    render(
      <MeasureFundSetup
        programId="p-1"
        measureId={MEASURE_ID}
        ruleInForce={{ version: 1, categories: [{ id: "transit", label: "Transit" }] }}
      />
    );

    expect(screen.getByText(/could not be read back into this form, so it starts empty/)).toBeInTheDocument();
  });

  /** A narrative ordinance opens on its own words, in the tab that holds them. */
  it("opens an ordinance recorded as words on those words", () => {
    render(
      <MeasureFundSetup
        programId="p-1"
        measureId={MEASURE_ID}
        ruleInForce={{
          version: 1,
          kind: "narrative",
          text: "The board apportions the local streets share by resolution each year.",
        }}
      />
    );

    expect((screen.getByLabelText(/in its own words/) as HTMLTextAreaElement).value).toBe(
      "The board apportions the local streets share by resolution each year."
    );
  });
});

/*
 * ==========================================================================
 * MUTATION RESULTS — 2026-08-12
 * ==========================================================================
 *
 * Seventeen mutations, each applied to the source, this file and its sibling
 * RUN with the exit code read directly (never through a pipe), then reverted by
 * editing the text back. All seventeen produced exit=1. The four the
 * adversarial review had shown to be VACUOUS against the sibling file — 7 of 7
 * green while the composer was gutted — are the first four here.
 *
 *   attributeProblem always returns { field: "form" }
 *       -> "prints a refusal that names a category next to that category"
 *   candidate.offTheTop forced to []
 *       -> "carries the deductions and the reserves…", plus both amendment
 *          round-trip tests
 *   candidate.reserves forced to []
 *       -> the same three, plus "holds a reserve against the category the
 *          planner chose"
 *   residualCategoryId dropped from the candidate
 *       -> "records which category the ordinance says takes the odd cent",
 *          plus both amendment round-trip tests
 *   percent and amount swapped in the deduction composer
 *       -> "carries the deductions…" — the flat $250,000 fee becomes a 250,000%
 *          deduction, the parser refuses the rule, and nothing is POSTed
 *   capAmount/capBasis dropped from the composed deduction
 *       -> "carries the deductions…"
 *
 *   readNumberBox stops checking the decimal spelling (i.e. plain `Number()`)
 *       -> both `refuses "0x64"` / `refuses "1e2"` tests. This is the one that
 *          would silently record a category share of one hundred percent.
 *   an unreadable box gets the empty box's message
 *       -> "does not tell a planner to fill in a box they have already filled
 *          in", and both hex/exponent tests
 *   the trailing % is no longer stripped
 *       -> "reads a trailing percent sign and thousands separators…"
 *   the pooled branch stops raising the ticked-floor problem
 *       -> "says the minimum does not apply rather than composing a rule
 *          without it"
 *   the category reference box stops normalising what is typed
 *       -> "normalises what is typed into a short reference instead of
 *          refusing it"
 *
 *   MeasureFundSetup opens on `startingPoint(null)` — the blank form it shipped
 *   with
 *       -> all four amendment tests plus the orphan test. This is the
 *          reachability mutation for the whole prefill seam.
 *   ruleDraftFromRule maps a category-held reserve to "gross"
 *       -> both amendment round-trip tests. Found by mutation: the first
 *          version of this file had no category-held reserve in the fixture and
 *          this mutation survived.
 *   orphanedFiledReferences returns []
 *       -> "will not record an amendment that drops a filed reference…"
 *   retirementBlocks forced false
 *       -> the same test, on `toBeDisabled()` — the rule composes perfectly, so
 *          without that assertion the orphaning would POST green
 *   the unreadable-rule note is emptied
 *       -> "says so when the version in force cannot be read back into the form"
 *   a narrative rule in force opens on the builder instead
 *       -> "opens an ordinance recorded as words on those words"
 *
 * WHAT THIS FILE STILL CANNOT PROVE: that the page hands the component the
 * right rule row and the right filed counts. Those are one `.reduce` and one
 * `Map` in `programs/[programId]/measure/page.tsx`, over rows this suite never
 * reads from a database, and a test rendering that server page against a fake
 * Supabase client is what would close it.
 */
