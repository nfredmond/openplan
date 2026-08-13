import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { InvoiceTriageLinkCopy } from "@/components/invoicing/invoice-triage-link-copy";
import { InvoiceFundingAwardLinker } from "@/components/invoicing/invoice-funding-award-linker";
import { InvoiceRecordComposer } from "@/components/invoicing/invoice-record-composer";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildBillingInvoicePriorityQueue,
  filterBillingInvoiceRecordsByLinkage,
  filterBillingInvoiceRecordsByOverdueStatus,
  invoiceNeedsAwardRelink,
  resolveExactBillingInvoiceAwardMatch,
  type BillingInvoiceOverdueFilter,
  type BillingInvoiceLinkageFilter,
  summarizeAwardSubstantiation,
  summarizeBillingInvoiceLinkage,
  summarizeBillingInvoiceRecords,
  type FundingAwardSubstantiationMilestoneLike,
  type FundingAwardSubstantiationSubmittalLike,
  type FundingAwardSubstantiationSummary,
} from "@/lib/invoicing/invoice-records";
import {
  INTERIM_DEFAULT_RATIONALE,
  postureLabel,
  resolveReimbursementProfile,
} from "@/lib/invoicing/reimbursement-profile-binding";
import { reimbursementProfileRegistry } from "@/lib/invoicing/reimbursement-profiles";
import { buildInvoicingHref, buildInvoiceTriageHref } from "@/lib/invoicing/triage-links";
import { resolveWorkspaceCommandHref } from "@/lib/operations/grants-links";
import { loadWorkspaceOperationsSummaryForWorkspace, type WorkspaceOperationsSupabaseLike } from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { parseWorkspaceHomeGeography, resolveJurisdiction } from "@/lib/workspaces/home-geography";
import {
  billingRowNoticeClass,
  billingRowRiskState,
  describeAwardSubstantiation,
  formatCurrency,
  insetClass,
  isInvoiceOverdue,
  looksLikePendingSchema,
  normalizeFocusedInvoiceId,
  normalizeInvoiceLinkageFilter,
  normalizeInvoiceOverdueFilter,
  normalizeJoin,
  normalizeProjectFilterId,
  normalizeRelinkedInvoiceId,
  noticeClass,
  panelClass,
  substantiationReadinessLabel,
  titleCase,
  toneForInvoiceStatus,
  toneForSubstantiationReadiness,
  toneForSupportingDocs,
  type FundingAwardListRow,
  type InvoiceRegisterRow,
} from "./invoicing-page-helpers";
import { ReadFailureNotice } from "@/components/ui/read-failure-notice";

/**
 * The reimbursement direction of the invoicing module: this agency invoicing
 * ITS FUNDERS for grant reimbursement (billing_invoice_records). Extracted
 * mechanically from the invoicing page when the receivables direction landed;
 * behavior is unchanged from the pre-split register body.
 */
export async function ReimbursementLane({
  workspaceId,
  canWriteInvoices,
  resolvedParams,
}: {
  workspaceId: string;
  canWriteInvoices: boolean;
  resolvedParams: Record<string, string | string[] | undefined>;
}) {
  const linkageFilter = normalizeInvoiceLinkageFilter(resolvedParams.linkage);
  const overdueFilter = normalizeInvoiceOverdueFilter(resolvedParams.overdue);
  const requestedProjectFilterId = normalizeProjectFilterId(resolvedParams.projectId);
  const requestedFocusedInvoiceId = normalizeFocusedInvoiceId(resolvedParams.focusInvoiceId);
  const requestedRelinkedInvoiceId = normalizeRelinkedInvoiceId(resolvedParams.relinkedInvoiceId);

  const supabase = await createClient();

  // Which reimbursement profile governs this workspace's register: its own
  // home geography when a registered profile covers it, otherwise the labeled
  // interim default. A failed geography read (columns pending on an older
  // deployment) resolves as "jurisdiction unknown" — a disclosed fallback,
  // never a guess.
  const workspaceGeographyRead = await supabase
    .from("workspaces")
    .select("home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code")
    .eq("id", workspaceId)
    .maybeSingle();

  const reimbursementProfileResolution = resolveReimbursementProfile({
    workspaceJurisdiction: resolveJurisdiction(
      parseWorkspaceHomeGeography(workspaceGeographyRead.error ? null : workspaceGeographyRead.data)
    ),
  });
  const reimbursementProfile =
    reimbursementProfileResolution.kind === "resolved" ? reimbursementProfileResolution.binding : null;

  // Every read below that can fail without a truer classification of its own is
  // registered here, so an outage arrives on screen as an outage. On this lane
  // the alternative is specific and bad: a failed register read renders "No
  // invoice records recorded yet for this workspace" and a $0 outstanding
  // balance — an agency told it is owed nothing by its funder because a query
  // broke. Pending-schema failures are classified FIRST and stay out of this
  // log, because "apply the migration" is a truer thing to say than "could not
  // be read".
  const reads = new ReadFailureLog();

  const workspaceProjectsResult = await supabase
    .from("projects")
    .select("id, name, status, delivery_phase")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  reads.check("this workspace's projects", workspaceProjectsResult);

  const fundingAwardsResult = await supabase
    .from("funding_awards")
    .select("id, project_id, title")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  // caltrans_posture stays selected as the legacy read fallback for rows that
  // predate the reimbursement-profile backfill (20260727000009).
  const invoiceRegisterSelectLegacy =
    "id, project_id, funding_award_id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at, funding_awards(id, title)";
  const invoiceRegisterSelect = invoiceRegisterSelectLegacy.replace(
    "caltrans_posture,",
    "caltrans_posture, reimbursement_profile_id, reimbursement_posture, reimbursement_profile_selection,"
  );

  // Cast to one loose shape: the two select strings would otherwise infer
  // different structural types, and this codebase's Supabase reads are cast
  // deliberately (clients are untyped by convention).
  type InvoiceRegisterQueryResult = { data: unknown[] | null; error: { message?: string } | null };

  let invoiceRecordsResult = (await supabase
    .from("billing_invoice_records")
    .select(invoiceRegisterSelect)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20)) as InvoiceRegisterQueryResult;

  if (invoiceRecordsResult.error && looksLikePendingSchema(invoiceRecordsResult.error.message)) {
    // A database that has the register but not the profile columns yet still
    // gets its register; rows from this path simply carry no profile fields.
    invoiceRecordsResult = (await supabase
      .from("billing_invoice_records")
      .select(invoiceRegisterSelectLegacy)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20)) as InvoiceRegisterQueryResult;
  }

  const invoiceRegisterPending = looksLikePendingSchema(invoiceRecordsResult.error?.message);
  const fundingAwardsPending = looksLikePendingSchema(fundingAwardsResult.error?.message);
  // Classified first, collected second: whatever is left after the pending-schema
  // check is a read that failed for a reason this page cannot name, and the
  // register is the one whose emptiness would be read as money.
  const invoiceRegisterUnreadable =
    !invoiceRegisterPending &&
    reads.check("this workspace's reimbursement invoice register", invoiceRecordsResult);
  if (!fundingAwardsPending) {
    reads.check("this workspace's funding awards", fundingAwardsResult);
  }
  /**
   * Everything derived from the register — the totals, the linkage split, the
   * priority queue, the filter counts — is suppressed under either of these,
   * because each of those numbers is a statement about reimbursement posture
   * that an empty array cannot support.
   */
  const invoiceRegisterUnavailable = invoiceRegisterPending || invoiceRegisterUnreadable;
  const workspaceFundingAwards = fundingAwardsPending ? [] : ((fundingAwardsResult.data ?? []) as FundingAwardListRow[]);
  const invoiceRecords = invoiceRegisterUnavailable
    ? []
    : ((invoiceRecordsResult.data ?? []) as InvoiceRegisterRow[]).map((invoice) => ({
        ...invoice,
        fundingAward: normalizeJoin(invoice.funding_awards),
      }));
  const substantiationAwardIds = workspaceFundingAwards.map((award) => award.id);
  const substantiationAwardProjectIds = Array.from(
    new Set(
      workspaceFundingAwards
        .map((award) => award.project_id)
        .filter((projectId): projectId is string => Boolean(projectId))
    )
  );
  const emptySubstantiationRead = {
    data: [] as Array<Record<string, unknown>>,
    error: null as { message?: string } | null,
  };
  const [awardMilestonesResult, awardSubmittalsResult] = await Promise.all([
    substantiationAwardIds.length > 0
      ? supabase
          .from("project_milestones")
          .select("funding_award_id, milestone_type, status")
          .in("funding_award_id", substantiationAwardIds)
      : Promise.resolve(emptySubstantiationRead),
    substantiationAwardProjectIds.length > 0
      ? supabase
          .from("project_submittals")
          .select("project_id, submitted_at")
          .in("project_id", substantiationAwardProjectIds)
      : Promise.resolve(emptySubstantiationRead),
  ]);
  const awardSubstantiationPending =
    looksLikePendingSchema(awardMilestonesResult.error?.message) ||
    looksLikePendingSchema(awardSubmittalsResult.error?.message);
  if (!awardSubstantiationPending) {
    reads.check("award milestone substantiation", awardMilestonesResult);
    reads.check("award submittal substantiation", awardSubmittalsResult);
  }
  const awardSubstantiationAvailable =
    !awardSubstantiationPending && !awardMilestonesResult.error && !awardSubmittalsResult.error;
  const awardSubstantiation = awardSubstantiationAvailable
    ? summarizeAwardSubstantiation({
        awards: workspaceFundingAwards,
        milestones: (awardMilestonesResult.data ?? []) as FundingAwardSubstantiationMilestoneLike[],
        submittals: (awardSubmittalsResult.data ?? []) as FundingAwardSubstantiationSubmittalLike[],
      })
    : new Map<string, FundingAwardSubstantiationSummary>();
  const invoiceSummary = summarizeBillingInvoiceRecords(invoiceRecords);
  const invoiceLinkageSummary = summarizeBillingInvoiceLinkage(invoiceRecords);
  const workspaceProjects = (workspaceProjectsResult.data ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    delivery_phase: string | null;
  }>;
  const projectNameById = new Map(workspaceProjects.map((project) => [project.id, project.name]));
  const activeProjectFilterId = requestedProjectFilterId && projectNameById.has(requestedProjectFilterId) ? requestedProjectFilterId : null;
  const activeProjectFilterName = activeProjectFilterId ? projectNameById.get(activeProjectFilterId) ?? activeProjectFilterId : null;
  const registerScopedInvoiceRecords = activeProjectFilterId
    ? invoiceRecords.filter((invoice) => invoice.project_id === activeProjectFilterId)
    : invoiceRecords;
  const registerScopedInvoiceSummary = summarizeBillingInvoiceRecords(registerScopedInvoiceRecords);
  const registerScopedLinkageSummary = summarizeBillingInvoiceLinkage(registerScopedInvoiceRecords);
  const linkageFilteredInvoiceRecords = filterBillingInvoiceRecordsByLinkage(registerScopedInvoiceRecords, linkageFilter);
  const filteredInvoiceRecords = filterBillingInvoiceRecordsByOverdueStatus(linkageFilteredInvoiceRecords, overdueFilter);
  const linkageScopedInvoiceSummary = summarizeBillingInvoiceRecords(linkageFilteredInvoiceRecords);
  const invoicePriorityQueue = buildBillingInvoicePriorityQueue(registerScopedInvoiceRecords, {
    limit: 3,
    classifyRecord: (record, records) => {
      const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(record, records, workspaceFundingAwards);
      if (!exactMatchFundingAward) {
        return null;
      }

      const overdue = isInvoiceOverdue(record.status, record.due_date);
      const status = typeof record.status === "string" ? record.status : "draft";
      const isOutstanding = ["internal_review", "submitted", "approved_for_payment"].includes(status);

      return {
        priorityTier: overdue ? 0.5 : isOutstanding ? 1.5 : 2.5,
        reason: overdue
          ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this overdue invoice is the only active unlinked reimbursement record.`
          : isOutstanding
            ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record still in payment flow.`
            : `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record.`,
        isExactRelink: true,
      };
    },
  });
  const exactRelinkCandidateCount = registerScopedInvoiceRecords.filter((invoice) =>
    Boolean(resolveExactBillingInvoiceAwardMatch(invoice, registerScopedInvoiceRecords, workspaceFundingAwards))
  ).length;
  const activeFocusedInvoiceId =
    requestedFocusedInvoiceId && registerScopedInvoiceRecords.some((invoice) => invoice.id === requestedFocusedInvoiceId)
      ? requestedFocusedInvoiceId
      : null;
  const activeRelinkedInvoiceId =
    requestedRelinkedInvoiceId &&
    registerScopedInvoiceRecords.some(
      (invoice) => invoice.id === requestedRelinkedInvoiceId && Boolean(invoice.funding_award_id || normalizeJoin(invoice.funding_awards)?.id)
    )
      ? requestedRelinkedInvoiceId
      : null;
  const focusedInvoiceRecord = activeFocusedInvoiceId
    ? registerScopedInvoiceRecords.find((invoice) => invoice.id === activeFocusedInvoiceId) ?? null
    : null;
  const focusedInvoiceExactMatchFundingAward = focusedInvoiceRecord
    ? resolveExactBillingInvoiceAwardMatch(focusedInvoiceRecord, registerScopedInvoiceRecords, workspaceFundingAwards)
    : null;
  const focusedInvoiceRelinkSaved = Boolean(
    activeRelinkedInvoiceId &&
      activeFocusedInvoiceId &&
      activeRelinkedInvoiceId === activeFocusedInvoiceId &&
      focusedInvoiceRecord?.fundingAward
  );
  const focusedTriageHref = activeFocusedInvoiceId
    ? buildInvoiceTriageHref({
        workspaceId,
        invoiceId: activeFocusedInvoiceId,
        linkage: linkageFilter,
        overdue: overdueFilter,
        projectId: activeProjectFilterId,
      })
    : null;
  const linkageFilterOptions = [
    {
      value: "all" as const,
      label: "All records",
      count: registerScopedInvoiceSummary.totalCount,
      outstandingNetAmount: registerScopedInvoiceSummary.outstandingNetAmount,
      totalNetAmount: registerScopedInvoiceSummary.totalNetAmount,
      overdueCount: registerScopedInvoiceSummary.overdueCount,
      overdueNetAmount: registerScopedInvoiceSummary.overdueNetAmount,
    },
    {
      value: "linked" as const,
      label: "Award-linked",
      count: registerScopedLinkageSummary.linkedCount,
      outstandingNetAmount: registerScopedLinkageSummary.linkedOutstandingNetAmount,
      totalNetAmount: registerScopedLinkageSummary.linkedNetAmount,
      overdueCount: registerScopedLinkageSummary.linkedOverdueCount,
      overdueNetAmount: registerScopedLinkageSummary.linkedOverdueNetAmount,
    },
    {
      value: "unlinked" as const,
      label: "Unlinked",
      count: registerScopedLinkageSummary.unlinkedCount,
      outstandingNetAmount: registerScopedLinkageSummary.unlinkedOutstandingNetAmount,
      totalNetAmount: registerScopedLinkageSummary.unlinkedNetAmount,
      overdueCount: registerScopedLinkageSummary.unlinkedOverdueCount,
      overdueNetAmount: registerScopedLinkageSummary.unlinkedOverdueNetAmount,
    },
  ] satisfies Array<{
    value: BillingInvoiceLinkageFilter;
    label: string;
    count: number;
    outstandingNetAmount: number;
    totalNetAmount: number;
    overdueCount: number;
    overdueNetAmount: number;
  }>;
  const activeLinkageFilterOption = linkageFilterOptions.find((option) => option.value === linkageFilter) ?? linkageFilterOptions[0];
  const overdueFilterOptions = [
    {
      value: "all" as const,
      label: "All due states",
      count: linkageScopedInvoiceSummary.totalCount,
      netAmount: linkageScopedInvoiceSummary.totalNetAmount,
    },
    {
      value: "overdue" as const,
      label: "Overdue only",
      count: linkageScopedInvoiceSummary.overdueCount,
      netAmount: linkageScopedInvoiceSummary.overdueNetAmount,
    },
  ] satisfies Array<{
    value: BillingInvoiceOverdueFilter;
    label: string;
    count: number;
    netAmount: number;
  }>;
  const activeOverdueFilterOption = overdueFilterOptions.find((option) => option.value === overdueFilter) ?? overdueFilterOptions[0];

  const operationsSummary = await loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    workspaceId
  );

  return (
    <section className="space-y-4">
      <ReadFailureNotice
        reads={reads}
        title="Part of this reimbursement view could not be read"
        description={`${reads.describe()} Treat no figure here as a statement of what this workspace is owed or has claimed until the read succeeds.`}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Consulting invoices</p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Invoices you are billing out</h2>
          <p className="text-sm text-muted-foreground">
            Every invoice, what retention is held back, whether the backup documents are attached, and which award each draw is billed against.
          </p>
        </div>
        <div className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
          <p className="font-semibold text-foreground">Current scope</p>
          <p className="mt-1.5">
            You can keep the invoice register here — amounts, retention, backup documents, and your own notes. OpenPlan does <strong>not yet</strong> fill out a funder&apos;s exact exhibit packets, claim forms, or certified pay applications for you.
          </p>
        </div>
      </div>

      {reimbursementProfile?.selection === "interim_unconfigured_default" ? (
        <article className={noticeClass("info")}>
          The reimbursement stages shown here come from the {reimbursementProfile.profileName} profile, used as an
          interim default — {INTERIM_DEFAULT_RATIONALE}
        </article>
      ) : null}

      <WorkspaceRuntimeCue summary={operationsSummary} />
      {operationsSummary.nextCommand?.key === "start-project-reimbursement-packets" ||
      operationsSummary.nextCommand?.key === "advance-project-reimbursement-invoicing" ? (
        <div className={`${insetClass()} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm`}>
          <div>
            <p className="font-semibold text-foreground">Current workspace reimbursement priority</p>
            <p className="mt-1 text-muted-foreground">{operationsSummary.nextCommand.detail}</p>
          </div>
          <Link href={resolveWorkspaceCommandHref(operationsSummary.nextCommand)} className="text-sm font-semibold text-foreground transition hover:text-primary">
            Open lead project
          </Link>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div id="record-invoice">
        <InvoiceRecordComposer
          workspaceId={workspaceId}
          projects={workspaceProjects.map((project) => ({ id: project.id, name: project.name }))}
          fundingAwards={workspaceFundingAwards.map((award) => ({ id: award.id, title: award.title, projectId: award.project_id }))}
          canWrite={canWriteInvoices}
          reimbursementProfile={reimbursementProfile}
        />
        </div>

        <article className={panelClass()}>
          <div className="flex items-start gap-3 border-b border-border/60 pb-4">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center border border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700/30 dark:text-emerald-300">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice register</p>
              <h3 className="text-lg font-semibold tracking-tight text-foreground">Register summary</h3>
            </div>
          </div>

          {invoiceRegisterPending ? (
            <div className="mt-4 border-l-2 border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100">
              Invoice register tables are pending in the current database. Apply the Lane C migration before expecting workspace invoice records to render here.
            </div>
          ) : invoiceRegisterUnreadable ? (
            <div className="mt-4 border-l-2 border-rose-300/80 bg-rose-50/80 px-4 py-3 text-sm text-rose-950 dark:border-rose-700/60 dark:bg-rose-950/25 dark:text-rose-100">
              The reimbursement invoice register could not be read, so no register total is shown. Nothing here says this workspace has claimed nothing or is owed nothing — the totals are unknown until the read succeeds.
            </div>
          ) : (
            <div className="mt-4 grid gap-px border border-border/60 bg-border/80 sm:grid-cols-2 xl:grid-cols-3">
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Records</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{invoiceSummary.totalCount}</p>
                <p className="mt-1 text-sm text-muted-foreground">{invoiceSummary.draftCount} draft, {invoiceSummary.submittedCount} in review or payment flow.</p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Net requested</p>
                {/*
                  `claimedNetAmount`, never `totalNetAmount`. This caption said
                  "all non-rejected invoice records" above a figure that summed
                  the whole register, rejected claims included — the caption was
                  right about what the number should mean and the number was
                  wrong. Drafts are excluded too: a draft has not been requested
                  of anyone.
                */}
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.claimedNetAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Claimed from funders: in review, submitted, approved, or paid. {invoiceSummary.draftCount} draft and {invoiceSummary.rejectedCount} rejected record{invoiceSummary.rejectedCount === 1 ? "" : "s"} are excluded
                  {invoiceSummary.rejectedCount > 0 ? `, holding ${formatCurrency(invoiceSummary.rejectedNetAmount)} the funder refused` : ""}.
                </p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outstanding</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.outstandingNetAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Submitted, internal-review, or approved-for-payment net amount.</p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.paidNetAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{invoiceSummary.overdueCount} overdue invoice record(s) still need attention.</p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Award-linked</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceLinkageSummary.linkedNetAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{invoiceLinkageSummary.linkedCount} invoice record(s) are currently part of the funding-award reimbursement chain.</p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unlinked to award</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceLinkageSummary.unlinkedNetAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{invoiceLinkageSummary.unlinkedCount} invoice record(s) still sit outside award-backed reimbursement reporting.</p>
              </div>
            </div>
          )}

          {!invoiceRegisterUnavailable && invoiceLinkageSummary.unlinkedCount > 0 ? (
            <div className="mt-4 border-l-2 border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100">
              {invoiceLinkageSummary.unlinkedCount} invoice record{invoiceLinkageSummary.unlinkedCount === 1 ? " is" : "s are"} still unlinked to a funding award, totaling <strong>{formatCurrency(invoiceLinkageSummary.unlinkedNetAmount)}</strong>.
              {invoiceLinkageSummary.unlinkedOverdueCount > 0
                ? ` ${invoiceLinkageSummary.unlinkedOverdueCount} of those record${invoiceLinkageSummary.unlinkedOverdueCount === 1 ? " is" : "s are"} already overdue, totaling ${formatCurrency(invoiceLinkageSummary.unlinkedOverdueNetAmount)}.`
                : ""}{" "}
              Until they are linked to an award, the reimbursement totals above are lower than what you are actually owed.
            </div>
          ) : null}

          {!invoiceRegisterUnavailable && invoicePriorityQueue.length > 0 ? (
            <div className="mt-4 border border-border/60 bg-background/70 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Priority cleanup queue</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Riskiest first: unlinked to an award, overdue, and largest in amount.
                  </p>
                  {exactRelinkCandidateCount > 0 ? (
                    <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                      {exactRelinkCandidateCount} invoice record{exactRelinkCandidateCount === 1 ? " has" : "s have"} an exact award relink ready in the queue below.
                    </p>
                  ) : null}
                  {activeProjectFilterName ? (
                    <p className="mt-1 text-xs text-muted-foreground">Currently narrowed to project scope: {activeProjectFilterName}.</p>
                  ) : null}
                </div>
                <StatusBadge tone="warning">Top {invoicePriorityQueue.length}</StatusBadge>
              </div>

              <ul className="mt-3 space-y-3">
                {invoicePriorityQueue.map((entry) => {
                  const invoice = entry.record;
                  const triageHref = buildInvoiceTriageHref({
                    workspaceId,
                    invoiceId: invoice.id,
                    linkage: entry.isLinked ? "linked" : "unlinked",
                    overdue: entry.isOverdue ? "overdue" : "all",
                    projectId: invoice.project_id,
                  });
                  return (
                    <li key={invoice.id} className="border border-border/50 bg-background/80 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                        <StatusBadge tone={entry.isLinked ? "neutral" : "warning"}>
                          {entry.isLinked ? "Award-linked" : "Unlinked"}
                        </StatusBadge>
                        {entry.isExactRelink ? <StatusBadge tone="success">Exact relink ready</StatusBadge> : null}
                        {entry.isOverdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
                        {entry.isOutstanding ? <StatusBadge tone="info">Outstanding</StatusBadge> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {invoice.project_id ? `Project ${projectNameById.get(invoice.project_id) ?? invoice.project_id}` : "Workspace-level record"}
                          {invoice.due_date ? ` · Due ${invoice.due_date}` : ""}
                        </span>
                        <span className="font-semibold text-foreground">{formatCurrency(entry.netAmount)}</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{entry.reason}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                        <Link href={triageHref} className="openplan-inline-label">
                          {canWriteInvoices ? "Fix now in register" : "Open in register"}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          Opens the matching linkage and overdue filter state, then jumps to this invoice row.
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </article>
      </div>

      <article className={panelClass()}>
        <div className="space-y-1 border-b border-border/60 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice register</p>
          <h3 className="text-lg font-semibold tracking-tight">Consulting invoice records</h3>
        </div>

        {!invoiceRegisterUnavailable && activeProjectFilterId && activeProjectFilterName ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border border-border/60 bg-background/70 px-3 py-3 text-sm">
            <StatusBadge tone="info">Project scope</StatusBadge>
            <span className="font-semibold text-foreground">{activeProjectFilterName}</span>
            <span className="text-muted-foreground">
              {registerScopedInvoiceSummary.totalCount} invoice record{registerScopedInvoiceSummary.totalCount === 1 ? "" : "s"} in this narrowed register.
            </span>
            <Link
              href={buildInvoicingHref({
                workspaceId,
                linkage: linkageFilter,
                overdue: overdueFilter,
                projectId: null,
                focusedInvoiceId: activeFocusedInvoiceId,
                relinkedInvoiceId: activeRelinkedInvoiceId,
              })}
              className="openplan-inline-label"
            >
              Show all projects
            </Link>
          </div>
        ) : null}

        {!invoiceRegisterUnavailable && activeFocusedInvoiceId ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border border-sky-300/70 bg-sky-50/70 px-3 py-3 text-sm text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100">
            <StatusBadge tone="info">Focused row</StatusBadge>
            <span>The register is highlighting the invoice you opened from invoice triage.</span>
            {focusedInvoiceExactMatchFundingAward ? (
              <span>
                The only safe funding-award match is ready below and will be preselected as <strong>{focusedInvoiceExactMatchFundingAward.title}</strong>.
              </span>
            ) : null}
            {focusedInvoiceRelinkSaved ? (
              <span>
                Relink saved. This focused invoice now sits inside the reimbursement chain through <strong>{focusedInvoiceRecord?.fundingAward?.title}</strong>.
              </span>
            ) : null}
            {focusedTriageHref ? <InvoiceTriageLinkCopy href={focusedTriageHref} /> : null}
            <Link
              href={buildInvoicingHref({
                workspaceId,
                linkage: linkageFilter,
                overdue: overdueFilter,
                projectId: activeProjectFilterId,
                focusedInvoiceId: null,
                relinkedInvoiceId: null,
              })}
              className="openplan-inline-label"
            >
              Clear focus
            </Link>
          </div>
        ) : null}

        {!invoiceRegisterUnavailable ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {linkageFilterOptions.map((option) => {
              const active = linkageFilter === option.value;
              return (
                <Link
                  key={option.value}
                  href={buildInvoicingHref({
                    workspaceId,
                    linkage: option.value,
                    overdue: overdueFilter,
                    projectId: activeProjectFilterId,
                    focusedInvoiceId: activeFocusedInvoiceId,
                    relinkedInvoiceId: activeRelinkedInvoiceId,
                  })}
                  className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                >
                  {option.label} · {option.count} · {formatCurrency(option.outstandingNetAmount)} outstanding
                  {option.overdueCount > 0 ? ` · ${option.overdueCount} overdue` : ""}
                </Link>
              );
            })}
          </div>
        ) : null}

        {!invoiceRegisterUnavailable ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {overdueFilterOptions.map((option) => {
              const active = overdueFilter === option.value;
              return (
                <Link
                  key={option.value}
                  href={buildInvoicingHref({
                    workspaceId,
                    linkage: linkageFilter,
                    overdue: option.value,
                    projectId: activeProjectFilterId,
                    focusedInvoiceId: activeFocusedInvoiceId,
                    relinkedInvoiceId: activeRelinkedInvoiceId,
                  })}
                  className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                >
                  {option.label} · {option.count}
                  {option.value === "overdue" ? ` · ${formatCurrency(option.netAmount)} late` : ""}
                </Link>
              );
            })}
          </div>
        ) : null}

        {!invoiceRegisterUnavailable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {linkageFilter === "all"
              ? `${activeProjectFilterName ? `${activeProjectFilterName} register scope currently tracks` : `Workspace invoice register currently tracks`} ${formatCurrency(registerScopedInvoiceSummary.claimedNetAmount)} net requested, with ${formatCurrency(registerScopedInvoiceSummary.outstandingNetAmount)} still in review or payment flow.`
              : linkageFilter === "linked"
                ? `Award-linked records currently account for ${formatCurrency(registerScopedLinkageSummary.linkedClaimedNetAmount)} net requested, with ${formatCurrency(registerScopedLinkageSummary.linkedOutstandingNetAmount)} still outstanding inside the reimbursement chain.`
                : `Unlinked records currently account for ${formatCurrency(registerScopedLinkageSummary.unlinkedClaimedNetAmount)} net requested, with ${formatCurrency(registerScopedLinkageSummary.unlinkedOutstandingNetAmount)} still outstanding outside the reimbursement chain.`}
            {activeLinkageFilterOption.overdueCount > 0
              ? ` ${activeLinkageFilterOption.overdueCount} overdue record${activeLinkageFilterOption.overdueCount === 1 ? " is" : "s are"} already late, totaling ${formatCurrency(activeLinkageFilterOption.overdueNetAmount)}.`
              : ""}
            {overdueFilter === "overdue"
              ? ` Register view is currently narrowed to overdue invoices only, showing ${activeOverdueFilterOption.count} late record${activeOverdueFilterOption.count === 1 ? "" : "s"} totaling ${formatCurrency(activeOverdueFilterOption.netAmount)}.`
              : ""}
          </p>
        ) : null}

        {invoiceRegisterPending ? (
          <p className="mt-4 text-sm text-muted-foreground">Apply the Lane C migration to enable invoice register visibility for this workspace.</p>
        ) : invoiceRegisterUnreadable ? (
          // NOT "no invoice records recorded yet". The register read failed, so
          // this workspace's reimbursement claims are UNKNOWN here — which is a
          // different fact from there being none, and the difference is money
          // an agency may be owed by its funder.
          <p className="mt-4 text-sm text-muted-foreground">
            The invoice register could not be read, so no invoice records are listed. This is not a finding that this workspace has no reimbursement invoices.
          </p>
        ) : filteredInvoiceRecords.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {overdueFilter === "overdue"
              ? linkageFilter === "linked"
                ? "No overdue award-linked invoice records are visible in this workspace right now."
                : linkageFilter === "unlinked"
                  ? "No overdue unlinked invoice records are visible in this workspace right now."
                  : "No overdue invoice records are visible in this workspace right now."
              : linkageFilter === "linked"
                ? "No award-linked invoice records are visible in this workspace yet."
                : linkageFilter === "unlinked"
                  ? "No unlinked invoice records are visible in this workspace right now."
                  : "This register holds the invoices your agency sends — reimbursement claims to your funders, and bills to your own clients if you consult. Record your first invoice to start tracking what you are owed."}
            {overdueFilter !== "overdue" && linkageFilter === "all" ? (
              <>
                {" "}
                <a href="#record-invoice" className="font-medium text-foreground underline underline-offset-4">
                  Record an invoice
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {filteredInvoiceRecords.map((invoice) => {
              const riskState = billingRowRiskState(invoice);
              const isFocusedRow = activeFocusedInvoiceId === invoice.id;
              const isJustRelinkedRow = activeRelinkedInvoiceId === invoice.id;
              const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(invoice, registerScopedInvoiceRecords, workspaceFundingAwards);
              const awardSubstantiationSummary = invoice.funding_award_id
                ? awardSubstantiation.get(invoice.funding_award_id) ?? null
                : null;
              const substantiationProjectId =
                invoice.project_id ??
                (invoice.funding_award_id
                  ? workspaceFundingAwards.find((award) => award.id === invoice.funding_award_id)?.project_id ?? null
                  : null);
              const rowTriageHref = riskState.title
                ? buildInvoiceTriageHref({
                    workspaceId,
                    invoiceId: invoice.id,
                    linkage: invoice.funding_award_id ? "linked" : "unlinked",
                    overdue: isInvoiceOverdue(invoice.status, invoice.due_date) ? "overdue" : "all",
                    projectId: invoice.project_id,
                  })
                : null;
              // Label the posture with the row's OWN profile vocabulary —
              // never another profile's. A row whose profile this deployment
              // does not register gets the humanized raw value rather than
              // another profile's label; an un-backfilled row (no profile id
              // of its own — the legacy-select path) gets its raw legacy
              // caltrans_posture value humanized. The workspace's RESOLVED
              // profile vocabulary is deliberately not used in that fallback:
              // it belongs to a profile the row never recorded, and its
              // labels could misdescribe the stored value.
              const rowPostureOptions = invoice.reimbursement_profile_id
                ? reimbursementProfileRegistry.get(invoice.reimbursement_profile_id)?.postureOptions ?? null
                : null;
              const rowPostureLabel = postureLabel(
                rowPostureOptions,
                invoice.reimbursement_posture ?? invoice.caltrans_posture
              );

              return (
                <li
                  id={`invoice-record-${invoice.id}`}
                  key={invoice.id}
                  className={`scroll-mt-24 border px-4 py-4 ${riskState.rowClassName} ${isFocusedRow ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleCase(invoice.status)}</StatusBadge>
                    <StatusBadge tone="info">{titleCase(invoice.billing_basis)}</StatusBadge>
                    <StatusBadge tone={toneForSupportingDocs(invoice.supporting_docs_status)}>{titleCase(invoice.supporting_docs_status)}</StatusBadge>
                    {invoice.fundingAward ? <StatusBadge tone="neutral">Award {invoice.fundingAward.title}</StatusBadge> : null}
                    {isFocusedRow ? <StatusBadge tone="info">Focused from triage</StatusBadge> : null}
                    {isJustRelinkedRow ? <StatusBadge tone="success">Relink just saved</StatusBadge> : null}
                    {exactMatchFundingAward ? <StatusBadge tone="success">Exact match ready</StatusBadge> : null}
                    {!invoice.fundingAward && invoiceNeedsAwardRelink(invoice.status, invoice.funding_award_id) ? (
                      <StatusBadge tone={riskState.tone === "danger" ? "danger" : "warning"}>Needs relink</StatusBadge>
                    ) : null}
                    {riskState.title ? <StatusBadge tone={riskState.tone ?? "neutral"}>{riskState.title}</StatusBadge> : null}
                    <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                      {invoice.created_at ? new Date(invoice.created_at).toLocaleString() : "N/A"}
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.project_id ? `Project ${projectNameById.get(invoice.project_id) ?? invoice.project_id}` : "Workspace-level record"}
                        {invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(invoice.net_amount ?? 0))}</p>
                      <p className="text-xs text-muted-foreground">
                        Gross {formatCurrency(Number(invoice.amount ?? 0))}
                        {Number(invoice.retention_amount ?? 0) > 0 ? ` · Retention ${formatCurrency(Number(invoice.retention_amount ?? 0))}` : ""}
                      </p>
                    </div>
                  </div>

                  {riskState.title && riskState.detail ? (
                    <div className={`mt-3 ${billingRowNoticeClass(riskState.tone ?? "info")}`}>
                      <p className="font-semibold tracking-tight">{riskState.title}</p>
                      <p className="mt-1">{riskState.detail}</p>
                    </div>
                  ) : null}

                  {exactMatchFundingAward ? (
                    <div className="mt-3 border-l-2 border-emerald-300/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                      <p className="font-semibold tracking-tight">Exact award relink is ready</p>
                      <p className="mt-1">
                        This invoice is the only active unlinked reimbursement record on its project, and {exactMatchFundingAward.title} is the only available funding award for that same project.
                      </p>
                    </div>
                  ) : null}

                  {isJustRelinkedRow && invoice.fundingAward ? (
                    <div className="mt-3 border-l-2 border-emerald-300/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                      <p className="font-semibold tracking-tight">Relink saved in this register view</p>
                      <p className="mt-1">This invoice now contributes to reimbursement posture through {invoice.fundingAward.title}.</p>
                    </div>
                  ) : null}

                  <p className="mt-3 text-xs text-muted-foreground">
                    {invoice.notes || `Reimbursement posture: ${rowPostureLabel}.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                    {invoice.invoice_date ? <span>Invoice date {invoice.invoice_date}</span> : null}
                    {invoice.due_date ? <span>Due {invoice.due_date}</span> : null}
                    {invoice.consultant_name ? <span>Consultant {invoice.consultant_name}</span> : null}
                    {invoice.fundingAward ? <span>Funding award {invoice.fundingAward.title}</span> : null}
                  </div>

                  {awardSubstantiationSummary ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                      <StatusBadge tone={toneForSubstantiationReadiness(awardSubstantiationSummary.readiness)}>
                        {substantiationReadinessLabel(awardSubstantiationSummary.readiness)}
                      </StatusBadge>
                      <span className="text-xs text-muted-foreground">{describeAwardSubstantiation(awardSubstantiationSummary)}</span>
                      {substantiationProjectId ? (
                        <Link href={`/projects/${substantiationProjectId}`} className="openplan-inline-label">
                          Open project milestones and submittals
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  {rowTriageHref ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                      <Link href={rowTriageHref} className="openplan-inline-label">
                        Open triage view
                      </Link>
                      <InvoiceTriageLinkCopy href={rowTriageHref} />
                      <span className="text-xs text-muted-foreground">
                        Copies a shareable triage link for this exact invoice, including project scope, filters, and row anchor.
                      </span>
                    </div>
                  ) : null}

                  <InvoiceFundingAwardLinker
                    invoiceId={invoice.id}
                    workspaceId={workspaceId}
                    projectId={invoice.project_id}
                    isFocusedRow={isFocusedRow}
                    currentFundingAwardId={invoice.funding_award_id}
                    exactMatchFundingAwardId={exactMatchFundingAward?.id ?? null}
                    autoSelectExactMatch={isFocusedRow}
                    fundingAwards={workspaceFundingAwards.map((award) => ({
                      id: award.id,
                      title: award.title,
                      projectId: award.project_id,
                    }))}
                    canWrite={canWriteInvoices}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}
