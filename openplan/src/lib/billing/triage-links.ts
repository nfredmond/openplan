import type { BillingInvoiceLinkageFilter, BillingInvoiceOverdueFilter } from "@/lib/billing/invoice-records";

export function buildBillingHref(params: {
  workspaceId: string | null;
  checkoutState: string | null;
  checkoutPlan: string | null;
  linkage: BillingInvoiceLinkageFilter;
  overdue: BillingInvoiceOverdueFilter;
  projectId?: string | null;
  focusedInvoiceId?: string | null;
  relinkedInvoiceId?: string | null;
}) {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.checkoutState) search.set("checkout", params.checkoutState);
  if (params.checkoutPlan) search.set("plan", params.checkoutPlan);
  if (params.linkage !== "all") search.set("linkage", params.linkage);
  if (params.overdue !== "all") search.set("overdue", params.overdue);
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.focusedInvoiceId) search.set("focusInvoiceId", params.focusedInvoiceId);
  if (params.relinkedInvoiceId) search.set("relinkedInvoiceId", params.relinkedInvoiceId);
  const query = search.toString();
  return query ? `/billing?${query}` : "/billing";
}

export function buildBillingInvoiceTriageHref(params: {
  workspaceId: string | null;
  checkoutState?: string | null;
  checkoutPlan?: string | null;
  invoiceId: string;
  linkage: BillingInvoiceLinkageFilter;
  overdue: BillingInvoiceOverdueFilter;
  projectId?: string | null;
  relinkedInvoiceId?: string | null;
}) {
  return `${buildBillingHref({
    workspaceId: params.workspaceId,
    checkoutState: params.checkoutState ?? null,
    checkoutPlan: params.checkoutPlan ?? null,
    linkage: params.linkage,
    overdue: params.overdue,
    projectId: params.projectId,
    focusedInvoiceId: params.invoiceId,
    relinkedInvoiceId: params.relinkedInvoiceId ?? null,
  })}#invoice-record-${params.invoiceId}`;
}
