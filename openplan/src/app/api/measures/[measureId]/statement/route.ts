import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import {
  MEASURE_ALLOCATION_COLUMNS,
  MEASURE_ALLOCATION_RULE_COLUMNS,
  MEASURE_FUND_COLUMNS,
  MEASURE_FUND_PERIOD_COLUMNS,
  MEASURE_OFF_THE_TOP_COLUMNS,
  MEASURE_RECEIPT_CADENCES,
  MEASURE_RECIPIENT_COLUMNS,
  MEASURE_RECIPIENT_KINDS,
  MEASURE_RESERVE_COLUMNS,
  resolveAllocationRuleInForce,
} from "@/lib/measures/fund";
import {
  MEASURE_CLAIM_COLUMNS,
  MEASURE_MOE_COLUMNS,
  buildMeasureClaimLedger,
  buildMeasureMoeSummary,
  toMeasureClaimRead,
} from "@/lib/measures/claims";
import {
  buildMeasureReceiptLedger,
  toMeasureFundPeriodRead,
  toMeasureOffTheTopTakeRead,
  toMeasureReserveRead,
} from "@/lib/measures/receipts";
import { isNarrativeRule, parseMeasureAllocationRule, type MeasureAllocationRule } from "@/lib/measures/allocation";
import { buildMeasureOversightModel, formatOversightSpan } from "@/lib/measures/oversight";
import {
  buildMeasureAnnualStatementHtml,
  type MeasureStatementCoverage,
} from "@/lib/measures/oversight-statement";

/**
 * ONE FISCAL YEAR OF A MEASURE FUND, AS A DOCUMENT.
 *
 * ============================================================================
 * THE YEAR IS SCOPED IN THE QUERIES, NOT IN THE ARITHMETIC
 * ============================================================================
 *
 * Every read below is filtered to the requested `fiscalYearLabel` before it
 * reaches a ledger: the periods by their own label, the claims by theirs, and
 * the allocations by `period_id IN (the year's periods)`. The ledgers then see
 * exactly one year and derive their totals over it.
 *
 * The alternative — read everything and filter the ledger's output — was
 * rejected. `buildMeasureClaimLedger` reports
 * `allocationsWithUnknownPeriodCount` for allocation rows whose period it was
 * not given, and handing it the whole fund's allocations against one year's
 * periods would report every OTHER year's allocations as unmatched. The
 * statement would then carry a caveat about incompleteness that is an artefact
 * of how it was built rather than a fact about the fund.
 *
 * ============================================================================
 * A FAILED READ REFUSES THE DOCUMENT
 * ============================================================================
 *
 * The drawdown worksheet's rule, and for the same reason: a statement showing
 * "received: 0.00" because a query failed is a database error wearing a number,
 * on a document somebody files. The two load-bearing reads — periods and claims
 * — are hard failures with a 502. The rule version is not: an unreadable
 * ordinance descriptor costs the statement its category table and nothing else,
 * so it degrades to "the agency has not recorded how the ordinance divides this
 * money" rather than blocking the year's figures.
 *
 * ============================================================================
 * HTML, NOT PDF, AND DELIBERATELY
 * ============================================================================
 *
 * `renderReportPdf` is the product's PDF pipeline and it is the right choice
 * for the reimbursement worksheet, which is a packet an agency hands a funder.
 * This is a document a committee member opens, reads and prints from a browser.
 * HTML costs no Chrome on a self-hosted box — CLAUDE.md makes self-hosting
 * first-class — reflows on a phone, and is what `Ctrl+P` already turns into
 * paper. `content-disposition: inline` so it opens rather than downloads.
 *
 * WHO MAY READ IT: any member of the workspace. The read runs through the
 * caller's own RLS client, so `measure_funds`' SELECT policy is the access
 * control and a non-member gets the same 404 as a measure that does not exist.
 * The PUBLIC route to the same facts is the share-token page, which is a
 * different surface with a different switch.
 */

const paramsSchema = z.object({ measureId: z.string().uuid() });
const querySchema = z.object({
  fiscalYearLabel: z.string().trim().min(1).max(120),
});

function cadenceLabel(value: string | null | undefined): string | null {
  return MEASURE_RECEIPT_CADENCES.find((cadence) => cadence.value === value)?.label ?? null;
}

function recipientKindLabel(value: string | null | undefined): string {
  return MEASURE_RECIPIENT_KINDS.find((kind) => kind.value === value)?.label ?? "";
}

/** A safe download filename: `annual-statement-fy-2026.html`. */
function statementFilename(fiscalYearLabel: string): string {
  const slug =
    fiscalYearLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "year";
  return `annual-statement-${slug}.html`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.statement", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });
    }

    const query = querySchema.safeParse({
      fiscalYearLabel: request.nextUrl.searchParams.get("fiscalYearLabel") ?? "",
    });
    if (!query.success) {
      return NextResponse.json(
        { error: "Name the fiscal year this statement covers (fiscalYearLabel)." },
        { status: 400 }
      );
    }
    const fiscalYearLabel = query.data.fiscalYearLabel;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const fundResult = await supabase
      .from("measure_funds")
      .select(MEASURE_FUND_COLUMNS)
      .eq("id", routeParams.data.measureId)
      .maybeSingle();

    const fundFailure = classifyRouteReadFailure("the measure fund", fundResult);
    if (fundFailure) {
      audit.error("fund_read_failed", { message: fundFailure.message });
      return NextResponse.json(fundFailure.body, { status: fundFailure.status });
    }
    const fund = fundResult.data as
      | {
          id: string;
          workspace_id: string;
          program_id: string;
          currency_code: string;
          rate_label: string | null;
          ordinance_reference: string | null;
          receipt_cadence: string | null;
        }
      | null;
    if (!fund) return NextResponse.json({ error: "Measure fund not found" }, { status: 404 });

    const [periodsResult, programResult, workspaceResult, recipientsResult, rulesResult] = await Promise.all([
      supabase
        .from("measure_fund_periods")
        .select(MEASURE_FUND_PERIOD_COLUMNS)
        .eq("measure_fund_id", fund.id)
        .eq("fiscal_year_label", fiscalYearLabel)
        .order("period_start", { ascending: true }),
      supabase.from("programs").select("id, title").eq("id", fund.program_id).maybeSingle(),
      supabase.from("workspaces").select("id, name").eq("id", fund.workspace_id).maybeSingle(),
      supabase.from("measure_recipients").select(MEASURE_RECIPIENT_COLUMNS).eq("measure_fund_id", fund.id),
      supabase.from("measure_allocation_rules").select(MEASURE_ALLOCATION_RULE_COLUMNS).eq("measure_fund_id", fund.id),
    ]);

    // LOAD-BEARING. Every figure on the statement is scoped by these rows; a
    // failed read here would produce a document reporting a year of nothing.
    const periodsFailure = classifyRouteReadFailure("this year's reporting periods", periodsResult);
    if (periodsFailure) {
      audit.error("periods_read_failed", { measureId: fund.id, message: periodsFailure.message });
      return NextResponse.json(periodsFailure.body, { status: periodsFailure.status });
    }

    const periodRows = ((periodsResult.data as Array<{ id: string; fiscal_year_label: string }> | null) ?? []);
    const periodIds = periodRows.map((period) => period.id);

    const [claimsResult, allocationsResult, takesResult, reservesResult, moeResult] = await Promise.all([
      supabase
        .from("measure_claims")
        .select(MEASURE_CLAIM_COLUMNS)
        .eq("measure_fund_id", fund.id)
        .eq("fiscal_year_label", fiscalYearLabel),
      periodIds.length
        ? supabase
            .from("measure_allocations")
            .select(MEASURE_ALLOCATION_COLUMNS)
            .eq("measure_fund_id", fund.id)
            .in("period_id", periodIds)
        : Promise.resolve({ data: [], error: null }),
      /*
       * WHAT THE ORDINANCE TOOK OUT FIRST, over the SAME year.
       *
       * Scoped by `period_id IN (this year's periods)` and not by
       * `fiscal_year_label`, because `measure_period_off_the_top` has no year
       * column — a take belongs to a period and the period carries the year.
       * That is the same join the allocations read above makes, and it must
       * stay the same: a take scoped one way against receipts scoped another
       * produces a subtraction between two different years, which is worse
       * than the missing section it replaced.
       */
      periodIds.length
        ? supabase
            .from("measure_period_off_the_top")
            .select(MEASURE_OFF_THE_TOP_COLUMNS)
            .eq("measure_fund_id", fund.id)
            .in("period_id", periodIds)
        : Promise.resolve({ data: [], error: null }),
      /*
       * WHAT THE ORDINANCE KEPT BACK, over the SAME year, joined the SAME way.
       *
       * `measure_period_reserve` has no year column either — a reserve belongs
       * to a period and the period carries the year — so it is scoped by
       * `period_id IN (this year's periods)` exactly like the takes and the
       * allocations above. Three row sets scoped three different ways would
       * produce a subtraction across three different spans, which is worse than
       * the missing line it replaced.
       */
      periodIds.length
        ? supabase
            .from("measure_period_reserve")
            .select(MEASURE_RESERVE_COLUMNS)
            .eq("measure_fund_id", fund.id)
            .in("period_id", periodIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("measure_moe_records")
        .select(MEASURE_MOE_COLUMNS)
        .eq("measure_fund_id", fund.id)
        .eq("fiscal_year_label", fiscalYearLabel),
    ]);

    /*
     * EVERY READ THIS DOCUMENT PRINTS FROM IS LOAD-BEARING.
     *
     * A page can disclose a section it could not load and let the reader
     * discount it. A DOCUMENT cannot: it is downloaded, printed and filed, and
     * a section silently absent from the copy in a committee packet has no way
     * to say it was ever meant to be there. So a statement is produced in full
     * or not at all, and the refusal names what failed.
     */
    for (const [subject, event, result] of [
      ["this year's claims", "claims_read_failed", claimsResult],
      ["this year's allocations", "allocations_read_failed", allocationsResult],
      /*
       * A FAILED TAKES READ REFUSES THE DOCUMENT rather than degrading it.
       *
       * The public page can show "what was taken out could not be loaded" and
       * let a reader discount that one section. This document gets printed and
       * filed, and a statement whose subtraction silently does not close is
       * the exact artefact the section was added to prevent. `?? []` here
       * would be worse still: it prints an ordinance that took nothing, which
       * for most measures is false and is the agency's word, not a failed
       * query's. A deployment that has not applied
       * 20260812000014 gets the 503 that names the missing migration.
       */
      ["what the ordinance took out first", "off_the_top_read_failed", takesResult],
      /*
       * AND WHAT IT KEPT BACK, refused just as hard and for the same reason.
       * Without it the document prints a chain whose middle is complete and
       * whose end is not: `received − taken out` over a fund that keeps money
       * back is more than the purposes were given, and a filed statement whose
       * arithmetic silently does not close is the artefact this section exists
       * to prevent. A deployment that has not applied 20260812000019 gets the
       * 503 that names the missing migration.
       */
      ["what the ordinance kept back in reserve", "reserve_read_failed", reservesResult],
      ["the local-spending commitments", "moe_read_failed", moeResult],
      ["the cities and districts this fund pays", "recipients_read_failed", recipientsResult],
      ["the measure's name", "program_read_failed", programResult],
      ["the agency's name", "workspace_read_failed", workspaceResult],
    ] as const) {
      const failure = classifyRouteReadFailure(subject, result);
      if (failure) {
        audit.error(event, { measureId: fund.id, fiscalYearLabel, message: failure.message });
        return NextResponse.json(failure.body, { status: failure.status });
      }
    }

    /* ---- The ledgers: pure, over rows already scoped to the year ---- */
    const receiptResult = buildMeasureReceiptLedger({
      periodRead: toMeasureFundPeriodRead(
        periodsResult as unknown as Parameters<typeof toMeasureFundPeriodRead>[0]
      ),
      fiscalYearLabel,
    });
    const claimResult = buildMeasureClaimLedger({
      claimRead: toMeasureClaimRead(claimsResult as unknown as Parameters<typeof toMeasureClaimRead>[0]),
      allocations: (allocationsResult.data as never) ?? [],
      periods: (periodsResult.data as never) ?? [],
    });
    const moeSummary = buildMeasureMoeSummary({ records: (moeResult.data as never) ?? [] });

    if (!receiptResult.ok) {
      audit.error("receipt_ledger_failed", { measureId: fund.id, message: receiptResult.message });
      return NextResponse.json(
        { error: "This year's receipts could not be read, so no statement was produced." },
        { status: 502 }
      );
    }
    if (!claimResult.ok) {
      audit.error("claim_ledger_failed", { measureId: fund.id, message: claimResult.message });
      return NextResponse.json(
        { error: "This year's claims could not be read, so no statement was produced." },
        { status: 502 }
      );
    }

    /* ---- The rule in force at the year's first period ---- */
    const ruleRows = ((rulesResult.data as Array<{ id: string; rule: unknown; effective_from: string }> | null) ?? []);
    const firstPeriodStart = receiptResult.ledger.lines[0]?.periodStart ?? null;
    const inForce = firstPeriodStart ? resolveAllocationRuleInForce(ruleRows, firstPeriodStart) : null;
    let rule: MeasureAllocationRule | null = null;
    let ruleUnavailableSentence: string | null = rulesResult.error
      ? "The ordinance's own split could not be read, so it is not shown here."
      : null;
    if (!ruleUnavailableSentence && inForce) {
      try {
        rule = parseMeasureAllocationRule(inForce.rule);
      } catch {
        ruleUnavailableSentence =
          "The recorded version of the ordinance's split could not be read, so it is not shown here.";
      }
    }

    const recipients = ((recipientsResult.data as Array<{
      id: string;
      name: string;
      recipient_kind: string;
    }> | null) ?? []).map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      kindLabel: recipientKindLabel(recipient.recipient_kind),
    }));

    const program = programResult.data as { title: string } | null;
    const workspace = workspaceResult.data as { name: string } | null;

    const model = buildMeasureOversightModel({
      programTitle: program?.title ?? "This measure",
      currencyCode: fund.currency_code || "USD",
      rateLabel: fund.rate_label,
      ordinanceReference: fund.ordinance_reference,
      adoptedOn: null,
      sunsetOn: null,
      sunsetPosture: "not_recorded",
      receiptResult,
      claimResult,
      moeSummary,
      rule,
      ruleUnavailableSentence,
      recipients,
      /*
       * THE YEAR THIS DOCUMENT IS ABOUT, so the coverage sentences say so.
       *
       * Every read above is filtered to `fiscalYearLabel` before it reaches a
       * ledger — and the claim figures were then printed under "across every
       * year on the record", which is the one thing they were not. On a
       * document a committee files, a reader adding four annual statements
       * together would have believed they were adding four copies of the same
       * lifetime total. The figures were right; the sentence describing them
       * was wrong, and on this surface the sentence is the figure's meaning.
       *
       * The three `*UnavailableSentence` inputs are deliberately not passed:
       * this route REFUSES on any failed read (see the header), so there is no
       * degraded state for a document to carry. A statement is produced in full
       * or not at all.
       */
      fiscalYearLabel,

      /*
       * THE SUBTRACTION, over this year's periods.
       *
       * `division` was left null here on purpose when the section was built for
       * the public page: the model distinguishes "the caller supplied no takes"
       * from "the read failed", so a statement that had never been wired up
       * could not print "this could not be loaded" about a database it was
       * never given. This is the wiring. The read is passed whole — never
       * `.data ?? []` — so the distinction survives, and the allocations go
       * with it because which of the year's periods have been divided up at all
       * is the scope all three figures span.
       */
      offTheTopRead: toMeasureOffTheTopTakeRead(
        takesResult as unknown as Parameters<typeof toMeasureOffTheTopTakeRead>[0]
      ),
      reserveRead: toMeasureReserveRead(
        reservesResult as unknown as Parameters<typeof toMeasureReserveRead>[0]
      ),
      allocations: (allocationsResult.data as never) ?? [],
    });

    // Both branches are `ok` — the two failures were refused above — but the
    // model's section type is honest about that and the narrowing has to be
    // performed rather than asserted away. `division` is in the same list: it
    // is non-null because the takes were supplied, and `ok` because the reads
    // it depends on were refused above, and neither is a fact this route may
    // assert with a cast on a document somebody files.
    if (
      !model.receipts.ok ||
      !model.askedFor.ok ||
      !model.paidOut.ok ||
      !model.recipients.ok ||
      !model.division ||
      !model.division.ok
    ) {
      return NextResponse.json(
        { error: "This year's figures could not be assembled, so no statement was produced." },
        { status: 502 }
      );
    }

    /* ---- WHICH MONTHS THIS STATEMENT HAS ---- */
    const reportedLines = receiptResult.ledger.lines.filter((line) => line.receivedAmount !== null);
    const coverage: MeasureStatementCoverage = {
      periodsIncluded: reportedLines.map((line) => line.periodLabel),
      unreportedPeriods: [...receiptResult.ledger.coverage.missingPeriods],
      spanText: formatOversightSpan(
        reportedLines[0]?.periodStart ?? null,
        reportedLines[reportedLines.length - 1]?.periodEnd ?? null
      ),
      cadenceLabel: cadenceLabel(fund.receipt_cadence),
    };

    let html: string;
    try {
      html = buildMeasureAnnualStatementHtml({
        measureTitle: model.title,
        agencyName: workspace?.name ?? null,
        fiscalYearLabel,
        rateLabel: fund.rate_label,
        ordinanceReference: fund.ordinance_reference,
        coverage,
        received: model.receipts.value.total,
        askedFor: model.askedFor.value,
        paidOut: model.paidOut.value,
        division: model.division.value,
        categories: model.ordinance.kind === "categories" ? model.ordinance.rows : [],
        recipients: model.recipients.value,
        moe: model.moe,
        hasStaffEnteredAmounts: model.hasStaffEnteredAmounts,
        generatedOnText: new Date().toISOString().slice(0, 10),
      });
    } catch (error) {
      // `assertStatementCoverage` throws when no period belongs to the year.
      // That is a 404-shaped fact about the request, not a server fault.
      audit.warn("statement_refused", {
        measureId: fund.id,
        fiscalYearLabel,
        reason: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          error: `No reporting period has been opened for ${fiscalYearLabel}, so there is nothing to state for that year.`,
        },
        { status: 404 }
      );
    }

    audit.info("statement_generated", {
      measureId: fund.id,
      workspaceId: fund.workspace_id,
      userId: user.id,
      fiscalYearLabel,
      periodsIncluded: coverage.periodsIncluded.length,
      unreportedPeriods: coverage.unreportedPeriods.length,
      narrativeOrdinance: rule ? isNarrativeRule(rule) : null,
      durationMs: Date.now() - startedAt,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${statementFilename(fiscalYearLabel)}"`,
        // The statement is derived from tenant records and must never be
        // cached by a shared proxy or indexed.
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while producing the statement" }, { status: 500 });
  }
}
