import { ClientComposer, type ClientComposerRecord } from "@/components/invoicing/client-composer";
import { ClientInvoiceComposer } from "@/components/invoicing/client-invoice-composer";
import { ClientInvoiceStatusControl } from "@/components/invoicing/client-invoice-status-control";
import { EngagementComposer, type EngagementComposerRecord } from "@/components/invoicing/engagement-composer";
import { EngagementNteBar } from "@/components/invoicing/engagement-nte-bar";
import { ReceivableAgingStrip } from "@/components/invoicing/receivable-aging-strip";
import { StaffAndRatesPanel } from "@/components/invoicing/staff-and-rates-panel";
import { TimeEntryComposer } from "@/components/invoicing/time-entry-composer";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildEngagementBilledSummary,
  buildReceivableAgingSummary,
  summarizeReceivables,
  type ClientInvoiceRecordLike,
} from "@/lib/invoicing/receivables";
import { summarizeUnbilledTime, type TimeEntryLike } from "@/lib/invoicing/time-billing";
import { createClient } from "@/lib/supabase/server";
import {
  formatCurrency,
  insetClass,
  looksLikePendingSchema,
  panelClass,
  titleCase,
} from "./invoicing-page-helpers";

type ClientRow = {
  id: string;
  name: string;
  client_kind: string;
  billing_address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
};

type EngagementRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  reference_code: string | null;
  engagement_kind: string;
  billing_basis: string | null;
  not_to_exceed_amount: number | string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
};

type ClientInvoiceRow = ClientInvoiceRecordLike & {
  id: string;
  client_id: string;
  engagement_id: string | null;
  project_id: string | null;
  invoice_number: string;
  status: string;
  sent_date: string | null;
  paid_date: string | null;
  invoice_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  payment_terms: string | null;
  notes: string | null;
  created_at: string | null;
};

type StaffRow = {
  id: string;
  name: string;
  title: string | null;
  default_labor_category: string | null;
  active: boolean;
};

type RateTableRow = {
  id: string;
  name: string;
  engagement_id: string | null;
  invoicing_rate_entries: Array<{ labor_category: string; hourly_rate: number | string }> | null;
};

type TimeEntryRow = TimeEntryLike & {
  id: string;
  notes: string | null;
};

type LaneQueryResult = { data: unknown[] | null; error: { message?: string } | null };

const INVOICE_LIST_LIMIT = 500;
const TIME_REGISTER_LIMIT = 100;

function toneForClientInvoiceStatus(status: string): "info" | "success" | "warning" | "neutral" {
  if (status === "paid") return "success";
  if (status === "sent") return "info";
  if (status === "void") return "warning";
  return "neutral";
}

const ENGAGEMENT_KIND_LABELS: Record<string, string> = {
  contract: "Contract",
  task_order: "Task order",
  on_call: "On-call",
  other: "Other",
};

/**
 * The receivable direction of the invoicing module: this workspace invoicing
 * ITS OWN CLIENTS. The register groups client invoices under their client
 * with an aging strip and per-engagement not-to-exceed position; below it sit
 * the composers and the time ledger the invoice lines are pulled from.
 */
export async function ReceivablesLane({
  workspaceId,
  canWriteInvoices,
}: {
  workspaceId: string;
  canWriteInvoices: boolean;
}) {
  const supabase = await createClient();

  const [clientsRead, engagementsRead, invoicesRead, staffRead, rateTablesRead, timeEntriesRead, projectsRead] =
    (await Promise.all([
      supabase
        .from("invoicing_clients")
        .select("id, name, client_kind, billing_address, contact_name, contact_email, notes")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("invoicing_engagements")
        .select(
          "id, client_id, project_id, title, reference_code, engagement_kind, billing_basis, not_to_exceed_amount, start_date, end_date, status, notes"
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("client_invoices")
        .select(
          "id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, notes, created_at"
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(INVOICE_LIST_LIMIT),
      supabase
        .from("invoicing_staff")
        .select("id, name, title, default_labor_category, active")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("invoicing_rate_tables")
        .select("id, name, engagement_id, invoicing_rate_entries(labor_category, hourly_rate)")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("invoicing_time_entries")
        .select("id, staff_id, engagement_id, deliverable_id, entry_date, hours, notes, billable, labor_category, billed_line_item_id")
        .eq("workspace_id", workspaceId)
        .order("entry_date", { ascending: false })
        .limit(TIME_REGISTER_LIMIT),
      supabase
        .from("projects")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false }),
    ])) as LaneQueryResult[];

  // The receivable core (migration 20260727000010) and the time-and-rates set
  // (20260727000011) shipped separately; a deployment can hold one without
  // the other, so each pending state is detected and disclosed on its own.
  const receivableCorePending = [clientsRead, engagementsRead, invoicesRead].some(
    (read) => read.error && looksLikePendingSchema(read.error.message)
  );
  const receivableCoreUnavailable = [clientsRead, engagementsRead, invoicesRead].some((read) => Boolean(read.error));
  const timeAndRatesPending = [staffRead, rateTablesRead, timeEntriesRead].some(
    (read) => read.error && looksLikePendingSchema(read.error.message)
  );
  const timeAndRatesUnavailable = [staffRead, rateTablesRead, timeEntriesRead].some((read) => Boolean(read.error));

  const clients = receivableCoreUnavailable ? [] : ((clientsRead.data ?? []) as ClientRow[]);
  const engagements = receivableCoreUnavailable ? [] : ((engagementsRead.data ?? []) as EngagementRow[]);
  const invoices = receivableCoreUnavailable ? [] : ((invoicesRead.data ?? []) as ClientInvoiceRow[]);
  const staff = timeAndRatesUnavailable ? [] : ((staffRead.data ?? []) as StaffRow[]);
  const rateTables = timeAndRatesUnavailable ? [] : ((rateTablesRead.data ?? []) as RateTableRow[]);
  const timeEntries = timeAndRatesUnavailable ? [] : ((timeEntriesRead.data ?? []) as TimeEntryRow[]);
  const projects = (projectsRead.data ?? []) as Array<{ id: string; name: string }>;

  // Deliverables hang off projects, not the workspace; fetch them for the
  // pickers only when the workspace has projects at all.
  const projectIds = projects.map((project) => project.id);
  const deliverablesRead =
    projectIds.length > 0
      ? ((await supabase
          .from("project_deliverables")
          .select("id, project_id, title")
          .in("project_id", projectIds)
          .order("updated_at", { ascending: false })
          .limit(500)) as LaneQueryResult)
      : ({ data: [], error: null } as LaneQueryResult);
  const deliverables = deliverablesRead.error
    ? []
    : ((deliverablesRead.data ?? []) as Array<{ id: string; project_id: string; title: string }>);

  const receivableSummary = summarizeReceivables(invoices);
  const workspaceAging = buildReceivableAgingSummary(invoices);
  const unbilledSummary = summarizeUnbilledTime(timeEntries);

  const engagementTitleById = new Map(engagements.map((engagement) => [engagement.id, engagement.title]));
  const staffNameById = new Map(staff.map((member) => [member.id, member.name]));
  const deliverableTitleById = new Map(deliverables.map((deliverable) => [deliverable.id, deliverable.title]));
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  const engagementOptions = engagements.map((engagement) => ({
    id: engagement.id,
    clientId: engagement.client_id,
    projectId: engagement.project_id,
    title: engagement.title,
    notToExceedAmount:
      engagement.not_to_exceed_amount == null ? null : Number(engagement.not_to_exceed_amount),
  }));
  const deliverableOptions = deliverables.map((deliverable) => ({
    id: deliverable.id,
    projectId: deliverable.project_id,
    title: deliverable.title,
  }));
  const rateTableOptions = rateTables.map((table) => ({
    id: table.id,
    engagementId: table.engagement_id,
    engagementTitle: table.engagement_id ? engagementTitleById.get(table.engagement_id) ?? null : null,
    entries: (table.invoicing_rate_entries ?? []).map((entry) => ({
      laborCategory: entry.labor_category,
      hourlyRate: Number(entry.hourly_rate),
    })),
  }));
  const staffOptions = staff.map((member) => ({
    id: member.id,
    name: member.name,
    defaultLaborCategory: member.default_labor_category,
  }));

  if (receivableCoreUnavailable) {
    return (
      <section className="space-y-4">
        <article className={panelClass()}>
          <div className="space-y-1 border-b border-border/60 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Client invoices</p>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Receivable register</h2>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {receivableCorePending
              ? "The client invoicing tables are pending in this database. Apply the latest migrations before expecting clients, engagements, or client invoices to render here."
              : "Client invoicing records could not be loaded right now."}
          </p>
        </article>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <article className={panelClass()}>
        <div className="space-y-1 border-b border-border/60 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Client invoices</p>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Receivable register</h2>
        </div>

        {invoices.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No client invoices recorded yet for this workspace. Compose the first one below once a client exists.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-px border border-border/60 bg-border/80 sm:grid-cols-2 xl:grid-cols-4">
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoices</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{receivableSummary.totalCount}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {receivableSummary.draftCount} draft, {receivableSummary.sentCount} sent, {receivableSummary.paidCount} paid, {receivableSummary.voidCount} void.
                </p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outstanding</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(receivableSummary.outstandingAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Sent invoices not yet paid or voided.</p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(receivableSummary.overdueAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {receivableSummary.overdueCount} invoice{receivableSummary.overdueCount === 1 ? "" : "s"} past due date.
                </p>
              </div>
              <div className="bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(receivableSummary.paidAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Settled receivable value.</p>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace aging</p>
              <ReceivableAgingStrip aging={workspaceAging} />
            </div>
          </>
        )}
      </article>

      <article className={panelClass()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Clients &amp; engagements</p>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Who this workspace bills</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ClientComposer workspaceId={workspaceId} canWrite={canWriteInvoices} />
            <EngagementComposer
              workspaceId={workspaceId}
              canWrite={canWriteInvoices}
              clients={clients.map((client) => ({ id: client.id, name: client.name }))}
              projects={projects}
            />
          </div>
        </div>

        {!canWriteInvoices ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Members review this register; owner or admin role is required to write clients, engagements, invoices, or time.
          </p>
        ) : null}

        {clients.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No clients recorded yet. A client is whoever receives this workspace&apos;s invoices — a city, county, agency, prime, tribe, nonprofit, or private party.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {clients.map((client) => {
              const clientEngagements = engagements.filter((engagement) => engagement.client_id === client.id);
              const clientInvoices = invoices.filter((invoice) => invoice.client_id === client.id);
              const clientAging = buildReceivableAgingSummary(clientInvoices);
              const composerRecord: ClientComposerRecord = {
                id: client.id,
                name: client.name,
                clientKind: client.client_kind,
                billingAddress: client.billing_address,
                contactName: client.contact_name,
                contactEmail: client.contact_email,
                notes: client.notes,
              };

              return (
                <li key={client.id} className="border border-border/60 bg-background/70 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold tracking-tight text-foreground">{client.name}</h4>
                    <StatusBadge tone="neutral">{titleCase(client.client_kind)}</StatusBadge>
                    {client.contact_email ? (
                      <span className="text-xs text-muted-foreground">
                        {client.contact_name ? `${client.contact_name} · ` : ""}
                        {client.contact_email}
                      </span>
                    ) : null}
                    <ClientComposer workspaceId={workspaceId} canWrite={canWriteInvoices} client={composerRecord} />
                  </div>

                  <div className="mt-3">
                    <ReceivableAgingStrip aging={clientAging} />
                  </div>

                  {clientEngagements.length > 0 ? (
                    <ul className="mt-3 space-y-3">
                      {clientEngagements.map((engagement) => {
                        const billed = buildEngagementBilledSummary(engagement, invoices);
                        const engagementRecord: EngagementComposerRecord = {
                          id: engagement.id,
                          clientId: engagement.client_id,
                          projectId: engagement.project_id,
                          title: engagement.title,
                          referenceCode: engagement.reference_code,
                          engagementKind: engagement.engagement_kind,
                          billingBasis: engagement.billing_basis,
                          notToExceedAmount: engagement.not_to_exceed_amount,
                          startDate: engagement.start_date,
                          endDate: engagement.end_date,
                          status: engagement.status,
                          notes: engagement.notes,
                        };

                        return (
                          <li key={engagement.id} className="border border-border/50 bg-background/80 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{engagement.title}</p>
                              <StatusBadge tone="info">
                                {ENGAGEMENT_KIND_LABELS[engagement.engagement_kind] ?? titleCase(engagement.engagement_kind)}
                              </StatusBadge>
                              <StatusBadge tone={engagement.status === "active" ? "success" : "neutral"}>
                                {titleCase(engagement.status)}
                              </StatusBadge>
                              {engagement.reference_code ? (
                                <span className="text-xs text-muted-foreground">Ref {engagement.reference_code}</span>
                              ) : null}
                              {engagement.project_id ? (
                                <span className="text-xs text-muted-foreground">
                                  Project {projectNameById.get(engagement.project_id) ?? engagement.project_id}
                                </span>
                              ) : null}
                              <EngagementComposer
                                workspaceId={workspaceId}
                                canWrite={canWriteInvoices}
                                clients={clients.map((clientOption) => ({ id: clientOption.id, name: clientOption.name }))}
                                projects={projects}
                                engagement={engagementRecord}
                              />
                            </div>
                            <div className="mt-2">
                              <EngagementNteBar summary={billed} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">No engagements recorded for this client yet.</p>
                  )}

                  {clientInvoices.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {clientInvoices.map((invoice) => (
                        <li key={invoice.id} className="border border-border/50 bg-background/80 px-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                              <StatusBadge tone={toneForClientInvoiceStatus(invoice.status)}>{titleCase(invoice.status)}</StatusBadge>
                              {invoice.engagement_id ? (
                                <span className="text-xs text-muted-foreground">
                                  {engagementTitleById.get(invoice.engagement_id) ?? "Engagement"}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-sm font-semibold text-foreground">
                              {formatCurrency(Number(invoice.total_amount ?? 0))}
                            </p>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {invoice.invoice_date ? <span>Invoice date {invoice.invoice_date}</span> : null}
                            {invoice.due_date ? <span>Due {invoice.due_date}</span> : null}
                            {invoice.sent_date ? <span>Sent {invoice.sent_date}</span> : null}
                            {invoice.paid_date ? <span>Paid {invoice.paid_date}</span> : null}
                            {invoice.payment_terms ? <span>{invoice.payment_terms}</span> : null}
                          </div>
                          <div className="mt-2 border-t border-border/50 pt-2">
                            <ClientInvoiceStatusControl
                              workspaceId={workspaceId}
                              invoiceId={invoice.id}
                              invoiceNumber={invoice.invoice_number}
                              status={invoice.status}
                              canWrite={canWriteInvoices}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">No invoices to this client yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <ClientInvoiceComposer
        workspaceId={workspaceId}
        canWrite={canWriteInvoices}
        clients={clients.map((client) => ({ id: client.id, name: client.name }))}
        engagements={engagementOptions}
        projects={projects}
        deliverables={deliverableOptions}
        rateTables={rateTableOptions}
        staff={staffOptions.map((member) => ({ id: member.id, name: member.name }))}
      />

      <article className={panelClass()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Time &amp; rates</p>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">The ledger behind the lines</h3>
          </div>
          {!timeAndRatesUnavailable && unbilledSummary.entryCount > 0 ? (
            <div className={`${insetClass()} px-3 py-2 text-xs text-muted-foreground`}>
              {unbilledSummary.hours} unbilled hour{unbilledSummary.hours === 1 ? "" : "s"} across {unbilledSummary.entryCount} entr{unbilledSummary.entryCount === 1 ? "y" : "ies"} and {unbilledSummary.staffCount} staff
              {unbilledSummary.oldestEntryDate ? ` · oldest ${unbilledSummary.oldestEntryDate}` : ""}
              {timeEntries.length === TIME_REGISTER_LIMIT ? ` · counted over the latest ${TIME_REGISTER_LIMIT} entries` : ""}
            </div>
          ) : null}
        </div>

        {timeAndRatesUnavailable ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {timeAndRatesPending
              ? "The time and rate tables are pending in this database. Apply the latest migrations before expecting staff, rate tables, or time entries to render here."
              : "Time and rate records could not be loaded right now."}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <StaffAndRatesPanel
              workspaceId={workspaceId}
              canWrite={canWriteInvoices}
              staff={staff.map((member) => ({
                id: member.id,
                name: member.name,
                title: member.title,
                defaultLaborCategory: member.default_labor_category,
                active: member.active,
              }))}
              rateTables={rateTableOptions.map((table) => ({
                id: table.id,
                name: rateTables.find((raw) => raw.id === table.id)?.name ?? "Rate table",
                engagementId: table.engagementId,
                engagementTitle: table.engagementTitle,
                entries: table.entries,
              }))}
              engagements={engagements.map((engagement) => ({ id: engagement.id, title: engagement.title }))}
            />

            <TimeEntryComposer
              workspaceId={workspaceId}
              canWrite={canWriteInvoices}
              staff={staffOptions}
              engagements={engagements.map((engagement) => ({
                id: engagement.id,
                title: engagement.title,
                projectId: engagement.project_id,
              }))}
              deliverables={deliverableOptions}
            />

            {timeEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No time entries logged yet.</p>
            ) : (
              <div className="overflow-x-auto border border-border/60">
                <table className="w-full min-w-[42rem] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-background/70 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="px-3 py-2">Staff</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2">Engagement</th>
                      <th className="px-3 py-2">Deliverable</th>
                      <th className="px-3 py-2">Billable</th>
                      <th className="px-3 py-2">Billing state</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/40 last:border-b-0">
                        <td className="px-3 py-2 text-foreground">
                          {(entry.staff_id && staffNameById.get(entry.staff_id)) ?? "Unknown staff"}
                          {entry.labor_category ? (
                            <span className="block text-xs text-muted-foreground">{entry.labor_category}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{entry.entry_date ?? "N/A"}</td>
                        <td className="px-3 py-2 text-foreground">{Number(entry.hours ?? 0)}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {(entry.engagement_id && engagementTitleById.get(entry.engagement_id)) ?? "Unknown"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.deliverable_id ? deliverableTitleById.get(entry.deliverable_id) ?? "Deliverable" : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{entry.billable === false ? "No" : "Yes"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={entry.billed_line_item_id ? "success" : "warning"}>
                            {entry.billed_line_item_id ? "Billed" : "Unbilled"}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {timeEntries.length === TIME_REGISTER_LIMIT ? (
                  <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    Showing the latest {TIME_REGISTER_LIMIT} entries; older ones exist beyond this view.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </article>
    </section>
  );
}
