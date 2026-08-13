import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { stripSourceComments } from "./helpers/source-text";
import { shippedSourceFiles } from "./page-tabs-guard-source";
import { BasisValueEditor } from "@/components/measures/basis-value-editor";
import { MeasureFundPanel } from "@/components/measures/measure-fund-panel";
import { ClaimComposer } from "@/components/measures/claim-composer";
import { ClaimDecisionControls } from "@/components/measures/claim-decision-controls";
import {
  buildMeasureClaimLedger,
  formatMeasureClaimStatusLabel,
  MEASURE_CLAIM_TRANSITIONS,
} from "@/lib/measures/claims";
import { buildMeasureReceiptLedger } from "@/lib/measures/receipts";
import {
  isNarrativeRule,
  measureCategoriesNeedingBasisVintage,
  parseMeasureAllocationRule,
} from "@/lib/measures/allocation";

/**
 * A COMPLETE, TESTED CAPABILITY THAT NO PLANNER CAN REACH is this repository's
 * most expensive recurring defect — eleven recorded instances. This lane is
 * unusually exposed to it: the measure fund lives on a CHILD route of the
 * program record, so the only way in is one conditional link, and every control
 * on the page is behind one of two role gates.
 *
 * WHAT THIS FILE PROVES, and how each part avoids proving nothing:
 *
 * 1. THE DOOR EXISTS AND IS CONDITIONAL. The program page's source is read from
 *    disk and the link asserted against it, together with the `local_measure`
 *    condition. Reading the file rather than rendering the page is deliberate:
 *    that page performs a dozen Supabase reads, and a rendering harness for it
 *    would test the harness. What the file check CANNOT see is whether the link
 *    is visible to a given role — so the surfaces themselves are rendered
 *    below, which is where reachability is actually established.
 *
 * 2. THE PANELS RENDER FROM THE REAL LEDGERS. The rows go through
 *    `buildMeasureReceiptLedger` and `buildMeasureClaimLedger` — not through a
 *    hand-written view model. A described fixture once passed for an offer no
 *    board could ever render; only the real builder proves the product can
 *    produce what the component draws.
 *
 * 3. THE CAVEATS ARE ON SCREEN, not merely in the data. A coverage flag nobody
 *    prints is a coverage flag nobody reads.
 */

/* ------------------------------------------------------------------ *
 * 1. The door
 * ------------------------------------------------------------------ */

describe("the way in", () => {
  const programPage = readFileSync(
    path.join(process.cwd(), "src/app/(app)/programs/[programId]/page.tsx"),
    "utf8"
  );

  it("links to the measure fund from the program record, and only for a local measure", () => {
    expect(programPage).toContain("/measure`");
    expect(programPage).toMatch(/program\.program_type === "local_measure"/);

    // The condition and the link are in one expression. If a later edit moved
    // the link outside the guard, every RTIP and STIP row would offer a page
    // that can only tell the planner it does not apply.
    const linkIndex = programPage.indexOf("/measure`");
    const guardIndex = programPage.indexOf('program.program_type === "local_measure"');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(linkIndex - guardIndex).toBeLessThan(400);
    expect(linkIndex).toBeGreaterThan(guardIndex);
  });

  it("has a page at the route the link points to", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/(app)/programs/[programId]/measure/page.tsx"),
      "utf8"
    );
    expect(page).toContain("export default async function MeasureFundPage");
    // The page refuses a program that is not a local measure, so a hand-typed
    // URL cannot reach a fund set-up form on an RTIP row.
    expect(page).toMatch(/program\.program_type !== "local_measure"/);
  });
});

/* ------------------------------------------------------------------ *
 * 1b. The two things the browser cannot work out for itself
 * ------------------------------------------------------------------ */

/**
 * A PROP WITH A DEFAULT IS A CAPABILITY THAT CAN BE SWITCHED OFF BY DELETION.
 *
 * `MeasureFundSetup` takes `ruleInForce` and `filedCategoryReferences`, and
 * both have defaults — `= null` and `= NOTHING_FILED`. Deleting both from the
 * page's call site left every measure test green. Nothing crashes and nothing
 * says anything: the amendment form simply opens blank instead of on the
 * ordinance in force, and the warning that an amendment is about to orphan
 * references already filed against it simply never appears. That is the
 * shipped-invisible shape exactly — a complete, tested capability with no way
 * in — and it is worse than most because the form still looks right.
 *
 * Neither value can be computed in the browser. `filedCategoryReferences` is a
 * count of `measure_allocations` and `measure_claims` rows, and a browser
 * cannot count rows it was never sent; `ruleInForce` is the newest recorded
 * reading of the ordinance. So the server has to hand both over, and the only
 * place that can be checked is the call site.
 *
 * WHY THE CALL SITES ARE FOUND RATHER THAN LISTED. A second page mounting this
 * form — the program record, a workspace set-up flow — would arrive with the
 * same two defaults quietly applied, and a test naming one file could not see
 * it. Every `<MeasureFundSetup` in shipped source is walked instead.
 *
 * WHY THE PROP'S VALUE IS INSPECTED AND NOT JUST ITS NAME. `ruleInForce={null}`
 * and `filedCategoryReferences={[]}` pass a "is the prop present" check and
 * leave the planner exactly where deleting the props did, so each expression
 * has to name something the page COMPUTES.
 *
 * WHAT THIS DOES NOT PROVE: that the values are right. That the form does
 * something with them once they arrive is proven by rendering it, in
 * `measure-allocation-builder-composition-and-amendments.test.tsx` — the
 * prefill, the orphan warning, and the refusal to record an amendment that
 * drops a filed reference.
 */
describe("the amendment prefill and the orphan warning are actually handed to the form", () => {
  const RELATIVE = "src/app/(app)/programs/[programId]/measure/page.tsx";

  /** Every `<MeasureFundSetup …>` in shipped source, with its attributes. */
  function setupCallSites(): Array<{ file: string; attributes: string }> {
    const found: Array<{ file: string; attributes: string }> = [];
    for (const file of shippedSourceFiles()) {
      // Comments stripped first: this component's own header quotes the tag,
      // and prose reaching a matcher is a defect this repo has shipped in
      // both directions.
      const source = stripSourceComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/<MeasureFundSetup(\s[^>]*?)\/?>/g)) {
        found.push({ file: path.relative(process.cwd(), file), attributes: match[1] });
      }
    }
    return found;
  }

  /** The names bound by a `const` in this file — what "the page computed it" means. */
  function computedNames(source: string): Set<string> {
    const names = new Set<string>();
    for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*[=:]/g)) names.add(match[1]);
    return names;
  }

  it("finds the call sites it is meant to be checking", () => {
    const sites = setupCallSites();
    // A walk that found nothing would pass the case below in silence, and the
    // page mounts this form twice — once with a fund and once without.
    expect(sites.length, "no <MeasureFundSetup> call site found at all — the walk broke").toBeGreaterThan(1);
    expect(sites.some((site) => site.file.endsWith("measure/page.tsx"))).toBe(true);
  });

  it("passes both server-computed props everywhere the form is mounted on an existing fund", () => {
    const sources = new Map<string, string>();
    const failures: string[] = [];

    for (const site of setupCallSites()) {
      // A fund that does not exist yet has no rule in force and nothing filed
      // against it, so the blank form is correct there and says so by passing
      // `measureId={null}` — a literal, not a value read from a row.
      if (/measureId=\{null\}/.test(site.attributes)) continue;

      const source =
        sources.get(site.file) ??
        (() => {
          const text = stripSourceComments(readFileSync(path.join(process.cwd(), site.file), "utf8"));
          sources.set(site.file, text);
          return text;
        })();
      const computed = computedNames(source);

      for (const prop of ["ruleInForce", "filedCategoryReferences"]) {
        const passed = site.attributes.match(new RegExp(`\\b${prop}=\\{([^}]*(?:\\}[^}]*)*?)\\}`));
        if (!passed) {
          failures.push(`${site.file}: <MeasureFundSetup> does not pass ${prop}`);
          continue;
        }
        const namesSomethingComputed = [...(passed[1].matchAll(/[A-Za-z_$][\w$]*/g))].some((identifier) =>
          computed.has(identifier[0])
        );
        if (!namesSomethingComputed) {
          failures.push(
            `${site.file}: ${prop}={${passed[1].trim()}} is a literal — the page has to hand over what it read`
          );
        }
      }
    }

    expect(
      failures,
      "the browser cannot work either of these out for itself: without them the amendment form opens " +
        "blank instead of on the ordinance in force, and an amendment that orphans filed allocations " +
        "and claims saves with nothing said",
    ).toEqual([]);
  });

  it("computes both of them from rows it read, rather than from nothing", () => {
    const page = stripSourceComments(readFileSync(path.join(process.cwd(), RELATIVE), "utf8"));

    // The prefill is the NEWEST recorded reading of the ordinance — an
    // amendment is written on top of the latest version even when an earlier
    // one is still in force — so it comes out of the rule rows, not out of a
    // single-row read that could be any of them.
    expect(page).toMatch(/ruleRows\.reduce/);
    // And the filed references are counted from both tables. Counting only
    // allocations would let an amendment orphan every claim in silence.
    expect(page).toMatch(/for \(const allocation of allocationRows\) countFiled\(/);
    expect(page).toMatch(/countFiled\(claim\.category_id, "claims"\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The surfaces
 * ------------------------------------------------------------------ */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PERIOD_A = "11111111-1111-4111-8111-11111111111a";
const PERIOD_B = "11111111-1111-4111-8111-11111111111b";
const ALDER = "aaaaaaaa-0000-4000-8000-000000000001";
/** A second jurisdiction, for the apportionment-vintage cases below. */
const BRAY = "bbbbbbbb-0000-4000-8000-000000000002";

/** One reported quarter and one that nobody has reported. */
const PERIOD_ROWS = [
  {
    id: PERIOD_A,
    period_label: "FY26 Q1",
    fiscal_year_label: "FY26",
    period_start: "2025-07-01",
    period_end: "2025-09-30",
    received_amount: "4812340.17",
    received_on: "2025-10-20",
    receipt_source_note: "Treasurer's remittance advice",
    forecast_amount: "4700000.00",
  },
  {
    id: PERIOD_B,
    period_label: "FY26 Q2",
    fiscal_year_label: "FY26",
    period_start: "2025-10-01",
    period_end: "2025-12-31",
    received_amount: null,
    forecast_amount: "4750000.00",
  },
];

function receiptLedger() {
  const result = buildMeasureReceiptLedger({ periodRead: { ok: true, periods: PERIOD_ROWS } });
  if (!result.ok) throw new Error("fixture ledger failed");
  return result.ledger;
}

describe("the fund panel tells a planner what it does not know", () => {
  /**
   * THE TOTAL AND ITS COVERAGE SENTENCE ARE ONE THING ON SCREEN.
   *
   * 4,812,340.17 is a FLOOR: FY26 Q2 is open and unreported. A page that
   * printed the figure alone would tell an oversight committee the fund has
   * received that much, full stop.
   */
  it("prints the receipt total as a floor and names the unreported period", () => {
    render(
      <MeasureFundPanel
        measureId="m"
        currencyCode="USD"
        canWrite
        ledger={receiptLedger()}
        periods={receiptLedger().lines.map((line) => ({
          id: line.periodId ?? "",
          periodLabel: line.periodLabel,
          fiscalYearLabel: line.fiscalYearLabel,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          receivedAmount: line.receivedAmount,
          forecastAmount: line.forecastAmount,
          varianceAmount: line.varianceAmount,
          allocationRowCount: 0,
        }))}
      />
    );

    // The headline figure appears twice — once as the fund total and once in
    // the period row it came from — so both are accepted; what matters is that
    // the qualifier below sits with the total.
    expect(screen.getAllByText("$4,812,340.17").length).toBeGreaterThan(0);
    expect(screen.getByText(/or more/)).toBeInTheDocument();
    // ONE sentence carries all three facts — the floor, the coverage count and
    // the named period — so it is asserted as one string. Three separate
    // queries would pass even if the sentence had been split across the page
    // and the qualifier drifted away from the number it qualifies.
    const coverage = screen.getByText(/This is a floor, not the total/);
    expect(coverage.textContent).toContain("1 of 2 periods have a reported receipt");
    expect(coverage.textContent).toContain("FY26 Q2");
    expect(coverage.textContent).toContain("An unreported amount is not zero");
  });

  /** An unreported period reads as "Not reported", never as a zero. */
  it("shows an unreported period as unreported rather than as $0.00", () => {
    render(
      <MeasureFundPanel
        measureId="m"
        currencyCode="USD"
        canWrite={false}
        ledger={receiptLedger()}
        periods={receiptLedger().lines.map((line) => ({
          id: line.periodId ?? "",
          periodLabel: line.periodLabel,
          fiscalYearLabel: line.fiscalYearLabel,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          receivedAmount: line.receivedAmount,
          forecastAmount: line.forecastAmount,
          varianceAmount: line.varianceAmount,
          allocationRowCount: 0,
        }))}
      />
    );

    expect(screen.getByText("Not reported")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  /** A complete span says so, and drops the floor language. */
  it("drops the floor language once every opened period is reported", () => {
    const complete = buildMeasureReceiptLedger({
      periodRead: { ok: true, periods: [PERIOD_ROWS[0]] },
    });
    if (!complete.ok) throw new Error("fixture ledger failed");

    render(
      <MeasureFundPanel
        measureId="m"
        currencyCode="USD"
        canWrite={false}
        ledger={complete.ledger}
        periods={[]}
      />
    );
    expect(screen.queryByText(/This is a floor/)).not.toBeInTheDocument();
    expect(screen.getByText(/Every one of the 1 periods opened has a reported receipt/)).toBeInTheDocument();
  });
});

/**
 * ============================================================================
 * THE PANEL WILL NOT ALLOCATE A QUARTER INTO NOTHING
 * ============================================================================
 *
 * The live defect: with the vintage box empty the panel sent no
 * `basisVintageLabel`, the allocator matched recorded figures against "", and
 * every return-to-source category came out undistributed — the cities were
 * allocated nothing and the panel said "Period allocated from the ordinance
 * rule in force." The route refuses that now for every caller; this is the same
 * refusal where the planner is standing.
 *
 * The category list comes from `measureCategoriesNeedingBasisVintage` over a
 * rule the REAL parser produced, so this cannot pass against a hand-written
 * prop the product would never build.
 */
describe("the fund panel refuses an allocation that would distribute nothing", () => {
  function categoriesNeedingAVintage(distribution: "return_to_source" | "pooled") {
    const rule = parseMeasureAllocationRule({
      version: 1,
      categories: [
        {
          id: "neighbourhood_repair",
          label: "Neighbourhood street repair",
          percentOfAllocable: 60,
          distribution:
            distribution === "return_to_source"
              ? { kind: "return_to_source", basisId: "population" }
              : { kind: "pooled" },
        },
        {
          id: "bus_operations",
          label: "Bus operations",
          percentOfAllocable: 40,
          distribution:
            distribution === "return_to_source"
              ? { kind: "return_to_source", basisId: "population" }
              : { kind: "pooled" },
        },
      ],
      basisDefinitions: [
        { id: "population", label: "Population", statedSourceNote: "The certified estimate the ordinance names." },
      ],
    });
    return measureCategoriesNeedingBasisVintage(rule).map((category) => category.label);
  }

  function renderPanel(labels: string[]) {
    return render(
      <MeasureFundPanel
        measureId="m"
        currencyCode="USD"
        canWrite
        ledger={receiptLedger()}
        vintageDependentCategoryLabels={labels}
        periods={receiptLedger().lines.map((line) => ({
          id: line.periodId ?? "",
          periodLabel: line.periodLabel,
          fiscalYearLabel: line.fiscalYearLabel,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          receivedAmount: line.receivedAmount,
          forecastAmount: line.forecastAmount,
          varianceAmount: line.varianceAmount,
          allocationRowCount: 0,
        }))}
      />
    );
  }

  it("will not apply the ordinance on a blank vintage, and names the categories that need one", () => {
    const view = renderPanel(categoriesNeedingAVintage("return_to_source"));

    const apply = screen.getByRole("button", { name: "Apply the ordinance" });
    expect(apply).toBeDisabled();

    // NAMED, not counted: the planner has to know which part of the ordinance
    // is waiting on them.
    const refusal = screen.getByRole("status");
    expect(refusal.textContent).toContain("Neighbourhood street repair");
    expect(refusal.textContent).toContain("Bus operations");
    expect(refusal.textContent).toContain("would be allocated nothing");
    view.unmount();
  });

  it("offers the button as soon as the edition in force is named", () => {
    const view = renderPanel(categoriesNeedingAVintage("return_to_source"));

    fireEvent.change(screen.getByLabelText(/Apportionment vintage in force/i), {
      target: { value: "2029 certified estimate" },
    });

    expect(screen.getByRole("button", { name: "Apply the ordinance" })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });

  /**
   * THE OTHER DIRECTION, and it matters as much: an ordinance that divides
   * nothing on recorded figures never reads a vintage, and blocking it would
   * make a planner type a value that changes nothing.
   */
  it("allocates on a blank vintage when no category is divided on recorded figures", () => {
    const labels = categoriesNeedingAVintage("pooled");
    expect(labels).toEqual([]);

    const view = renderPanel(labels);
    expect(screen.getByRole("button", { name: "Apply the ordinance" })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });

  /**
   * AND THE PAGE ACTUALLY HANDS IT OVER. A gate the product never wires up is
   * this repository's most expensive recurring defect; the panel above would
   * pass with the prop defaulting to `[]` on every real load.
   */
  it("is given the list by the measure page, from the shared helper", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/(app)/programs/[programId]/measure/page.tsx"),
      "utf8"
    );
    expect(page).toContain("vintageDependentCategoryLabels={");
    expect(page).toContain("measureCategoriesNeedingBasisVintage(rule)");
  });
});

describe("the claim controls a planner can actually reach", () => {
  const CLAIM = {
    id: "c1",
    status: "submitted",
    recipientName: "Alder",
    categoryId: "local_streets",
    fiscalYearLabel: "FY26",
    grossAmount: 120000,
    netAmount: 114000,
    retentionWithheld: 6000,
    submittedOn: "2026-02-01",
    paidOn: null,
    decidedAt: null,
    decisionNote: null,
    denialReason: null,
    documentCount: 0,
    documents: [],
  };

  /**
   * THE BUTTONS COME FROM THE LIFECYCLE TABLE, so a member and an admin see the
   * same claim and different doors — matching what the route will actually
   * allow. Offering a control that 403s teaches people the product is broken.
   */
  it("offers an admin exactly the transitions the lifecycle allows", () => {
    render(
      <ClaimDecisionControls measureId="m" claim={CLAIM} currencyCode="USD" canDecide canWrite attachableDocuments={[]} />
    );

    // The labels come from the shared catalog, so this cannot drift from what
    // the button actually renders — a hand-written map here would keep passing
    // after a label changed and stop proving the button exists.
    for (const next of MEASURE_CLAIM_TRANSITIONS.submitted) {
      const label = formatMeasureClaimStatusLabel(next);
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Paying is not offered from `submitted` — approval comes first.
    expect(screen.queryByRole("button", { name: "Paid" })).not.toBeInTheDocument();
  });

  it("shows a member the claim and none of the decision buttons", () => {
    render(
      <ClaimDecisionControls
        measureId="m"
        claim={CLAIM}
        currencyCode="USD"
        canDecide={false}
        canWrite
        attachableDocuments={[]}
      />
    );

    expect(screen.getByText("Alder")).toBeInTheDocument();
    expect(screen.getByText(/\$120,000\.00 claimed/)).toBeInTheDocument();
    for (const label of ["Under review", "Approved", "Denied"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    // A member can still attach backup — that is content, not a disbursement.
    expect(screen.getByRole("button", { name: "Attach backup" })).toBeInTheDocument();
  });

  /** A terminal claim offers nothing, on screen as well as at the route. */
  it("offers nothing on a paid claim", () => {
    render(
      <ClaimDecisionControls
        measureId="m"
        claim={{ ...CLAIM, status: "paid", paidOn: "2026-04-01" }}
        currencyCode="USD"
        canDecide
        canWrite
        attachableDocuments={[]}
      />
    );
    for (const label of ["Under review", "Approved", "Denied", "Withdrawn", "Paid"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
  });

  /**
   * A CLAIM CANNOT BE FILED FOR A CATEGORY THE MEASURE DOES NOT DECLARE,
   * because the form does not offer one. The options ARE the ordinance's list.
   */
  it("offers only the measure's own categories, and refuses to render a claim box without them", () => {
    const { unmount } = render(
      <ClaimComposer
        measureId="m"
        canWrite
        currencyCode="USD"
        recipients={[{ id: ALDER, name: "Alder", isActive: true }]}
        periods={[{ id: PERIOD_A, periodLabel: "FY26 Q1", fiscalYearLabel: "FY26" }]}
        categories={[
          { id: "local_streets", label: "Local streets and roads" },
          { id: "transit", label: "Transit operations" },
        ]}
        categorySource="ordinance_rule"
      />
    );

    const select = screen.getByLabelText("Category") as HTMLSelectElement;
    const options = within(select)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options).toEqual(["local_streets", "transit"]);
    unmount();

    render(
      <ClaimComposer
        measureId="m"
        canWrite
        currencyCode="USD"
        recipients={[]}
        periods={[]}
        categories={[]}
        categorySource="none"
      />
    );
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.getByText(/has not recorded what its money may be spent on yet/)).toBeInTheDocument();
  });

  /** A retired recipient is not offered a claim form. */
  it("does not offer a retired recipient", () => {
    render(
      <ClaimComposer
        measureId="m"
        canWrite
        currencyCode="USD"
        recipients={[
          { id: ALDER, name: "Alder", isActive: true },
          { id: "bbbb", name: "Birch", isActive: false },
        ]}
        periods={[{ id: PERIOD_A, periodLabel: "FY26 Q1", fiscalYearLabel: "FY26" }]}
        categories={[{ id: "transit", label: "Transit operations" }]}
        categorySource="ordinance_rule"
      />
    );

    const select = screen.getByLabelText("Recipient") as HTMLSelectElement;
    const names = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toContain("Alder");
    expect(names).not.toContain("Birch");
  });
});

/* ------------------------------------------------------------------ *
 * 3. The ledger reaches the surface with its caveats intact
 * ------------------------------------------------------------------ */

describe("what the claim ledger hands the page", () => {
  /**
   * The over-claim, the manual-allocation flag and the not-determined ceiling
   * all come out of the REAL builder, so the page's banners have something
   * real to render. A hand-written view model here would prove only that the
   * fixture was written to match the component.
   */
  it("produces the three states the page must caveat, from the real builder", () => {
    const result = buildMeasureClaimLedger({
      claimRead: {
        ok: true,
        claims: [
          { id: "c1", recipient_id: ALDER, period_id: PERIOD_A, fiscal_year_label: "FY26", category_id: "local_streets", amount: "700000.00", status: "approved", submitted_on: "2026-01-01" },
          { id: "c2", recipient_id: ALDER, period_id: PERIOD_A, fiscal_year_label: "FY26", category_id: "transit", amount: "1000.00", status: "paid", paid_on: "2026-02-01", submitted_on: "2026-01-02" },
        ],
      },
      allocations: [
        { period_id: PERIOD_A, category_id: "local_streets", recipient_id: ALDER, amount: "583043.28", computation_basis: "manual" },
      ],
      periods: PERIOD_ROWS,
    });
    if (!result.ok) throw new Error("expected a ledger");

    // 583,043.28 − 700,000.00 = −116,956.72
    expect(result.ledger.overClaimedBuckets).toHaveLength(1);
    expect(result.ledger.overClaimedBuckets[0].remainingAllocated).toBe(-116956.72);
    expect(result.ledger.hasManualAllocation).toBe(true);
    // Transit has a claim and no allocation: a ceiling the page must call
    // "not determined" rather than zero.
    expect(result.ledger.categoryTotals.find((total) => total.categoryId === "transit")?.allocatedAmount).toBeNull();
    expect(result.ledger.categoriesWithNoAllocationCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Which vintage governs is read, never inferred
 * ------------------------------------------------------------------ */

describe("the apportionment editor and the vintage in force", () => {
  /**
   * WHY THIS IS RENDERED RATHER THAN ASSERTED ON THE PAGE'S SOURCE.
   *
   * Until 2026-08-12 the page handed this component
   * `basisValues[0]?.vintage_label` — the FIRST ROW OF AN UNORDERED QUERY — as
   * "the vintage in force". Which edition of a population figure governs a
   * jurisdiction's share of a public fund is a legal fact from the ordinance,
   * and it was being decided by the order Postgres happened to return rows in:
   * two loads of the same page, nothing edited, could badge different rows.
   *
   * So the test that matters is the one that VARIES THE ROW ORDER and requires
   * the answer not to move. A test that rendered one ordering would pass
   * against the defect.
   */
  const OLD_VINTAGE = "2019 certified estimate";
  const NEW_VINTAGE = "2029 certified estimate";

  const RECIPIENTS = [
    { id: ALDER, name: "City of Alderwick", isActive: true },
    { id: BRAY, name: "Braywood Township", isActive: true },
  ];

  const VALUES = [
    { id: "v1", recipientId: ALDER, basisId: "population", vintageLabel: OLD_VINTAGE, basisValue: 58200, basisSourceNote: "Superseded estimate.", statedOn: "2019-05-01" },
    { id: "v2", recipientId: ALDER, basisId: "population", vintageLabel: NEW_VINTAGE, basisValue: 61404, basisSourceNote: "Certified estimate named in Ordinance 14-3.", statedOn: "2029-05-01" },
    { id: "v3", recipientId: BRAY, basisId: "population", vintageLabel: NEW_VINTAGE, basisValue: 28733, basisSourceNote: "Certified estimate named in Ordinance 14-3.", statedOn: "2029-05-01" },
  ];

  /** The ordinance reading, parsed by the REAL descriptor parser. */
  function definitionsFrom(vintageInForce: string | undefined) {
    const rule = parseMeasureAllocationRule({
      version: 1,
      categories: [
        {
          id: "local_streets",
          label: "Local streets",
          percentOfAllocable: 100,
          distribution: { kind: "return_to_source", basisId: "population" },
        },
      ],
      basisDefinitions: [
        {
          id: "population",
          label: "Population",
          statedSourceNote: "Certified population estimate named in Ordinance 14-3.",
          ...(vintageInForce ? { vintageInForce } : {}),
        },
      ],
    });
    if (isNarrativeRule(rule)) throw new Error("expected a descriptor");
    return rule.basisDefinitions;
  }

  function renderEditor(values: typeof VALUES, vintageInForce: string | undefined) {
    return render(
      <BasisValueEditor
        measureId="m-1"
        canWrite
        recipients={RECIPIENTS}
        basisDefinitions={definitionsFrom(vintageInForce)}
        basisValues={values}
      />
    );
  }

  /** The vintage cell of every row that carries the "In force" badge. */
  function badgedVintages(container: HTMLElement): string[] {
    return [...container.querySelectorAll("tbody tr")]
      .filter((row) => row.textContent?.includes("In force"))
      .map((row) => (row.querySelector("td:nth-child(3)")?.textContent ?? "").replace("In force", "").trim());
  }

  it("badges the ordinance's vintage and no other, whatever order the rows arrive in", () => {
    const forwards = renderEditor(VALUES, NEW_VINTAGE);
    expect(badgedVintages(forwards.container)).toEqual([NEW_VINTAGE, NEW_VINTAGE]);
    forwards.unmount();

    // The SAME rows, reversed — which is all it took to change the answer
    // before, because the old code read element [0].
    const backwards = renderEditor([...VALUES].reverse(), NEW_VINTAGE);
    expect(badgedVintages(backwards.container)).toEqual([NEW_VINTAGE, NEW_VINTAGE]);
    backwards.unmount();
  });

  it("names the missing figure against the ordinance's vintage, in both orders", () => {
    // Braywood has no figure for the OLD vintage, so an ordinance naming the
    // old one must produce a gap for Braywood — in either row order.
    for (const values of [VALUES, [...VALUES].reverse()]) {
      const view = renderEditor(values, OLD_VINTAGE);
      const banner = screen.getByText(/has no figure for vintage/i).closest("div");
      expect(banner?.textContent).toContain(OLD_VINTAGE);
      expect(banner?.textContent).toContain("Braywood Township");
      expect(banner?.textContent).not.toContain("City of Alderwick");
      view.unmount();
    }
  });

  /**
   * THE HONEST BRANCH. Nothing in the schema records which vintage governs
   * unless the ordinance reading says so, and the answer to "nothing records
   * it" is to say so — not to reach for a row and call it authoritative.
   */
  it("says the governing edition is not recorded rather than choosing one", () => {
    const view = renderEditor(VALUES, undefined);

    expect(screen.getByText(/not recorded/i)).toBeTruthy();
    expect(screen.getByText(/OpenPlan will not choose one/i)).toBeTruthy();
    // No row is badged, and no gap list is offered against a vintage nobody named.
    expect(badgedVintages(view.container)).toEqual([]);
    expect(screen.queryByText(/has no figure for vintage/i)).toBeNull();
    view.unmount();
  });
});

/*
 * ==========================================================================
 * MUTATION RESULTS — the blank-vintage gate, 2026-08-12
 * ==========================================================================
 *
 * Each was applied to the source, RUN with the exit code read directly, and
 * reverted. The runner was shown to fail and pass first (recorded in
 * `measure-oversight-public-page.test.tsx`).
 *
 *   panel: `disabled={state.busy || vintageMissing}` -> `disabled={state.busy}`
 *       -> "will not apply the ordinance on a blank vintage" fails: the button
 *          is offered, which is the state that allocated a quarter into nothing.
 *   measure page: the panel is handed `[]` instead of the shared helper's list
 *       -> TWO fail — the rendered gate AND "is given the list by the measure
 *          page". The second is why that assertion exists: without it, a gate
 *          nobody wires up passes every rendering test in this file.
 *
 * WHAT THIS FILE CANNOT PROVE, and where it is proven instead: that the SERVER
 * refuses. A disabled button is a courtesy, and the panel's list comes from the
 * rule in force at the latest period rather than the period being allocated.
 * `measure-allocate-route.test.ts` holds the refusal itself, in both directions.
 */
