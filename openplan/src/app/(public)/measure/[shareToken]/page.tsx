import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  MEASURE_ALLOCATION_COLUMNS,
  MEASURE_ALLOCATION_RULE_COLUMNS,
  MEASURE_FUND_PERIOD_COLUMNS,
  MEASURE_OFF_THE_TOP_COLUMNS,
  MEASURE_RECIPIENT_COLUMNS,
  MEASURE_RECIPIENT_KINDS,
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
} from "@/lib/measures/receipts";
import { parseMeasureAllocationRule, type MeasureAllocationRule } from "@/lib/measures/allocation";
import {
  MEASURE_OVERSIGHT_COPY,
  buildMeasureOversightModel,
  type MeasureOversightModel,
  type OversightFigure,
  type OversightSection,
} from "@/lib/measures/oversight";

/**
 * THE PUBLIC OVERSIGHT RECORD for one voter-approved local measure.
 *
 * ============================================================================
 * THE URL IS THE CREDENTIAL
 * ============================================================================
 *
 * The `/plan/[shareToken]` posture, copied line for line where it matters: a
 * service-role read matched on BOTH `public_share_token` and
 * `public_share_enabled`, `robots: { index: false, follow: false }` because an
 * indexed token-bearing URL hands anyone who searches a link the agency chose
 * to give to specific people, and a 404 that means "no such published record"
 * and never "the query failed".
 *
 * ============================================================================
 * FIVE THINGS THIS PAGE MAY NOT DO
 * ============================================================================
 *
 * 0. LEAVE THE OBVIOUS ARITHMETIC OPEN. A committee member subtracts what was
 *    set aside from what came in and expects the difference to be explained.
 *    Until 2026-08-12 the amount the ordinance takes before the categories are
 *    cut appeared NOWHERE on this page, so the subtraction found money that had
 *    vanished with nothing to say where it went. "What was taken out before the
 *    rest was divided" is that amount, clause by clause, and the section ends
 *    with the difference between what was left to divide and what the headings
 *    below add up to — stated as a figure whenever it is not zero, never as a
 *    verdict that the page balances.
 *
 * 1. PRINT A TOTAL WITHOUT SAYING WHAT IT COUNTED. Structural rather than
 *    remembered: every headline number arrives as an `OversightFigure`, whose
 *    `coverageSentence` is a required non-empty string, and `<Figure>` below is
 *    the only thing that renders one. There is no path from this file to a bare
 *    amount. `measure-oversight-public-page.test.tsx` renders the real page and
 *    fails if the sentence stops appearing.
 *
 * 2. SHOW A STAFF-ENTERED FIGURE AS A COMPUTED ONE. Ordinances that the
 *    descriptor cannot express are recorded as text and their allocations are
 *    typed in by hand. Those rows carry `isStaffEntered` and are badged, and
 *    the page leads with a sentence saying so.
 *
 * 3. TREAT A FAILED READ AS AN EMPTY FUND. Every read is registered with
 *    `ReadFailureLog` and every section is `{ ok } | { sentence }`. "This
 *    measure has received nothing" is an urgent, actionable fact and a dropped
 *    column must never wear it — least of all in front of a reader who has no
 *    way to check.
 *
 * 4. ANSWER A COMPLIANCE VERDICT IT DOES NOT HAVE. Where either side of a
 *    local-spending commitment is missing, the page says so. There is no
 *    "compliant" badge anywhere on this surface and no stored verdict for one
 *    to disagree with.
 *
 * ============================================================================
 * WHOSE WORDS THESE ARE
 * ============================================================================
 *
 * Every heading and every standing sentence comes from `MEASURE_OVERSIGHT_COPY`
 * and is written for a resident: "Where the money came from", "What the
 * ordinance says it must pay for", "Who asked for it and what they got". No
 * "off-the-top", no "apportionment basis", no "sub-recipient", no "maintenance
 * of effort", and no instruction addressed to agency staff — nobody reading
 * this page can act on one.
 */

export const metadata = {
  title: "Where the money goes · Local measure oversight",
  description:
    "A public, read-only record of a voter-approved local measure: what the fund has received, what the ordinance says it must pay for, and who has claimed against it.",
  // The share token IS the authorization. See the `/plan` page, which learned
  // this the same way.
  robots: { index: false, follow: false },
};

function recipientKindLabel(value: string | null | undefined): string {
  return MEASURE_RECIPIENT_KINDS.find((kind) => kind.value === value)?.label ?? "";
}

/* ------------------------------------------------------------------ *
 * The only way a number reaches this page
 * ------------------------------------------------------------------ */

/**
 * A headline amount and the sentence it may not appear without.
 *
 * Deliberately the ONLY renderer of a money figure on this surface. A second
 * one — even a small "just this once" span — is how the coverage sentence
 * becomes optional again, so the test asserts the sentence for every figure the
 * real page produces rather than for this component in isolation.
 */
function Figure({ heading, figure }: { heading: string; figure: OversightFigure }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{heading}</h3>
      <p className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{figure.amountText}</span>
        {figure.isFloor ? (
          <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[0.7rem] font-medium text-amber-700 dark:text-amber-300">
            At least this much
          </span>
        ) : null}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{figure.coverageSentence}</p>
    </div>
  );
}

/** A section whose read failed says so where the content would have been. */
function Unavailable({ heading, sentence }: { heading: string; sentence: string }) {
  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-900/80 dark:text-amber-200/80">
        {heading}
      </h3>
      <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">{sentence}</p>
    </div>
  );
}

function FigureSection({
  heading,
  section,
}: {
  heading: string;
  section: OversightSection<OversightFigure>;
}) {
  return section.ok ? (
    <Figure heading={heading} figure={section.value} />
  ) : (
    <Unavailable heading={heading} sentence={section.sentence} />
  );
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

export default async function PublicMeasureOversightPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  if (!shareToken || shareToken.length < 8) {
    notFound();
  }

  const supabase = createServiceRoleClient();

  // A read that failed may not be rendered as an answer. The reader here is a
  // member of the public with no way to tell an empty fund from a broken query.
  const reads = new ReadFailureLog();

  const fundResult = await supabase
    .from("measure_funds")
    // NOT `MEASURE_FUND_COLUMNS`: the token is a credential and there is no
    // reason for it to travel into a public render, so this surface names the
    // narrower list it actually shows. Every other read on the page uses the
    // shared projection constants.
    .select(
      "id, workspace_id, program_id, ordinance_reference, rate_label, adopted_on, sunset_posture, sunset_on, receipt_cadence, currency_code"
    )
    .eq("public_share_token", shareToken)
    .eq("public_share_enabled", true)
    .maybeSingle();

  // "This record does not exist" and "this record could not be read" are
  // DIFFERENT FACTS. A wrong, revoked or switched-off token is a genuine
  // absence and still 404s. A failed read tells us nothing about whether the
  // measure exists, so it may not borrow that page: answering 404 over a
  // dropped column would tell a resident their county's published oversight
  // record is gone.
  if (reads.check("this measure", fundResult)) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {MEASURE_OVERSIGHT_COPY.pageEyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
            This record could not be loaded
          </h1>
        </header>
        {/*
          The database's own message is deliberately NOT rendered — that is
          operator detail and this page is public. What a resident needs is the
          fact that the page failed, stated so it cannot be mistaken for the
          record being withdrawn or the fund being empty.
        */}
        <section
          role="status"
          className="mt-6 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
            Something went wrong loading this measure&rsquo;s record, so none of it is shown. This is a
            problem loading the page — it does not mean the record is missing, unpublished, or that the
            fund has received nothing.
          </p>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
            Please try again shortly, or contact the agency that published this link.
          </p>
        </section>
      </main>
    );
  }

  const fund = fundResult.data as
    | {
        id: string;
        workspace_id: string;
        program_id: string;
        ordinance_reference: string | null;
        rate_label: string | null;
        adopted_on: string | null;
        sunset_posture: string;
        sunset_on: string | null;
        currency_code: string;
      }
    | null;
  if (!fund) {
    notFound();
  }

  const [
    programResult,
    periodsResult,
    recipientsResult,
    rulesResult,
    allocationsResult,
    takesResult,
    claimsResult,
    moeResult,
  ] = await Promise.all([
      supabase.from("programs").select("id, title, summary").eq("id", fund.program_id).maybeSingle(),
      supabase
        .from("measure_fund_periods")
        .select(MEASURE_FUND_PERIOD_COLUMNS)
        .eq("measure_fund_id", fund.id)
        .order("period_start", { ascending: true }),
      supabase.from("measure_recipients").select(MEASURE_RECIPIENT_COLUMNS).eq("measure_fund_id", fund.id),
      supabase.from("measure_allocation_rules").select(MEASURE_ALLOCATION_RULE_COLUMNS).eq("measure_fund_id", fund.id),
      supabase.from("measure_allocations").select(MEASURE_ALLOCATION_COLUMNS).eq("measure_fund_id", fund.id),
      // WHAT THE ORDINANCE TOOK BEFORE THE CATEGORIES WERE CUT. Without this
      // row set the page showed what came in and what the purposes received and
      // nothing about the amount in between, so the obvious subtraction did not
      // come out — see `MEASURE_OVERSIGHT_COPY.divisionExplainer`.
      supabase.from("measure_period_off_the_top").select(MEASURE_OFF_THE_TOP_COLUMNS).eq("measure_fund_id", fund.id),
      supabase.from("measure_claims").select(MEASURE_CLAIM_COLUMNS).eq("measure_fund_id", fund.id),
      supabase.from("measure_moe_records").select(MEASURE_MOE_COLUMNS).eq("measure_fund_id", fund.id),
    ]);

  // The measure's own name. Checked like everything else: a failed read here
  // would fall back to "This measure", which reads as an agency that never
  // named its own ordinance rather than as a page that could not load.
  reads.check("the measure's name", programResult);
  reads.check("what the measure has received", periodsResult);
  reads.check("the cities and districts it pays", recipientsResult);
  reads.check("what the ordinance says", rulesResult);
  reads.check("what has been set aside", allocationsResult);
  reads.check("what the ordinance took out first", takesResult);
  reads.check("the claims made against it", claimsResult);
  reads.check("the local-spending commitments", moeResult);

  const program = programResult.data as { title: string; summary: string | null } | null;

  const receiptResult = buildMeasureReceiptLedger({
    periodRead: toMeasureFundPeriodRead(periodsResult as unknown as Parameters<typeof toMeasureFundPeriodRead>[0]),
  });
  /*
   * ============================================================================
   * `?? []` IS AN ANSWER, AND THESE THREE READS MAY NOT GIVE ONE
   * ============================================================================
   *
   * Each of these used to be `result.data ?? []`, which turned a failed query
   * into a sentence about the agency:
   *
   *   allocations -> every ordinance heading printed "Nothing set aside on the
   *                  record"
   *   moe         -> "No local-spending commitments have been recorded"
   *   recipients  -> every row named "An area the agency has not named"
   *
   * Meanwhile the banner above told the reader that sections which failed to
   * load are "shown as unavailable rather than as zero". The page was
   * contradicting itself, and the half a resident could see was the false half.
   *
   * The reads are still passed through the ledgers on the failure path, because
   * the claim ledger's OTHER inputs may have loaded fine and its own figures are
   * still worth showing. What changes is that the model is told which sections
   * are unavailable, and prints that instead of an amount.
   */
  const allocationsUnavailableSentence = allocationsResult.error
    ? "What has been set aside under each heading could not be loaded, so those amounts are not shown. " +
      "That is a problem loading the page — it does not mean nothing has been set aside."
    : null;
  const moeUnavailableSentence = moeResult.error
    ? "The record of what each area promised to keep spending could not be loaded, so it is not shown " +
      "here. That is a problem loading the page — it does not mean no area promised anything."
    : null;
  const recipientsUnavailableSentence = recipientsResult.error
    ? "The list of cities and districts this measure pays could not be loaded, so who asked for what " +
      "cannot be shown. That is a problem loading the page — it does not mean nobody has asked."
    : null;

  const claimResult = buildMeasureClaimLedger({
    claimRead: toMeasureClaimRead(claimsResult as unknown as Parameters<typeof toMeasureClaimRead>[0]),
    allocations: (allocationsResult.data as never) ?? [],
    periods: (periodsResult.data as never) ?? [],
  });
  const moeSummary = buildMeasureMoeSummary({ records: (moeResult.data as never) ?? [] });

  const ruleRows = ((rulesResult.data as Array<{ id: string; rule: unknown; effective_from: string }> | null) ?? []);
  const lastPeriodStart = receiptResult.ok
    ? receiptResult.ledger.lines[receiptResult.ledger.lines.length - 1]?.periodStart ?? null
    : null;
  const inForce = lastPeriodStart ? resolveAllocationRuleInForce(ruleRows, lastPeriodStart) : null;
  let rule: MeasureAllocationRule | null = null;
  let ruleUnavailableSentence: string | null = rulesResult.error
    ? "What the ordinance says about dividing this money could not be loaded, so it is not shown here. That is a problem loading the page, not an ordinance that says nothing."
    : null;
  if (!ruleUnavailableSentence && inForce) {
    try {
      rule = parseMeasureAllocationRule(inForce.rule);
    } catch {
      ruleUnavailableSentence =
        "The recorded version of the ordinance's split could not be read, so it is not shown here.";
    }
  }

  const model: MeasureOversightModel = buildMeasureOversightModel({
    programTitle: program?.title ?? "This measure",
    currencyCode: fund.currency_code || "USD",
    rateLabel: fund.rate_label,
    ordinanceReference: fund.ordinance_reference,
    adoptedOn: fund.adopted_on,
    sunsetOn: fund.sunset_on,
    sunsetPosture: fund.sunset_posture,
    receiptResult,
    claimResult,
    moeSummary,
    rule,
    ruleUnavailableSentence,
    allocationsUnavailableSentence,
    moeUnavailableSentence,
    recipientsUnavailableSentence,
    /*
     * THE READ ITSELF, not `.data ?? []`. The section that closes this page's
     * arithmetic is the last place a failed query may arrive as an empty set:
     * "nothing was taken out" and "we could not find out what was taken out"
     * differ by the whole amount, and only one of them is a fact about the
     * agency. The allocations go with it because which periods have been
     * divided up at all is what the three figures span.
     */
    offTheTopRead: toMeasureOffTheTopTakeRead(
      takesResult as unknown as Parameters<typeof toMeasureOffTheTopTakeRead>[0]
    ),
    allocations: (allocationsResult.data as never) ?? [],
    // Null: this page spans the fund's whole history. The annual statement,
    // which scopes every read to one year, passes the year.
    fiscalYearLabel: null,
    recipients: ((recipientsResult.data as Array<{ id: string; name: string; recipient_kind: string }> | null) ?? []).map(
      (recipient) => ({
        id: recipient.id,
        name: recipient.name,
        kindLabel: recipientKindLabel(recipient.recipient_kind),
      })
    ),
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {MEASURE_OVERSIGHT_COPY.pageEyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{model.title}</h1>
        {model.subtitleParts.length > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{model.subtitleParts.join(" · ")}</p>
        ) : null}
        {program?.summary ? <p className="mt-3 text-sm text-foreground/90">{program.summary}</p> : null}
        <p className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {MEASURE_OVERSIGHT_COPY.preparedNote}
        </p>
      </header>

      {reads.any ? (
        <section
          role="status"
          className="mt-6 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
            {MEASURE_OVERSIGHT_COPY.readFailureNote}
          </p>
        </section>
      ) : null}

      {model.hasStaffEnteredAmounts ? (
        <section className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">{MEASURE_OVERSIGHT_COPY.staffEnteredNote}</p>
        </section>
      ) : null}

      {/* ---- Where the money came from ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{MEASURE_OVERSIGHT_COPY.receiptsHeading}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {model.receipts.ok ? (
            <Figure heading="Received so far" figure={model.receipts.value.total} />
          ) : (
            <Unavailable heading="Received so far" sentence={model.receipts.sentence} />
          )}
          <FigureSection heading="Asked for by cities and districts" section={model.askedFor} />
          <FigureSection heading="Paid out of the fund" section={model.paidOut} />
        </div>

        {model.receipts.ok ? (
          <div className="mt-4 overflow-x-auto">
            <h3 className="text-sm font-medium text-foreground">{MEASURE_OVERSIGHT_COPY.periodsHeading}</h3>
            <table className="mt-2 w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Period</th>
                  <th className="py-2 pr-3 font-medium">Covering</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount received</th>
                  <th className="py-2 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {model.receipts.value.periods.map((period) => (
                  <tr key={`${period.periodLabel}-${period.fiscalYearLabel}`} className="border-b border-border/60">
                    <td className="py-2 pr-3">{period.periodLabel}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{period.spanText ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {/* NEVER a dash and never a zero: an unreported amount is
                          not zero, and a blank cell reads as one. */}
                      {period.receivedText ?? (
                        <span className="text-muted-foreground">Not reported yet</span>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">{period.receivedOnText ?? "—"}</td>
                  </tr>
                ))}
                {model.receipts.value.periods.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-muted-foreground">
                      No reporting period has been opened for this measure yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* ---- What was taken out before the rest was divided ----

           BETWEEN the receipts and the ordinance's purposes, because that is
           where the money is: a reader who has just seen what came in reaches
           the amount that never made it to a purpose before they reach the
           purposes. Placed anywhere after the category table, the subtraction
           still fails on first read. */}
      {model.division ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">{MEASURE_OVERSIGHT_COPY.divisionHeading}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{MEASURE_OVERSIGHT_COPY.divisionExplainer}</p>
          {!model.division.ok ? (
            <div className="mt-3">
              <Unavailable heading="What was taken out first" sentence={model.division.sentence} />
            </div>
          ) : model.division.value.kind === "none" ? (
            <p className="mt-3 text-sm text-muted-foreground">{model.division.value.sentence}</p>
          ) : (
            <>
              {/* THE CHAIN, in the order the arithmetic runs. Three figures
                  rather than a total and a footnote: the middle one is the
                  amount that was missing from this page, and a reader has to be
                  able to see it as a number of its own. */}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Figure
                  heading={MEASURE_OVERSIGHT_COPY.divisionReceivedHeading}
                  figure={model.division.value.received}
                />
                <Figure
                  heading={MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading}
                  figure={model.division.value.takenOut}
                />
                <Figure
                  heading={MEASURE_OVERSIGHT_COPY.divisionLeftHeading}
                  figure={model.division.value.leftToDivide}
                />
              </div>

              {model.division.value.noClausesSentence ? (
                <p className="mt-4 text-sm text-muted-foreground">{model.division.value.noClausesSentence}</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">{MEASURE_OVERSIGHT_COPY.divisionClauseColumn}</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          {MEASURE_OVERSIGHT_COPY.divisionAmountColumn}
                        </th>
                        <th className="py-2 font-medium">{MEASURE_OVERSIGHT_COPY.divisionNoteColumn}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.division.value.clauses.map((clause) => (
                        <tr key={clause.offTheTopId} className="border-b border-border/60">
                          <td className="py-2 pr-3">{clause.label}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{clause.amountText}</td>
                          <td className="py-2 text-muted-foreground">{clause.noteSentence ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* THE SENTENCE THAT CLOSES IT, or says by how much it does not. */}
              <p className="mt-3 text-sm text-muted-foreground">{model.division.value.settlementSentence}</p>
            </>
          )}
        </section>
      ) : null}

      {/* ---- What the ordinance says it must pay for ---- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">{MEASURE_OVERSIGHT_COPY.ordinanceHeading}</h2>
        {model.ordinance.kind === "unavailable" ? (
          <p className="mt-2 text-sm text-muted-foreground">{model.ordinance.sentence}</p>
        ) : model.ordinance.kind === "narrative" ? (
          <div className="mt-3 rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              The ordinance&rsquo;s split is recorded as text rather than as a formula, so the amounts on this
              page were worked out by agency staff and are marked where they appear.
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{model.ordinance.text}</p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            {/* A column of unexplained amber is worse than no column. */}
            {model.ordinance.setAsideUnavailableSentence ? (
              <p className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm text-amber-900/90 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200/90">
                {model.ordinance.setAsideUnavailableSentence}
              </p>
            ) : null}
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Purpose</th>
                  <th className="py-2 pr-3 font-medium">Share</th>
                  <th className="py-2 pr-3 text-right font-medium">Set aside</th>
                  <th className="py-2 text-right font-medium">Claimed against it</th>
                </tr>
              </thead>
              <tbody>
                {model.ordinance.rows.map((row) => (
                  <tr key={row.categoryId} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      {row.label}
                      {row.isStaffEntered ? (
                        <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
                          {MEASURE_OVERSIGHT_COPY.staffEnteredBadge}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.shareText ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {/* THREE STATES, and the first two are not the same fact.
                          "Could not be loaded" is the page failing; "Nothing set
                          aside" is the agency's record. */}
                      {row.setAsideUnavailable ? (
                        <span className="text-amber-700 dark:text-amber-300">Could not be loaded</span>
                      ) : (
                        row.setAsideText ?? (
                          <span className="text-muted-foreground">Nothing set aside on the record</span>
                        )
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{row.claimedText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Who asked for it and what they got ---- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">{MEASURE_OVERSIGHT_COPY.recipientsHeading}</h2>
        {model.recipients.ok ? (
          model.recipients.value.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No city, district or other body has filed a claim against this measure yet.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Who</th>
                    <th className="py-2 pr-3 text-right font-medium">Asked for</th>
                    <th className="py-2 pr-3 text-right font-medium">Paid</th>
                    <th className="py-2 font-medium">Still waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {model.recipients.value.map((row) => (
                    <tr key={row.recipientId} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-foreground">{row.name}</span>
                        {row.kindLabel ? (
                          <span className="block text-xs text-muted-foreground">{row.kindLabel}</span>
                        ) : null}
                        {row.yearsText ? (
                          <span className="block text-xs text-muted-foreground">Years: {row.yearsText}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.askedForText}
                        <span className="block text-xs text-muted-foreground">
                          {row.askedForCount} {row.askedForCount === 1 ? "claim" : "claims"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.paidText}
                        <span className="block text-xs text-muted-foreground">{row.paidCount} paid</span>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {row.awaitingDecisionCount > 0
                          ? `${row.awaitingDecisionCount} waiting on a decision`
                          : "Nothing outstanding"}
                        {row.notCountedCount > 0 ? (
                          <span className="block text-xs">
                            {row.notCountedCount} not counted (being prepared, turned down or withdrawn)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Unavailable heading="Who asked for it" sentence={model.recipients.sentence} />
        )}
      </section>

      {/* ---- What each area promised to keep spending ---- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">{MEASURE_OVERSIGHT_COPY.moeHeading}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{MEASURE_OVERSIGHT_COPY.moeExplainer}</p>
        {model.moe.unavailableSentence ? (
          <div className="mt-3">
            <Unavailable
              heading="What each area promised"
              sentence={model.moe.unavailableSentence}
            />
          </div>
        ) : model.moe.rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{model.moe.summarySentence}</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Who</th>
                    <th className="py-2 pr-3 font-medium">Year</th>
                    <th className="py-2 pr-3 text-right font-medium">Required</th>
                    <th className="py-2 pr-3 text-right font-medium">Spent</th>
                    <th className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {model.moe.rows.map((row, index) => (
                    <tr key={`${row.recipientName}-${row.fiscalYearLabel}-${index}`} className="border-b border-border/60">
                      <td className="py-2 pr-3">{row.recipientName}</td>
                      <td className="py-2 pr-3">{row.fiscalYearLabel}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.requiredText ?? <span className="text-muted-foreground">Not recorded</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.reportedText ?? <span className="text-muted-foreground">Not recorded</span>}
                      </td>
                      <td className="py-2">
                        {row.notDeterminedSentence ? (
                          <span className="text-muted-foreground">
                            {MEASURE_OVERSIGHT_COPY.notDeterminedLabel} — {row.notDeterminedSentence}
                          </span>
                        ) : row.isShortfall ? (
                          <span>Spent {row.differenceText} less than required</span>
                        ) : (
                          <span>Spent {row.differenceText} more than required</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{model.moe.summarySentence}</p>
          </>
        )}
      </section>
    </main>
  );
}
