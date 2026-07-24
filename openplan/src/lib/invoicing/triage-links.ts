import type { BillingInvoiceLinkageFilter, BillingInvoiceOverdueFilter } from "@/lib/invoicing/invoice-records";

/**
 * Deep links into the invoice register.
 *
 * The `checkoutState` / `checkoutPlan` parameters that used to ride along here
 * are gone with the Stripe subsystem — they carried a checkout result back to a
 * billing page that no longer exists. What remains is the filter state a
 * planner actually navigates by: workspace, linkage, overdue, project, and the
 * invoice to focus.
 */
export function buildInvoicingHref(params: {
  workspaceId: string | null;
  linkage: BillingInvoiceLinkageFilter;
  overdue: BillingInvoiceOverdueFilter;
  projectId?: string | null;
  focusedInvoiceId?: string | null;
  relinkedInvoiceId?: string | null;
}) {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.linkage !== "all") search.set("linkage", params.linkage);
  if (params.overdue !== "all") search.set("overdue", params.overdue);
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.focusedInvoiceId) search.set("focusInvoiceId", params.focusedInvoiceId);
  if (params.relinkedInvoiceId) search.set("relinkedInvoiceId", params.relinkedInvoiceId);
  const query = search.toString();
  return query ? `/invoicing?${query}` : "/invoicing";
}

export function buildInvoiceTriageHref(params: {
  workspaceId: string | null;
  invoiceId: string;
  linkage: BillingInvoiceLinkageFilter;
  overdue: BillingInvoiceOverdueFilter;
  projectId?: string | null;
  relinkedInvoiceId?: string | null;
}) {
  return `${buildInvoicingHref({
    workspaceId: params.workspaceId,
    linkage: params.linkage,
    overdue: params.overdue,
    projectId: params.projectId,
    focusedInvoiceId: params.invoiceId,
    relinkedInvoiceId: params.relinkedInvoiceId ?? null,
  })}#invoice-record-${params.invoiceId}`;
}
