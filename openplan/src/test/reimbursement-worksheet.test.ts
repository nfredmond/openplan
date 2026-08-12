import { describe, expect, it } from "vitest";
import {
  buildAwardDrawdownLedger,
  type AwardDrawdownLedger,
  type DrawdownInvoiceLike,
} from "@/lib/invoicing/drawdown-ledger";
import {
  buildReimbursementWorksheetHtml,
  selectWorksheetInvoiceLines,
  summarizeWorksheetCostEntries,
  WORKSHEET_NO_FORM_PACK_NOTE,
  WORKSHEET_PREPARED_NOTE,
  resolveWorksheetCurrency,
  type WorksheetCostEntryLike,
} from "@/lib/invoicing/reimbursement-worksheet";
import {
  INTERIM_DEFAULT_RATIONALE,
  resolveReimbursementProfile,
  type ReimbursementProfileBinding,
} from "@/lib/invoicing/reimbursement-profile-binding";
import {
  createReimbursementProfileRegistry,
  type ReimbursementProfileDescriptor,
} from "@/lib/invoicing/reimbursement-profiles";

/**
 * THE REIMBURSEMENT WORKSHEET — the per-profile packet an agency takes into a
 * claim against its funder.
 *
 * Two things are under test here and they are different in kind:
 *
 *   1. THE ARITHMETIC. Only one sum exists in this module (the period cost
 *      total) and it is pinned to the cent by a hand-derived fixture, because
 *      mechanical money arithmetic that nobody sounded worried about is where
 *      this repository's audits keep finding the holes. Every other figure on
 *      the packet is the drawdown ledger's, and the tests below assert the
 *      document prints the ledger's values rather than any of its own — the
 *      A→B seam, exercised end to end through the real ledger builder.
 *
 *   2. THE REGISTRY FRONT DOOR. A packet for a jurisdiction OpenPlan has never
 *      heard of must be a DESCRIPTOR, not a code change. The pretend Ontario
 *      funder below has never been registered, is resolved through the real
 *      registry and the real binding resolver, and produces a coherent packet
 *      in which every jurisdiction word traces to its descriptor. A second
 *      pretend profile that declares none of the optional fields varies the
 *      binding, so these tests cannot pass on a builder that hardcodes the
 *      first profile's wording.
 */

// ---------------------------------------------------------------------------
// Pretend funders. Realistic spellings on purpose: a fixture profile named
// "test_profile" with posture "standard" would let a builder that special-cases
// the built-in vocabulary pass, and would read as obviously fake in a rendered
// packet where the point is to check that the packet reads right.
// ---------------------------------------------------------------------------

const ONTARIO_CONNECTING_LINKS: ReimbursementProfileDescriptor = {
  profileId: "ca_on_connecting_links_reimbursement_v1",
  profileName: "Ontario Connecting Links reimbursement",
  version: "1.0.0",
  jurisdiction: { country: "CA", subdivision: "ON", label: "Ontario, Canada" },
  postureOptions: [
    {
      postureId: "milestone_claim",
      label: "Milestone claim",
      description: "A claim submitted when a construction milestone recorded in the agreement is reached.",
    },
    {
      postureId: "holdback_in_effect",
      label: "Holdback in effect",
      description: "A portion of each claim is held back pending substantial completion.",
    },
  ],
  defaultPostureId: "milestone_claim",
  submittedToHint: "Ministry of Transportation, Municipal Programs Office",
  formPackStatus: "deferred_exact_forms",
  framingNote:
    "Your executed transfer payment agreement controls — where it differs from this profile, the agreement wins.",
  documentationChecklist: [
    {
      key: "progress_report",
      label: "Progress report",
      guidance: "The reporting period's progress narrative, in the format the transfer payment agreement names.",
    },
    {
      key: "holdback_computation",
      label: "Holdback computation",
      guidance: "How the holdback on this claim was computed, and the balance held to date.",
    },
  ],
  isInterimDefault: false,
};

/**
 * The binding-varying counterpart: a real-sounding process that declares NO
 * framing note, NO checklist, NO submit-to hint and NO form-pack status. If the
 * builder ever hardcodes any of those, the assertions on this profile fail —
 * one fixture cannot tell "threads the binding" from "prints a constant".
 */
const OREGON_STBG_EXCHANGE: ReimbursementProfileDescriptor = {
  profileId: "us_or_stbg_exchange_reimbursement_v1",
  profileName: "Oregon STBG fund-exchange reimbursement",
  version: "1.0.0",
  jurisdiction: { country: "US", subdivision: "OR", label: "Oregon, United States" },
  postureOptions: [{ postureId: "quarterly_draw", label: "Quarterly draw" }],
  defaultPostureId: "quarterly_draw",
  isInterimDefault: false,
};

/**
 * A process that DECLARES its currency. Separate from Ontario above rather than
 * folded into it, so the fixture set contains one profile that names a currency
 * and one that does not — a single fixture cannot tell "prints what the profile
 * declares" from "prints a constant that happens to match".
 */
const QUEBEC_PROGRAMME_ROUTIER: ReimbursementProfileDescriptor = {
  profileId: "ca_qc_programme_routier_reimbursement_v1",
  profileName: "Québec programme d'aide à la voirie locale",
  version: "1.0.0",
  jurisdiction: { country: "CA", subdivision: "QC", label: "Québec, Canada" },
  postureOptions: [{ postureId: "reclamation_finale", label: "Final claim" }],
  defaultPostureId: "reclamation_finale",
  currencyCode: "CAD",
  isInterimDefault: false,
};

/** A nationwide interim default so the pretend registry can answer an unconfigured caller. */
const PRETEND_INTERIM_DEFAULT: ReimbursementProfileDescriptor = {
  profileId: "ca_federal_generic_reimbursement_v1",
  profileName: "Canadian federal contribution reimbursement (generic)",
  version: "1.0.0",
  jurisdiction: { country: "CA", label: "Canada" },
  postureOptions: [{ postureId: "progress_claim", label: "Progress claim" }],
  defaultPostureId: "progress_claim",
  isInterimDefault: true,
};

const pretendRegistry = createReimbursementProfileRegistry([
  ONTARIO_CONNECTING_LINKS,
  QUEBEC_PROGRAMME_ROUTIER,
  OREGON_STBG_EXCHANGE,
  PRETEND_INTERIM_DEFAULT,
]);

function bindingFor(jurisdiction: { country: string; subdivision?: string | null } | null): ReimbursementProfileBinding {
  const resolution = resolveReimbursementProfile({
    workspaceJurisdiction: jurisdiction,
    registry: pretendRegistry,
  });
  if (resolution.kind !== "resolved") throw new Error("fixture profile did not resolve");
  return resolution.binding;
}

// ---------------------------------------------------------------------------
// The hand-derived ledger fixture. Every expected value below was computed by
// hand from these four rows and is asserted as an exact figure — never a band,
// never "sums to something".
//
//   A  paid       gross 40,000.00  5%  -> retention 2,000.00  net 38,000.00
//   B  submitted  gross 25,000.00  0%  -> retention     0.00  net 25,000.00
//   C  draft      gross  5,000.00      -> net 5,000.00        (no invoice date)
//   D  rejected   gross  9,000.00      -> net 9,000.00
//
//   authorized              100,000.00
//   claimed gross to date    65,000.00   (A + B; C and D are in no total)
//   paid to date             38,000.00   (A, net)
//   outstanding claimed      25,000.00   (B, net)
//   retention held            2,000.00   (paid invoices only)
//   retention pending             0.00   (B withholds nothing)
//   drafted, not claimed      5,000.00
//   rejected gross            9,000.00
//   remaining authorized     35,000.00   (100,000 − 65,000)
// ---------------------------------------------------------------------------

const FIXTURE_INVOICES: DrawdownInvoiceLike[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    invoice_number: "RB-2026-001",
    status: "paid",
    amount: "40000.00",
    retention_percent: 5,
    retention_amount: 0,
    invoice_date: "2026-01-15",
    due_date: "2026-02-14",
    paid_date: "2026-02-10",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    invoice_number: "RB-2026-002",
    status: "submitted",
    amount: "25000.00",
    retention_percent: 0,
    retention_amount: 0,
    invoice_date: "2026-02-20",
    due_date: "2026-03-22",
    paid_date: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    invoice_number: "RB-2026-003",
    status: "draft",
    amount: "5000.00",
    retention_percent: 0,
    retention_amount: 0,
    invoice_date: null,
    due_date: null,
    paid_date: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    invoice_number: "RB-2026-004",
    status: "rejected",
    amount: "9000.00",
    retention_percent: 0,
    retention_amount: 0,
    invoice_date: "2026-03-01",
    due_date: "2026-03-31",
    paid_date: null,
  },
];

function fixtureLedger(overrides?: { invoices?: DrawdownInvoiceLike[]; awardedAmount?: string }): AwardDrawdownLedger {
  const result = buildAwardDrawdownLedger({
    award: {
      awarded_amount: overrides?.awardedAmount ?? "100000.00",
      match_amount: "12500.00",
      match_posture: "secured",
    },
    invoiceRead: { ok: true, invoices: overrides?.invoices ?? FIXTURE_INVOICES },
  });
  if (!result.ok) throw new Error("fixture ledger failed to build");
  return result.ledger;
}

const FIXTURE_COSTS: WorksheetCostEntryLike[] = [
  { entry_date: "2026-01-08", description: "Traffic count program", vendor_label: "Sierra Counts LLC", amount: "4210.75" },
  { entry_date: "2026-01-29", description: "Corridor design task 3", vendor_label: "Ridgeline Engineering", amount: "18990.00" },
  { entry_date: "2026-02-11", description: "Public meeting venue", vendor_label: null, amount: "1250.25" },
];

function renderFixture(
  overrides: Partial<Parameters<typeof buildReimbursementWorksheetHtml>[0]> = {}
): string {
  return buildReimbursementWorksheetHtml({
    workspace: { name: "Sierra Regional Transportation Agency" },
    award: { title: "Ridge Corridor Safety Improvements", projectName: "Ridge Corridor" },
    period: { start: "2026-01-01", end: "2026-02-28" },
    ledger: fixtureLedger(),
    profile: bindingFor({ country: "CA", subdivision: "ON" }),
    interimDefaultRationale: INTERIM_DEFAULT_RATIONALE,
    costs: summarizeWorksheetCostEntries({ ok: true, entries: FIXTURE_COSTS }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------

describe("summarizeWorksheetCostEntries — the one sum in this module", () => {
  it("totals the period's recorded costs to the cent", () => {
    const section = summarizeWorksheetCostEntries({ ok: true, entries: FIXTURE_COSTS });
    expect(section.ok).toBe(true);
    if (!section.ok) return;

    // 4,210.75 + 18,990.00 + 1,250.25, derived by hand.
    expect(section.recordedTotal).toBe(24451.0);
    expect(section.lines).toHaveLength(3);
    expect(section.lines[0]).toEqual({
      entryDate: "2026-01-08",
      description: "Traffic count program",
      vendorLabel: "Sierra Counts LLC",
      amount: 4210.75,
    });
    // A null vendor stays null rather than becoming an empty string that would
    // render as a blank cell indistinguishable from a recorded blank.
    expect(section.lines[2].vendorLabel).toBeNull();
  });

  it("accumulates to the cent rather than to float residue", () => {
    const section = summarizeWorksheetCostEntries({
      ok: true,
      entries: [{ amount: "0.1" }, { amount: "0.2" }, { amount: "0.3" }],
    });
    if (!section.ok) throw new Error("expected an ok section");
    // 0.1 + 0.2 is 0.30000000000000004 unrounded; the ledger rounds after each
    // addition and so does this, so the two agree to the cent.
    expect(section.recordedTotal).toBe(0.6);
  });

  it("rounds after EACH addition, the way the ledger and the register do", () => {
    // Pins the convention, not a realistic row: `amount` is NUMERIC(14,2), so
    // sub-cent inputs cannot be stored. The convention still has to be pinned,
    // because it is the only reason the worksheet, the drawdown ledger and the
    // invoice register agree to the cent instead of drifting apart by residue —
    // and rounding once at the end is the natural-looking edit that breaks it.
    //
    //   per addition : round(0.005) = 0.01, round(0.01 + 0.005) = 0.02
    //   once at end  : round(0.005 + 0.005) = 0.01
    const section = summarizeWorksheetCostEntries({
      ok: true,
      entries: [{ amount: "0.005" }, { amount: "0.005" }],
    });
    if (!section.ok) throw new Error("expected an ok section");
    expect(section.recordedTotal).toBe(0.02);
  });

  it("returns a null total if and ONLY if there are no lines", () => {
    // The invariant the document relies on to render its total without a
    // zero-coalesce. A `?? 0` in the builder would be unreachable code no test
    // could judge; this is where the reachability is actually established.
    const empty = summarizeWorksheetCostEntries({ ok: true, entries: [] });
    const populated = summarizeWorksheetCostEntries({ ok: true, entries: [{ amount: "0" }] });
    if (!empty.ok || !populated.ok) throw new Error("expected ok sections");
    expect(empty.recordedTotal).toBeNull();
    // A single genuinely-zero cost row is a RECORDED zero, and reports as one.
    expect(populated.recordedTotal).toBe(0);
  });

  it("reports NO total when no cost entries exist — an unreported amount is not zero", () => {
    const section = summarizeWorksheetCostEntries({ ok: true, entries: [] });
    if (!section.ok) throw new Error("expected an ok section");
    expect(section.recordedTotal).toBeNull();
    expect(section.lines).toEqual([]);
  });

  it("carries a read failure through instead of turning it into an empty ledger", () => {
    const section = summarizeWorksheetCostEntries({
      ok: false,
      pending: true,
      message: 'column project_spend_entries.amount does not exist',
    });
    expect(section).toEqual({
      ok: false,
      pending: true,
      message: "column project_spend_entries.amount does not exist",
    });
  });
});

describe("selectWorksheetInvoiceLines — selection, never arithmetic", () => {
  const lines = fixtureLedger().lines;

  it("keeps every line when no period is given", () => {
    const selection = selectWorksheetInvoiceLines(lines, null);
    expect(selection.scopedToPeriod).toBe(false);
    expect(selection.lines).toHaveLength(4);
    expect(selection.excludedForMissingDate).toBe(0);
  });

  it("scopes to the period and COUNTS what it excluded for a missing date", () => {
    const selection = selectWorksheetInvoiceLines(lines, { start: "2026-01-01", end: "2026-02-28" });
    expect(selection.scopedToPeriod).toBe(true);
    expect(selection.lines.map((line) => line.invoiceNumber)).toEqual(["RB-2026-001", "RB-2026-002"]);
    // RB-2026-003 has no invoice date. It is not silently dropped: the count is
    // what the document uses to say so on the page.
    expect(selection.excludedForMissingDate).toBe(1);
  });

  it("treats an open-ended period as open on that end", () => {
    expect(selectWorksheetInvoiceLines(lines, { start: "2026-02-01", end: null }).lines.map((l) => l.invoiceNumber)).toEqual([
      "RB-2026-002",
      "RB-2026-004",
    ]);
    expect(selectWorksheetInvoiceLines(lines, { start: null, end: "2026-01-31" }).lines.map((l) => l.invoiceNumber)).toEqual([
      "RB-2026-001",
    ]);
  });

  it("includes the boundary dates themselves", () => {
    const selection = selectWorksheetInvoiceLines(lines, { start: "2026-01-15", end: "2026-02-20" });
    expect(selection.lines.map((line) => line.invoiceNumber)).toEqual(["RB-2026-001", "RB-2026-002"]);
  });

  it("never alters a line's figures", () => {
    const selection = selectWorksheetInvoiceLines(lines, { start: "2026-01-01", end: "2026-01-31" });
    expect(selection.lines[0]).toEqual(lines[0]);
  });
});

describe("the worksheet prints the ledger's figures and computes none of its own", () => {
  const html = renderFixture();

  /**
   * EVERY figure is asserted ON ITS OWN ROW, label and value together.
   *
   * The first version of this test asserted that each amount appeared SOMEWHERE
   * in the document. It passed a mutation that swapped the two retention
   * labels, and a mutation that printed claimed-gross in the paid-to-date row —
   * both amounts were still "in the document". Proving a number is present is
   * not proving it is the right number for that line, and a planner reads the
   * line, not the document.
   */
  it("renders every award-position figure at its hand-derived value, on its own row", () => {
    const rows: ReadonlyArray<[string, string]> = [
      ["Authorized amount", "$100,000.00"],
      ["Claimed to date (gross)", "$65,000.00"],
      ["Paid to date (net of retention)", "$38,000.00"],
      ["Claimed and not yet paid (net)", "$25,000.00"],
      ["Retention withheld on paid invoices", "$2,000.00"],
      ["Retention proposed on unpaid claims", "$0.00"],
      ["Remaining against the authorization", "$35,000.00"],
      ["Drafted, not yet claimed (net)", "$5,000.00"],
      ["Rejected by the funder (gross)", "$9,000.00"],
      ["Local match recorded on the award", "$12,500.00"],
    ];

    for (const [label, amount] of rows) {
      const row = positionRow(html, label);
      expect(row, `the "${label}" row does not show ${amount}`).toContain(`<td class="num">${amount}</td>`);
    }

    expect(positionRow(html, "Local match recorded on the award")).toContain(
      "posture recorded as &quot;secured&quot;"
    );
  });

  it("counts the records behind each figure, on the same row as the figure", () => {
    expect(positionRow(html, "Claimed to date (gross)")).toContain("2 invoice records");
    expect(positionRow(html, "Paid to date (net of retention)")).toContain("1 invoice record<");
    expect(positionRow(html, "Claimed and not yet paid (net)")).toContain("1 invoice record<");
  });

  it("says drafts and rejected records are in no total, ON those rows", () => {
    expect(positionRow(html, "Drafted, not yet claimed (net)")).toContain("not included in any total above");
    expect(positionRow(html, "Rejected by the funder (gross)")).toContain("not included in any total above");
    // …and NOT on the rows that ARE totals, which would be the opposite lie.
    expect(positionRow(html, "Claimed to date (gross)")).not.toContain("not included in any total");
  });

  it("labels retention proposed-versus-held so the two can never trade places", () => {
    // A swap of these two labels is a plausible copy edit and a serious claim:
    // it would tell an agency the funder is holding money it has not withheld.
    expect(positionRow(html, "Retention proposed on unpaid claims")).toContain("proposed, not yet withheld");
    expect(positionRow(html, "Retention withheld on paid invoices")).not.toContain("proposed");
  });

  it("carries no total row on the invoice table — the award position totals once", () => {
    const invoiceTable = html.slice(html.indexOf("Invoice records in this period"), html.indexOf("Recorded project costs"));
    expect(invoiceTable).not.toContain("<tfoot>");
    expect(invoiceTable).toContain("Totals for this award appear once, under Award position.");
  });

  it("distinguishes 'none in this period' from 'none on this award'", () => {
    // The two sentences are different claims. Telling an agency no invoices are
    // linked to an award that has four of them, because they all fall outside
    // the period they picked, would send them to relink invoices that are fine.
    const outsidePeriod = renderFixture({ period: { start: "2027-01-01", end: "2027-12-31" } });
    expect(outsidePeriod).toContain("No invoice records carry an invoice date inside this period.");
    expect(outsidePeriod).not.toContain("No invoice records are linked to this award.");

    const noInvoices = renderFixture({ ledger: fixtureLedger({ invoices: [] }), period: null });
    expect(noInvoices).toContain("No invoice records are linked to this award.");
    expect(noInvoices).not.toContain("No invoice records carry an invoice date inside this period.");
  });

  it("shows only the period's invoices and discloses the undated one it left out", () => {
    expect(html).toContain("RB-2026-001");
    expect(html).toContain("RB-2026-002");
    expect(html).not.toContain("RB-2026-003"); // undated draft
    expect(html).not.toContain("RB-2026-004"); // outside the period
    expect(html).toContain("1 invoice record carries no invoice date");
    expect(html).toContain("still counted in the award position above");
  });

  it("prints the period cost ledger and its hand-derived total", () => {
    expect(html).toContain("Traffic count program");
    expect(html).toContain("Ridgeline Engineering");
    expect(html).toContain("$24,451.00");
  });

  it("says 'no cost entries recorded' rather than $0.00 when the period has none", () => {
    const empty = renderFixture({ costs: summarizeWorksheetCostEntries({ ok: true, entries: [] }) });
    expect(empty).toContain("No cost entries recorded for this period.");
    const costBlock = empty.slice(empty.indexOf("Recorded project costs"), empty.indexOf("Reimbursement process"));
    expect(costBlock).not.toContain("$0.00");
  });

  it("discloses a failed cost read as a failure, never as an absence of costs", () => {
    const failed = renderFixture({
      costs: summarizeWorksheetCostEntries({ ok: false, pending: false, message: "connection reset" }),
    });
    expect(failed).toContain("could not be read");
    expect(failed).toContain("This is not a statement that no costs were recorded.");
    expect(failed).not.toContain("No cost entries recorded for this period.");
  });

  it("says an unapplied migration is a setup gap, not a read failure", () => {
    const pending = renderFixture({
      costs: summarizeWorksheetCostEntries({
        ok: false,
        pending: true,
        message: "relation \"project_spend_entries\" does not exist",
      }),
    });
    expect(pending).toContain("not available on this deployment yet");
  });
});

/** The one `<tr>` of the award-position table whose row header starts with `label`. */
function positionRow(html: string, label: string): string {
  const rows = html
    .slice(html.indexOf("Award position"), html.indexOf("Invoice records"))
    .split("<tr>")
    .slice(1);
  const row = rows.find((candidate) => candidate.includes(`>${label}`));
  if (!row) throw new Error(`no award-position row headed "${label}"`);
  return row;
}

describe("nothing unrecorded is rendered as a zero", () => {
  it("renders an unrecorded authorization as 'Not recorded' and shows no remaining balance", () => {
    // The column is NOT NULL DEFAULT 0, so a zero cannot be told apart from an
    // amount nobody entered — and "$0.00 authorized" would state a fact the
    // database does not hold. Asserted row by row: a whole-block scan for
    // "$0.00" would be satisfied by the retention row's genuine, computed zero.
    const html = renderFixture({ ledger: fixtureLedger({ awardedAmount: "0" }) });

    expect(positionRow(html, "Authorized amount")).toContain("Not recorded");
    expect(positionRow(html, "Authorized amount")).not.toContain("$");
    expect(positionRow(html, "Remaining against the authorization")).toContain("Not recorded");
    expect(positionRow(html, "Remaining against the authorization")).not.toContain("$");
    expect(html).toContain("No authorized amount is recorded on this award");

    // …and the same guard proves the rows DO carry figures when they exist.
    const recorded = renderFixture();
    expect(positionRow(recorded, "Authorized amount")).toContain("$100,000.00");
    expect(positionRow(recorded, "Remaining against the authorization")).toContain("$35,000.00");
  });

  it("shows a negative remainder as an over-claim rather than clamping it to zero", () => {
    const overClaimed = fixtureLedger({ awardedAmount: "10000.00" });
    // 10,000 authorized against 65,000 claimed gross.
    expect(overClaimed.remainingAuthorized).toBe(-55000);
    const html = renderFixture({ ledger: overClaimed });
    expect(html).toContain("-$55,000.00");
    expect(html).toContain("Claims against this award exceed its authorized amount");
  });

  it("discloses paid invoices whose payment date nobody recorded", () => {
    const undatedPayment = fixtureLedger({
      invoices: [{ ...FIXTURE_INVOICES[0], paid_date: null }, ...FIXTURE_INVOICES.slice(1)],
    });
    expect(undatedPayment.paidWithNoDateCount).toBe(1);
    const html = renderFixture({ ledger: undatedPayment });
    expect(html).toContain("1 invoice record is marked paid with no payment date recorded");
    expect(html).toContain("has not been substituted");
  });

  it("does not print the over-claim alert when the award is within its authorization", () => {
    expect(renderFixture()).not.toContain("Claims against this award exceed");
  });
});

describe("a new jurisdiction is a descriptor, not a code change", () => {
  it("produces a coherent packet for a funder OpenPlan has never registered", () => {
    const html = renderFixture();

    // Every jurisdiction word on the page traces to the descriptor.
    expect(html).toContain("Ontario Connecting Links reimbursement");
    expect(html).toContain("Your executed transfer payment agreement controls");
    expect(html).toContain("Ministry of Transportation, Municipal Programs Office");
    expect(html).toContain("Progress report");
    expect(html).toContain("Holdback computation");
    expect(html).toContain("The reporting period&#39;s progress narrative");

    // The form-pack status is rendered as a sentence, never as its raw token.
    expect(html).toContain(WORKSHEET_NO_FORM_PACK_NOTE);
    expect(html).not.toContain("deferred_exact_forms");

    // The checklist is guidance, unchecked, and says so.
    expect(html).toContain("What your funder likely expects you to have in hand");
    expect(html).toContain("OpenPlan does not verify any of these");
    expect(html).not.toContain("&#9745;"); // no ballot-box-with-check anywhere
    expect(html).toContain("&#9744;");
  });

  it("VARIES WITH THE BINDING — a profile declaring none of the optional fields prints none of it", () => {
    // The counterpart fixture. One profile cannot tell "threads the binding"
    // apart from "prints a constant"; this is the second binding that can.
    const html = renderFixture({ profile: bindingFor({ country: "US", subdivision: "OR" }) });

    expect(html).toContain("Oregon STBG fund-exchange reimbursement");
    expect(html).not.toContain("Ontario Connecting Links reimbursement");
    expect(html).not.toContain("Ministry of Transportation");
    expect(html).not.toContain("Your executed transfer payment agreement controls");
    expect(html).not.toContain(WORKSHEET_NO_FORM_PACK_NOTE);
    expect(html).not.toContain("What your funder likely expects you to have in hand");
    expect(html).not.toContain("Typically submitted to:");
  });

  it("discloses an interim default as assumed, quoting the registry's own rationale", () => {
    // A workspace that has not said where it works. The packet must not present
    // the fallback process as chosen.
    const html = renderFixture({ profile: bindingFor(null) });
    expect(html).toContain("Canadian federal contribution reimbursement (generic)");
    expect(html).toContain("This process was not chosen for this workspace.");
    // The rationale is an input like any other and is escaped on the way in, so
    // it reaches the page with its apostrophe encoded. Asserted on the
    // apostrophe-free tail plus the encoded head, so a builder that dropped the
    // rationale entirely cannot pass.
    expect(html).toContain("interim default profile is applied and disclosed");
    expect(html).toContain("No reimbursement profile is registered for this workspace&#39;s jurisdiction");
    expect(INTERIM_DEFAULT_RATIONALE).toContain("interim default profile is applied and disclosed");
  });

  it("does not claim a process was assumed when the jurisdiction actually matched", () => {
    expect(renderFixture()).not.toContain("This process was not chosen for this workspace.");
  });

  it("labels a submit-to hint as a hint from the profile, not an address on the award", () => {
    expect(renderFixture()).toContain("not an address recorded for this award");
  });
});

describe("the packet's honesty furniture", () => {
  it("names itself a worksheet, never an invoice", () => {
    const html = renderFixture();
    expect(html).toContain("Reimbursement worksheet");
    expect(html).not.toMatch(/<p class="doc-title">INVOICE/i);
  });

  it("renders every disclosure the ledger's partition needs", () => {
    const html = renderFixture();
    expect(html).toContain("Approved for payment is a funder&#39;s promise, not a deposit");
    expect(html).toContain("Retention is treated as withheld per invoice");
    expect(html).toContain("Retention released at closeout is not tracked here");
    expect(html).toContain("internal review, submitted, approved for payment, and paid");
  });

  it("renders an assembly notice verbatim — a degradation nobody sees is the defect", () => {
    const html = renderFixture({
      assemblyNotices: ["Payment dates are not available on this deployment yet, so no invoice shows one."],
    });
    expect(html).toContain("Payment dates are not available on this deployment yet");
  });

  it("escapes user-entered text so markup arrives as characters", () => {
    const html = renderFixture({
      workspace: { name: "<script>alert('x')</script> County" },
      award: { title: "Bridge & Culvert <Phase 2>", projectName: null },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Bridge &amp; Culvert &lt;Phase 2&gt;");
  });

  it("falls back to honest placeholders rather than blank paper", () => {
    const html = renderFixture({
      workspace: null,
      award: { title: null, projectName: null },
      period: null,
    });
    expect(html).toContain("This workspace");
    expect(html).toContain("Untitled award");
    expect(html).toContain("Award to date — no period selected");
    // With no period, the invoice table is the whole award, not an empty period.
    expect(html).toContain("Invoice records on this award");
    expect(html).toContain("RB-2026-003");
  });

  it("carries the prepared-by note in the body AND in the repeating page footer", () => {
    const html = renderFixture();
    const occurrences = html.split(WORKSHEET_PREPARED_NOTE).length - 1;
    expect(occurrences).toBe(2);
    expect(html).toContain(`<p class="prepared-note">${WORKSHEET_PREPARED_NOTE}</p>`);
    expect(html).toContain(`<div class="page-footer">${WORKSHEET_PREPARED_NOTE}</div>`);
  });
});


/**
 * WHOSE DOLLARS? Every money figure on this packet used to be formatted
 * `currency: "USD"`, and the document named no currency at all. For a non-US
 * funder that is a plausible, well-typeset number under the wrong unit, with
 * nothing on the page a reader could use to catch it — the failure mode this
 * whole module is written against.
 *
 * The currency is declared by the PROFILE, because it is a property of the
 * funding process. Where no profile declares one, the packet says it is
 * assuming US dollars rather than quietly assuming them.
 */
describe("the currency the packet is denominated in", () => {
  it("prints the currency the bound profile declares, not US dollars", () => {
    const html = renderFixture({ profile: bindingFor({ country: "CA", subdivision: "QC" }) });

    expect(html).toContain("All amounts on this worksheet are in CAD.");
    // 38,000.00 + 25,000.00 net paid/claimed comes out of the fixture ledger.
    expect(html).toContain("CA$");
    expect(html).not.toMatch(/>\$[\d,]/);
  });

  it("carries the profile's currency through to the invoice and cost tables too", () => {
    const html = renderFixture({ profile: bindingFor({ country: "CA", subdivision: "QC" }) });

    // Not just the award-position table: a packet whose summary is in CAD and
    // whose line items are in USD is worse than one wrong currency.
    const dollarSignFigures = [...html.matchAll(/>(\$[\d,]+\.\d{2})</g)].map((m) => m[1]);
    expect(dollarSignFigures).toEqual([]);
  });

  it("discloses the assumption when no profile declares a currency", () => {
    // OREGON_STBG_EXCHANGE declares none.
    const html = renderFixture({ profile: bindingFor({ country: "US", subdivision: "OR" }) });

    expect(html).toContain(
      "All amounts on this worksheet are shown in USD. This reimbursement process does not declare a currency, so USD is an assumption OpenPlan made, not a fact from your record."
    );
    // …and it is flagged, not tucked into a footnote: the reader is being told
    // OpenPlan guessed the unit their money is in.
    expect(html).toMatch(/class="alert">All amounts on this worksheet are shown in USD/);
  });

  it("lets an explicit caller currency outrank the profile", () => {
    const html = renderFixture({
      profile: bindingFor({ country: "CA", subdivision: "QC" }),
      currencyCode: "eur",
    });

    expect(html).toContain("All amounts on this worksheet are in EUR.");
    expect(html).not.toContain("in CAD.");
  });

  it("resolves the precedence explicitly, and reports whether anyone declared one", () => {
    expect(resolveWorksheetCurrency({ currencyCode: " gbp ", profile: { currencyCode: "CAD" } })).toEqual({
      code: "GBP",
      declared: true,
    });
    expect(resolveWorksheetCurrency({ profile: { currencyCode: "CAD" } })).toEqual({
      code: "CAD",
      declared: true,
    });
    // The fallback is USD, and `declared: false` is what makes the packet say so.
    expect(resolveWorksheetCurrency({ profile: { currencyCode: null } })).toEqual({
      code: "USD",
      declared: false,
    });
    expect(resolveWorksheetCurrency({})).toEqual({ code: "USD", declared: false });
  });

  it("does not sink the document on a currency code Intl cannot format", () => {
    const html = renderFixture({
      profile: bindingFor({ country: "CA", subdivision: "QC" }),
      currencyCode: "NOTACODE",
    });

    expect(html).toContain("All amounts on this worksheet are in NOTACODE.");
    expect(html).toContain("NOTACODE");
    expect(html).toContain("Award position");
  });
});
