import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { BasisValueEditor } from "@/components/measures/basis-value-editor";
import { ClaimComposer } from "@/components/measures/claim-composer";
import { ClaimDecisionControls } from "@/components/measures/claim-decision-controls";
import { MeasureFundPanel } from "@/components/measures/measure-fund-panel";
import { MeasureFundSetup } from "@/components/measures/measure-fund-setup";
import { MeasurePublicShareControl } from "@/components/measures/measure-public-share-control";
import { MoeEditor } from "@/components/measures/moe-editor";
import { RecipientComposer } from "@/components/measures/recipient-composer";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { formatMoney } from "@/lib/money/format";
import {
  isNarrativeRule,
  measureCategoriesNeedingBasisVintage,
  parseMeasureAllocationRule,
  type MeasureAllocationRule,
} from "@/lib/measures/allocation";
import {
  buildMeasureClaimLedger,
  buildMeasureMoeSummary,
  resolveMeasureClaimCategories,
  toMeasureClaimRead,
  MEASURE_CLAIM_COLUMNS,
  MEASURE_CLAIM_DOCUMENT_COLUMNS,
  MEASURE_MOE_COLUMNS,
} from "@/lib/measures/claims";
import {
  MEASURE_ALLOCATION_COLUMNS,
  MEASURE_ALLOCATION_RULE_COLUMNS,
  MEASURE_FUND_COLUMNS,
  MEASURE_FUND_PERIOD_COLUMNS,
  MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS,
  MEASURE_RECIPIENT_COLUMNS,
  resolveAllocationRuleInForce,
} from "@/lib/measures/fund";
import { buildMeasureReceiptLedger, toMeasureFundPeriodRead } from "@/lib/measures/receipts";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

/**
 * THE MEASURE FUND, in the workspace.
 *
 * A child of the program record, because the measure IS a program record
 * (product non-negotiable #2). The `local_measure` program type has existed
 * since 20260315000022; everything this page shows hangs off it.
 *
 * ============================================================================
 * WHAT THIS PAGE MAY NOT DO
 * ============================================================================
 *
 * 1. PRINT A TOTAL WITHOUT ITS COVERAGE. The receipt total is a floor whenever
 *    a period is unreported, and the panel renders the figure and the sentence
 *    in one block for that reason.
 * 2. SHOW A HAND-ENTERED ALLOCATION AS A COMPUTED ONE. `computation_basis`
 *    travels with every allocation and the ledger reports
 *    `hasManualAllocation`; the banner below says so in words.
 * 3. TREAT A FAILED READ AS AN EMPTY FUND. Every read is registered with
 *    `ReadFailureLog` and disclosed by name. "This measure has received $0" is
 *    an urgent, actionable fact and a database error must never wear it.
 *
 * ============================================================================
 * TWO ROLE GATES, MATCHING THE ROUTES
 * ============================================================================
 *
 * `canWrite` (programs.write) shows the clerical controls. `canDecide`
 * (invoices.write, owner/admin) shows the buttons that approve, deny or pay —
 * the same split the routes enforce, so a member never sees a control that
 * would 403. The gate is the server's; this only avoids offering the door.
 */

type PageProps = { params: Promise<{ programId: string }> };

export default async function MeasureFundPage({ params }: PageProps) {
  const { programId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const reads = new ReadFailureLog();

  const membershipResult = await loadCurrentWorkspaceMembership(supabase, user.id);
  const membership = membershipResult.membership;
  if (!membership) notFound();
  const canWrite = canAccessWorkspaceAction("programs.write", membership.role);
  const canDecide = canAccessWorkspaceAction("invoices.write", membership.role);

  const programResult = await supabase
    .from("programs")
    .select("id, workspace_id, title, program_type, summary")
    .eq("id", programId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // The one load-bearing read: `notFound()` says this program does not exist,
  // and a policy failure is not evidence of that.
  if (programResult.error) {
    throw new Error(`Could not read this program: ${programResult.error.message}`);
  }
  const program = programResult.data as
    | { id: string; workspace_id: string; title: string; program_type: string | null }
    | null;
  if (!program) notFound();

  if (program.program_type !== "local_measure") {
    return (
      <div className="space-y-6 p-6">
        <Link href={`/programs/${programId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to the program
        </Link>
        <StateBlock
          tone="warning"
          title="This program is not a local measure"
          description="A measure fund records a voter-approved tax, what it receives, how the ordinance splits it, and the claims cities and districts make against it. Change this program's type to Local measure to set one up."
        />
      </div>
    );
  }

  const fundResult = await supabase
    .from("measure_funds")
    .select(MEASURE_FUND_COLUMNS)
    .eq("program_id", program.id)
    .maybeSingle();
  const fundUnreadable = reads.check("the measure fund", fundResult);
  const fund = fundResult.data as
    | {
        id: string;
        currency_code: string;
        rate_label: string | null;
        ordinance_reference: string | null;
        // The oversight lane's two columns. Already in MEASURE_FUND_COLUMNS —
        // named here so the share control can be handed its initial state.
        public_share_enabled: boolean | null;
        public_share_token: string | null;
      }
    | null;

  if (fundUnreadable) {
    return (
      <div className="space-y-6 p-6">
        <StateBlock
          tone="danger"
          title="The measure fund could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      </div>
    );
  }

  if (!fund) {
    return (
      <div className="space-y-6 p-6">
        <Link href={`/programs/${programId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to {program.title}
        </Link>
        {canWrite ? (
          <MeasureFundSetup programId={program.id} measureId={null} />
        ) : (
          <StateBlock
            tone="info"
            title="No measure fund is set up yet"
            description="Someone with edit access needs to record the ordinance behind this program before the fund can track receipts and claims."
          />
        )}
      </div>
    );
  }

  const currencyCode = fund.currency_code || "USD";

  const [periodsResult, recipientsResult, rulesResult, allocationsResult, claimsResult, moeResult] = await Promise.all([
    supabase
      .from("measure_fund_periods")
      .select(MEASURE_FUND_PERIOD_COLUMNS)
      .eq("measure_fund_id", fund.id)
      .order("period_start", { ascending: true }),
    supabase.from("measure_recipients").select(MEASURE_RECIPIENT_COLUMNS).eq("measure_fund_id", fund.id).order("name"),
    supabase.from("measure_allocation_rules").select(MEASURE_ALLOCATION_RULE_COLUMNS).eq("measure_fund_id", fund.id),
    supabase.from("measure_allocations").select(MEASURE_ALLOCATION_COLUMNS).eq("measure_fund_id", fund.id),
    supabase
      .from("measure_claims")
      .select(MEASURE_CLAIM_COLUMNS)
      .eq("measure_fund_id", fund.id)
      .order("submitted_on", { ascending: false, nullsFirst: false }),
    supabase.from("measure_moe_records").select(MEASURE_MOE_COLUMNS).eq("measure_fund_id", fund.id),
  ]);

  reads.check("the fund's periods", periodsResult);
  reads.check("the recipients", recipientsResult);
  reads.check("the ordinance rule versions", rulesResult);
  reads.check("the recorded allocations", allocationsResult);
  reads.check("the claims", claimsResult);
  reads.check("the maintenance-of-effort records", moeResult);

  const recipients = ((recipientsResult.data as Array<{
    id: string;
    name: string;
    recipient_kind: string;
    external_reference: string | null;
    is_active: boolean;
    inactive_note: string | null;
  }> | null) ?? []);

  const basisValuesResult = recipients.length
    ? await supabase
        .from("measure_recipient_basis_values")
        .select(MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS)
        .in("recipient_id", recipients.map((recipient) => recipient.id))
    : { data: [], error: null };
  reads.check("the apportionment figures", basisValuesResult);

  const periods = ((periodsResult.data as Array<{
    id: string;
    period_label: string;
    fiscal_year_label: string;
    period_start: string;
    period_end: string;
  }> | null) ?? []);

  const claimIds = ((claimsResult.data as Array<{ id: string }> | null) ?? []).map((claim) => claim.id);
  const [claimDocumentsResult, attachableDocumentsResult] = await Promise.all([
    claimIds.length
      ? supabase.from("measure_claim_documents").select(MEASURE_CLAIM_DOCUMENT_COLUMNS).in("claim_id", claimIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("kb_documents")
      .select("id, title")
      .eq("workspace_id", membership.workspace_id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  reads.check("the claims' backup documents", claimDocumentsResult);
  reads.check("the workspace's documents", attachableDocumentsResult);

  /* THE LEDGERS — pure, and handed rows the page has already read. */
  const receiptLedgerResult = buildMeasureReceiptLedger({ periodRead: toMeasureFundPeriodRead(periodsResult as unknown as Parameters<typeof toMeasureFundPeriodRead>[0]) });
  const claimLedgerResult = buildMeasureClaimLedger({
    claimRead: toMeasureClaimRead(claimsResult as unknown as Parameters<typeof toMeasureClaimRead>[0]),
    allocations: (allocationsResult.data as never) ?? [],
    periods: (periodsResult.data as never) ?? [],
  });
  const moeSummary = buildMeasureMoeSummary({ records: (moeResult.data as never) ?? [] });

  /* WHAT THE ORDINANCE DECLARES — resolved from the rule in force at the LATEST
     period, which is the one a new claim will most often be filed against. */
  const ruleRows = ((rulesResult.data as Array<{ id: string; rule: unknown; effective_from: string }> | null) ?? []);
  const latestPeriodStart = periods.length ? periods[periods.length - 1].period_start : null;
  const inForce = latestPeriodStart ? resolveAllocationRuleInForce(ruleRows, latestPeriodStart) : null;
  let rule: MeasureAllocationRule | null = null;
  let ruleUnreadableMessage: string | null = null;
  if (inForce) {
    try {
      rule = parseMeasureAllocationRule(inForce.rule);
    } catch (error) {
      ruleUnreadableMessage = error instanceof Error ? error.message : "The recorded rule could not be read.";
    }
  }

  const allocationRows = ((allocationsResult.data as Array<{ category_id: string }> | null) ?? []);
  const categoryResolution = resolveMeasureClaimCategories({
    rule,
    recordedAllocationCategoryIds: allocationRows.map((row) => row.category_id),
  });

  const recipientNameById = new Map(recipients.map((recipient) => [recipient.id, recipient.name]));
  const documentsByClaim = new Map<string, Array<{ id: string; kbDocumentId: string; title: string; documentRole: string }>>();
  const documentTitleById = new Map(
    ((attachableDocumentsResult.data as Array<{ id: string; title: string }> | null) ?? []).map((row) => [
      row.id,
      row.title,
    ])
  );
  for (const link of ((claimDocumentsResult.data as Array<{
    id: string;
    claim_id: string;
    kb_document_id: string;
    document_role: string;
  }> | null) ?? [])) {
    const list = documentsByClaim.get(link.claim_id) ?? [];
    list.push({
      id: link.id,
      kbDocumentId: link.kb_document_id,
      title: documentTitleById.get(link.kb_document_id) ?? "Attached document",
      documentRole: link.document_role,
    });
    documentsByClaim.set(link.claim_id, list);
  }

  const allocationRowCountByPeriod = new Map<string, number>();
  for (const allocation of ((allocationsResult.data as Array<{ period_id: string }> | null) ?? [])) {
    allocationRowCountByPeriod.set(allocation.period_id, (allocationRowCountByPeriod.get(allocation.period_id) ?? 0) + 1);
  }

  // The claim ledger is what a recipient is paid against and what an auditor
  // reconciles, so it is written to the cent, in the measure's declared
  // currency — never the browser's locale.
  const money = (value: number) => formatMoney(value, { precision: "cents", currency: currencyCode });

  return (
    <div className="space-y-6 p-6">
      <Link href={`/programs/${programId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to {program.title}
      </Link>

      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this page could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      <header>
        <h1 className="text-xl font-semibold">{program.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fund.rate_label ? `${fund.rate_label} · ` : ""}
          {fund.ordinance_reference ?? "No ordinance reference recorded"} · {currencyCode}
        </p>
      </header>

      {ruleUnreadableMessage ? (
        <StateBlock
          tone="warning"
          title="The recorded ordinance rule could not be read"
          description={`${ruleUnreadableMessage} Allocations already computed are unaffected; record a corrected rule version before allocating another period.`}
        />
      ) : null}

      {rule && isNarrativeRule(rule) ? (
        <StateBlock
          tone="info"
          title="This ordinance is recorded as text"
          description="Its split cannot be expressed as a rule, so allocations for this measure are entered by hand and are labelled staff-entered wherever they appear."
        />
      ) : null}

      {receiptLedgerResult.ok ? (
        <MeasureFundPanel
          measureId={fund.id}
          currencyCode={currencyCode}
          ledger={receiptLedgerResult.ledger}
          canWrite={canWrite}
          /*
           * WHICH CATEGORIES CANNOT BE DIVIDED WITHOUT A STATED VINTAGE.
           *
           * From the shared `measureCategoriesNeedingBasisVintage`, never from
           * a second reading of the rule here: the allocate route refuses on
           * exactly this list, and a panel that disagreed with it would either
           * offer a button that 409s or block one that would have worked.
           */
          vintageDependentCategoryLabels={
            rule ? measureCategoriesNeedingBasisVintage(rule).map((category) => category.label) : []
          }
          periods={receiptLedgerResult.ledger.lines.map((line) => ({
            id: line.periodId ?? "",
            periodLabel: line.periodLabel,
            fiscalYearLabel: line.fiscalYearLabel,
            periodStart: line.periodStart,
            periodEnd: line.periodEnd,
            receivedAmount: line.receivedAmount,
            forecastAmount: line.forecastAmount,
            varianceAmount: line.varianceAmount,
            allocationRowCount: allocationRowCountByPeriod.get(line.periodId ?? "") ?? 0,
          }))}
        />
      ) : (
        <StateBlock
          tone="danger"
          title="The fund's receipts could not be read"
          description={`${receiptLedgerResult.message} This is a read failure, not an empty fund.`}
        />
      )}

      <RecipientComposer
        measureId={fund.id}
        canWrite={canWrite}
        recipients={recipients.map((recipient) => ({
          id: recipient.id,
          name: recipient.name,
          recipientKind: recipient.recipient_kind,
          externalReference: recipient.external_reference,
          isActive: recipient.is_active,
          inactiveNote: recipient.inactive_note,
        }))}
      />

      <BasisValueEditor
        measureId={fund.id}
        canWrite={canWrite}
        recipients={recipients.map((recipient) => ({
          id: recipient.id,
          name: recipient.name,
          isActive: recipient.is_active,
        }))}
        /*
         * STRAIGHT FROM THE RECORDED RULE, `vintageInForce` and all.
         *
         * This used to hand the editor `basisValues[0]?.vintage_label` — the
         * first row of an UNORDERED query — as "the vintage in force". Which
         * edition of a population figure governs a jurisdiction's share of a
         * public fund is a legal fact from the ordinance, and it was being
         * decided by the order Postgres returned rows in. When the ordinance
         * reading records no vintage the editor now says "not recorded"; it is
         * not this page's place to supply one.
         */
        basisDefinitions={rule && !isNarrativeRule(rule) ? rule.basisDefinitions : []}
        basisValues={((basisValuesResult.data as Array<{
          id: string;
          recipient_id: string;
          basis_id: string;
          vintage_label: string;
          basis_value: number | string;
          basis_source_note: string;
          stated_on: string | null;
        }> | null) ?? []).map((value) => ({
          id: value.id,
          recipientId: value.recipient_id,
          basisId: value.basis_id,
          vintageLabel: value.vintage_label,
          basisValue: Number(value.basis_value),
          basisSourceNote: value.basis_source_note,
          statedOn: value.stated_on,
        }))}
      />

      {claimLedgerResult.ok ? (
        <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
          <h2 className="text-base font-semibold">Claims against the fund</h2>
          <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">Asked for</div>
              <div className="text-lg font-semibold tabular-nums">
                {money(claimLedgerResult.ledger.claimedGrossTotal)}
              </div>
              <div className="text-xs text-muted-foreground">{claimLedgerResult.ledger.claimedCount} claim(s)</div>
            </div>
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">Paid out</div>
              <div className="text-lg font-semibold tabular-nums">{money(claimLedgerResult.ledger.paidNetTotal)}</div>
              <div className="text-xs text-muted-foreground">{claimLedgerResult.ledger.paidCount} paid</div>
            </div>
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">Waiting on us</div>
              <div className="text-lg font-semibold tabular-nums">
                {money(claimLedgerResult.ledger.outstandingNetTotal)}
              </div>
              <div className="text-xs text-muted-foreground">
                {claimLedgerResult.ledger.awaitingDecisionCount} awaiting a decision
              </div>
            </div>
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">Left of what was allocated</div>
              <div className="text-lg font-semibold tabular-nums">
                {claimLedgerResult.ledger.remainingAllocatedTotal === null
                  ? "Not determined"
                  : money(claimLedgerResult.ledger.remainingAllocatedTotal)}
              </div>
              <div className="text-xs text-muted-foreground">
                {claimLedgerResult.ledger.allocatedTotal === null
                  ? "No period has been allocated yet, so there is no ceiling to measure against."
                  : `Of ${money(claimLedgerResult.ledger.allocatedTotal)} allocated`}
              </div>
            </div>
          </div>

          {/* THE FIGURES THAT ARE REPORTED AND FOLDED INTO NO TOTAL. */}
          {claimLedgerResult.ledger.draftCount +
            claimLedgerResult.ledger.deniedCount +
            claimLedgerResult.ledger.withdrawnCount >
          0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Not counted above: {claimLedgerResult.ledger.draftCount} draft(s) worth{" "}
              {money(claimLedgerResult.ledger.draftNetTotal)}, {claimLedgerResult.ledger.deniedCount} denied worth{" "}
              {money(claimLedgerResult.ledger.deniedGrossTotal)}, {claimLedgerResult.ledger.withdrawnCount} withdrawn
              worth {money(claimLedgerResult.ledger.withdrawnGrossTotal)}.
            </p>
          ) : null}

          {claimLedgerResult.ledger.hasManualAllocation ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Some of the allocation figures behind these ceilings were entered by staff rather than computed from
              the ordinance rule.
            </p>
          ) : null}

          {claimLedgerResult.ledger.allocationsWithUnknownPeriodCount > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {claimLedgerResult.ledger.allocationsWithUnknownPeriodCount} allocation line(s) belong to a period this
              page could not read, so the ceiling above is incomplete.
            </p>
          ) : null}

          {claimLedgerResult.ledger.overClaimedBuckets.length > 0 ? (
            <div className="mt-3 rounded-[0.5rem] border border-destructive/50 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">
                {claimLedgerResult.ledger.overClaimedBuckets.length} recipient/category combination(s) have claimed
                more than was allocated to them.
              </p>
              <ul className="mt-1 space-y-1 text-xs">
                {claimLedgerResult.ledger.overClaimedBuckets.map((bucket) => (
                  <li key={`${bucket.recipientId}-${bucket.categoryId}-${bucket.fiscalYearLabel}`}>
                    {recipientNameById.get(bucket.recipientId) ?? bucket.recipientId} · {bucket.categoryId} ·{" "}
                    {bucket.fiscalYearLabel}: over by {money(Math.abs(bucket.remainingAllocated ?? 0))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {claimLedgerResult.ledger.lines.map((line) => (
              <ClaimDecisionControls
                key={line.claimId}
                measureId={fund.id}
                currencyCode={currencyCode}
                canDecide={canDecide}
                canWrite={canWrite}
                attachableDocuments={
                  ((attachableDocumentsResult.data as Array<{ id: string; title: string }> | null) ?? []).map(
                    (document) => ({ id: document.id, title: document.title })
                  )
                }
                claim={{
                  id: line.claimId ?? "",
                  status: line.status,
                  recipientName: recipientNameById.get(line.recipientId ?? "") ?? "Unknown recipient",
                  categoryId: line.categoryId,
                  fiscalYearLabel: line.fiscalYearLabel,
                  grossAmount: line.grossAmount,
                  netAmount: line.netAmount,
                  retentionWithheld: line.retentionWithheld,
                  submittedOn: line.submittedOn,
                  paidOn: line.paidOn,
                  decidedAt: line.decidedAt,
                  decisionNote: null,
                  denialReason: line.hasDenialReason ? "Recorded on the claim" : null,
                  documentCount: (documentsByClaim.get(line.claimId ?? "") ?? []).length,
                  documents: documentsByClaim.get(line.claimId ?? "") ?? [],
                }}
              />
            ))}
            {claimLedgerResult.ledger.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No claims have been filed against this measure yet.</p>
            ) : null}
          </div>

          {claimLedgerResult.ledger.paidWithNoDateCount > 0 ? (
            <StatusBadge tone="danger" className="mt-3">
              {claimLedgerResult.ledger.paidWithNoDateCount} paid claim(s) carry no payment date — the database
              should make that impossible.
            </StatusBadge>
          ) : null}
        </section>
      ) : (
        <StateBlock
          tone="danger"
          title="The claims could not be read"
          description={`${claimLedgerResult.message} This is a read failure, not a fund with no claims.`}
        />
      )}

      <ClaimComposer
        measureId={fund.id}
        canWrite={canWrite}
        currencyCode={currencyCode}
        recipients={recipients.map((recipient) => ({
          id: recipient.id,
          name: recipient.name,
          isActive: recipient.is_active,
        }))}
        periods={periods.map((period) => ({
          id: period.id,
          periodLabel: period.period_label,
          fiscalYearLabel: period.fiscal_year_label,
        }))}
        categories={categoryResolution.ok ? categoryResolution.categories : []}
        categorySource={categoryResolution.ok ? categoryResolution.source : "none"}
      />

      <MoeEditor
        measureId={fund.id}
        canWrite={canWrite}
        currencyCode={currencyCode}
        summary={moeSummary}
        recipients={recipients.map((recipient) => ({ id: recipient.id, name: recipient.name }))}
        fiscalYearLabels={[...new Set(periods.map((period) => period.fiscal_year_label))]}
      />

      {/*
        THE OVERSIGHT RECORD — the only two ways anything about this fund
        leaves the workspace. Rendered for every member, not just writers: a
        viewer needs to be able to see WHETHER the page is published and to open
        the annual statement, and the card hides only the toggle behind
        `canWrite` (the route enforces it either way).
      */}
      <MeasurePublicShareControl
        measureId={fund.id}
        initialEnabled={Boolean(fund.public_share_enabled)}
        initialToken={fund.public_share_token}
        canWrite={canWrite}
        fiscalYearLabels={[...new Set(periods.map((period) => period.fiscal_year_label))].sort().reverse()}
      />

      {canWrite ? <MeasureFundSetup programId={program.id} measureId={fund.id} /> : null}
    </div>
  );
}
