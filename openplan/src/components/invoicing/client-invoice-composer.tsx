"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  computeLineItemAmount,
  summarizeClientInvoiceTotals,
} from "@/lib/invoicing/receivables";
import {
  groupUnbilledTime,
  resolveHourlyRate,
  type RateEntryLike,
  type TimeEntryLike,
} from "@/lib/invoicing/time-billing";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type InvoiceClientOption = { id: string; name: string };
export type InvoiceEngagementOption = {
  id: string;
  clientId: string;
  projectId: string | null;
  title: string;
  notToExceedAmount: number | null;
};
export type InvoiceProjectOption = { id: string; name: string };
export type InvoiceDeliverableOption = { id: string; projectId: string; title: string };
export type InvoiceRateTableOption = {
  id: string;
  engagementId: string | null;
  entries: Array<{ laborCategory: string; hourlyRate: number }>;
};
export type InvoiceStaffOption = { id: string; name: string };

type ClientInvoiceComposerProps = {
  workspaceId: string;
  canWrite: boolean;
  clients: InvoiceClientOption[];
  engagements: InvoiceEngagementOption[];
  projects: InvoiceProjectOption[];
  deliverables: InvoiceDeliverableOption[];
  rateTables: InvoiceRateTableOption[];
  staff: InvoiceStaffOption[];
};

type LineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitLabel: string;
  unitAmount: string;
  amount: string;
  deliverableId: string;
  sourceTimeEntryIds: string[];
  /** True for pulled time whose labor category resolved no rate: a manual amount is REQUIRED. */
  needsRate: boolean;
};

let lineKeyCounter = 0;
function nextLineKey(): string {
  lineKeyCounter += 1;
  return `line-${lineKeyCounter}`;
}

function emptyLine(): LineDraft {
  return {
    key: nextLineKey(),
    description: "",
    quantity: "",
    unitLabel: "",
    unitAmount: "",
    amount: "",
    deliverableId: "",
    sourceTimeEntryIds: [],
    needsRate: false,
  };
}

function lineAmountPreview(line: LineDraft): number {
  return computeLineItemAmount({
    quantity: line.quantity || null,
    unit_amount: line.unitAmount || null,
    amount: line.amount || null,
  });
}

/**
 * Composer for a client invoice: pick the client (and optionally engagement
 * and project), write line items with live totals, or pull the engagement's
 * unbilled time into draft lines.
 *
 * Rates are only ever looked up — the engagement's rate table first, then the
 * workspace default. Pulled time whose labor category resolves no rate comes
 * in flagged, and this composer refuses to submit until each such line gets a
 * manual amount. The server recomputes every amount and total; the previews
 * here use the same pure helpers so the numbers cannot drift.
 */
export function ClientInvoiceComposer({
  workspaceId,
  canWrite,
  clients,
  engagements,
  projects,
  deliverables,
  rateTables,
  staff,
}: ClientInvoiceComposerProps) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("0");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineDraft[]>([emptyLine()]);
  const [rateSourceNotes, setRateSourceNotes] = useState<string[]>([]);
  const [pullNotice, setPullNotice] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nteNotice, setNteNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const visibleEngagements = useMemo(
    () => engagements.filter((engagement) => !clientId || engagement.clientId === clientId),
    [engagements, clientId]
  );
  const selectedEngagement = visibleEngagements.find((engagement) => engagement.id === engagementId) ?? null;
  const visibleDeliverables = useMemo(
    () => deliverables.filter((deliverable) => projectId && deliverable.projectId === projectId),
    [deliverables, projectId]
  );

  const totals = useMemo(
    () =>
      summarizeClientInvoiceTotals(
        lineItems.map((line) => ({
          quantity: line.quantity || null,
          unit_amount: line.unitAmount || null,
          amount: line.amount || null,
        })),
        retentionPercent || 0
      ),
    [lineItems, retentionPercent]
  );

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLineItems((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLineItems((current) => {
      const remaining = current.filter((line) => line.key !== key);
      return remaining.length > 0 ? remaining : [emptyLine()];
    });
  }

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setEngagementId("");
  }

  function handleEngagementChange(nextEngagementId: string) {
    setEngagementId(nextEngagementId);
    const engagement = engagements.find((candidate) => candidate.id === nextEngagementId) ?? null;
    if (engagement?.projectId) {
      setProjectId(engagement.projectId);
    }
    if (engagement && !clientId) {
      setClientId(engagement.clientId);
    }
  }

  async function handlePullUnbilledTime() {
    if (!engagementId) {
      return;
    }
    setPullNotice(null);
    setError(null);
    setIsPulling(true);

    try {
      const response = await fetch(
        `/api/invoicing/time-entries?workspaceId=${workspaceId}&engagementId=${engagementId}&unbilled=1`
      );
      const payload = (await response.json()) as {
        timeEntries?: TimeEntryLike[];
        hasMore?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load unbilled time");
      }

      // A second pull must not re-draft hours already sitting in this
      // composer's lines — the server would 409 the duplicate ids, but the
      // honest UX is to never offer the same hours twice.
      const alreadyPulledIds = new Set(
        lineItems.flatMap((line) => line.sourceTimeEntryIds ?? [])
      );
      const entries = (payload.timeEntries ?? []).filter(
        (entry) => !alreadyPulledIds.has(String(entry.id))
      );
      if (entries.length === 0) {
        setPullNotice(
          alreadyPulledIds.size > 0
            ? "Every unbilled entry on this engagement is already drafted below."
            : "No unbilled billable time on this engagement."
        );
        return;
      }

      const engagementRateEntries: RateEntryLike[] = rateTables
        .filter((table) => table.engagementId === engagementId)
        .flatMap((table) =>
          table.entries.map((entry) => ({ labor_category: entry.laborCategory, hourly_rate: entry.hourlyRate }))
        );
      const defaultRateEntries: RateEntryLike[] = rateTables
        .filter((table) => table.engagementId === null)
        .flatMap((table) =>
          table.entries.map((entry) => ({ labor_category: entry.laborCategory, hourly_rate: entry.hourlyRate }))
        );
      const staffNamesById = Object.fromEntries(staff.map((member) => [member.id, member.name]));

      const drafts = groupUnbilledTime(entries, {
        by: "staff_category",
        engagementRateEntries,
        defaultRateEntries,
        staffNamesById,
      });

      // Disclose where each labor category's rate came from — or that none
      // was found. A rate is never invented client-side or server-side.
      const categories = Array.from(
        new Set(
          entries
            .map((entry) => (typeof entry.labor_category === "string" ? entry.labor_category.trim() : ""))
            .filter((category) => category.length > 0)
        )
      );
      const sourceNotes = categories.map((category) => {
        const resolved = resolveHourlyRate({
          laborCategory: category,
          engagementRateEntries,
          defaultRateEntries,
        });
        if (resolved.source === "engagement_table") {
          return `${category} — ${formatCurrency(resolved.rate ?? 0)}/hour from the engagement rate table`;
        }
        if (resolved.source === "default_table") {
          return `${category} — ${formatCurrency(resolved.rate ?? 0)}/hour from the workspace default rate table`;
        }
        return `${category} — no rate found in any table; enter the amount manually`;
      });
      if (entries.some((entry) => !entry.labor_category || !String(entry.labor_category).trim())) {
        sourceNotes.push("Uncategorized time — no labor category, so no rate; enter the amount manually");
      }
      setRateSourceNotes(sourceNotes);

      const pulledLines: LineDraft[] = drafts.map((draft) => ({
        key: nextLineKey(),
        description: draft.description,
        quantity: String(draft.quantity),
        unitLabel: draft.unit_label,
        unitAmount: draft.unit_amount != null ? String(draft.unit_amount) : "",
        amount: draft.unit_amount == null && draft.amount != null ? String(draft.amount) : "",
        deliverableId: "",
        sourceTimeEntryIds: draft.sourceTimeEntryIds,
        needsRate: draft.needsRate,
      }));

      setLineItems((current) => {
        const kept = current.filter(
          (line) => line.description.trim() || line.amount || line.unitAmount || line.quantity
        );
        return [...kept, ...pulledLines];
      });
      setPullNotice(
        `${drafts.length} draft line${drafts.length === 1 ? "" : "s"} pulled from ${entries.length} unbilled time entr${entries.length === 1 ? "y" : "ies"}.` +
          (payload.hasMore
            ? " Only the first 500 unbilled entries were loaded — invoice these, then pull again for the rest."
            : "")
      );
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : "Failed to load unbilled time");
    } finally {
      setIsPulling(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setNteNotice(null);

    const activeLines = lineItems.filter(
      (line) => line.description.trim() || line.amount || line.unitAmount || line.quantity || line.sourceTimeEntryIds.length > 0
    );
    if (activeLines.length === 0) {
      setError("Add at least one line item before saving the invoice.");
      return;
    }
    if (activeLines.some((line) => !line.description.trim())) {
      setError("Every line item needs a description.");
      return;
    }

    const ratelessWithoutAmount = activeLines.filter((line) => {
      if (!line.needsRate) return false;
      const parsed = Number.parseFloat(line.amount);
      return !(Number.isFinite(parsed) && parsed >= 0 && line.amount.trim() !== "");
    });
    if (ratelessWithoutAmount.length > 0) {
      setError(
        "Enter a manual amount for every pulled line without a rate — rates are never invented, so those hours have no price until you set one."
      );
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/invoicing/client-invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId,
          engagementId: engagementId || undefined,
          projectId: projectId || undefined,
          invoiceNumber,
          invoiceDate: invoiceDate || undefined,
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
          dueDate: dueDate || undefined,
          retentionPercent: retentionPercent === "" ? undefined : Number(retentionPercent),
          paymentTerms: paymentTerms || undefined,
          notes: notes || undefined,
          lineItems: activeLines.map((line) => ({
            description: line.description.trim(),
            quantity: line.quantity === "" ? undefined : Number(line.quantity),
            unitLabel: line.unitLabel || undefined,
            unitAmount: line.unitAmount === "" ? undefined : Number(line.unitAmount),
            amount: line.amount === "" ? undefined : Number(line.amount),
            deliverableId: line.deliverableId || undefined,
            sourceTimeEntryIds: line.sourceTimeEntryIds.length > 0 ? line.sourceTimeEntryIds : undefined,
          })),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        details?: string;
        nteWarning?: { billedToDate: number; notToExceed: number; overBy: number };
      };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to save client invoice");
      }

      if (payload.nteWarning) {
        setNteNotice(
          `This invoice takes the engagement to ${formatCurrency(payload.nteWarning.billedToDate)} billed against its ${formatCurrency(payload.nteWarning.notToExceed)} not-to-exceed — ${formatCurrency(payload.nteWarning.overBy)} over. Recorded as a warning; nothing was blocked.`
        );
      }

      setInvoiceNumber("");
      setInvoiceDate("");
      setPeriodStart("");
      setPeriodEnd("");
      setDueDate("");
      setNotes("");
      setLineItems([emptyLine()]);
      setRateSourceNotes([]);
      setPullNotice(null);
      setMessage("Client invoice saved as draft.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save client invoice");
    } finally {
      setIsSaving(false);
    }
  }

  if (!canWrite) {
    return (
      <article className="border border-border/70 bg-background/70 px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Members can review client invoices; owner or admin role is required to compose new ones.
        </p>
      </article>
    );
  }

  return (
    <article className="border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.86),rgba(11,18,26,0.96))]">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="flex items-start gap-3 border-b border-border/60 pb-4">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center border border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700/30 dark:text-emerald-300">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Client invoice</p>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Compose a client invoice</h2>
            </div>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Draft an invoice to one of this workspace&apos;s clients — line by line, or pulled from the engagement&apos;s unbilled time ledger.
          </p>

          <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="client-invoice-client" className="text-sm font-medium">
                  Client
                </label>
                <select
                  id="client-invoice-client"
                  className="module-select"
                  value={clientId}
                  onChange={(event) => handleClientChange(event.target.value)}
                  required
                >
                  <option value="">Choose a client</option>
                  {clients.map((clientOption) => (
                    <option key={clientOption.id} value={clientOption.id}>
                      {clientOption.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-engagement" className="text-sm font-medium">
                  Engagement
                </label>
                <select
                  id="client-invoice-engagement"
                  className="module-select"
                  value={engagementId}
                  onChange={(event) => handleEngagementChange(event.target.value)}
                >
                  <option value="">No linked engagement</option>
                  {visibleEngagements.map((engagement) => (
                    <option key={engagement.id} value={engagement.id}>
                      {engagement.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-project" className="text-sm font-medium">
                  Project link
                </label>
                <select
                  id="client-invoice-project"
                  className="module-select"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">No linked project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="client-invoice-number" className="text-sm font-medium">
                  Invoice number
                </label>
                <Input
                  id="client-invoice-number"
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="INV-2026-001"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-date" className="text-sm font-medium">
                  Invoice date
                </label>
                <Input id="client-invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-due-date" className="text-sm font-medium">
                  Due date
                </label>
                <Input id="client-invoice-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="client-invoice-period-start" className="text-sm font-medium">
                  Period start
                </label>
                <Input id="client-invoice-period-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-period-end" className="text-sm font-medium">
                  Period end
                </label>
                <Input id="client-invoice-period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-retention" className="text-sm font-medium">
                  Retention %
                </label>
                <Input
                  id="client-invoice-retention"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={retentionPercent}
                  onChange={(event) => setRetentionPercent(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3 border border-border/60 bg-background/70 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Line items</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="openplan-inline-label"
                    onClick={() => setLineItems((current) => [...current, emptyLine()])}
                  >
                    Add line
                  </button>
                  <button
                    type="button"
                    className="openplan-inline-label"
                    disabled={!engagementId || isPulling}
                    onClick={() => void handlePullUnbilledTime()}
                  >
                    {isPulling ? "Pulling…" : "Pull unbilled time"}
                  </button>
                </div>
              </div>
              {!engagementId ? (
                <p className="text-xs text-muted-foreground">
                  Choose an engagement to pull its unbilled time into draft lines.
                </p>
              ) : null}
              {pullNotice ? <p className="text-xs text-muted-foreground">{pullNotice}</p> : null}
              {rateSourceNotes.length > 0 ? (
                <div className="border-l-2 border-sky-300/80 bg-sky-50/80 px-3 py-2 text-xs text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100">
                  <p className="font-semibold">Rate sources</p>
                  <ul className="mt-1 space-y-0.5">
                    {rateSourceNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ul className="space-y-3">
                {lineItems.map((line, index) => (
                  <li
                    key={line.key}
                    className={`space-y-2 border px-3 py-3 ${
                      line.needsRate
                        ? "border-amber-300/80 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/15"
                        : "border-border/50 bg-background/80"
                    }`}
                  >
                    <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                      <div className="space-y-1">
                        <label htmlFor={`line-description-${line.key}`} className="text-xs font-medium">
                          Description (line {index + 1})
                        </label>
                        <Input
                          id={`line-description-${line.key}`}
                          value={line.description}
                          onChange={(event) => updateLine(line.key, { description: event.target.value })}
                          placeholder="Task, deliverable, or labor line"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`line-quantity-${line.key}`} className="text-xs font-medium">
                          Quantity
                        </label>
                        <Input
                          id={`line-quantity-${line.key}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`line-unit-amount-${line.key}`} className="text-xs font-medium">
                          Unit rate
                        </label>
                        <Input
                          id={`line-unit-amount-${line.key}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitAmount}
                          onChange={(event) => updateLine(line.key, { unitAmount: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`line-amount-${line.key}`} className="text-xs font-medium">
                          Amount
                        </label>
                        <Input
                          id={`line-amount-${line.key}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.amount}
                          onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                          placeholder={line.needsRate ? "Required — no rate found" : "Or quantity × rate"}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Deliverable for line ${index + 1}`}
                          className="module-select max-w-56"
                          value={line.deliverableId}
                          onChange={(event) => updateLine(line.key, { deliverableId: event.target.value })}
                          disabled={visibleDeliverables.length === 0}
                        >
                          <option value="">
                            {visibleDeliverables.length === 0 ? "No project deliverables" : "No linked deliverable"}
                          </option>
                          {visibleDeliverables.map((deliverable) => (
                            <option key={deliverable.id} value={deliverable.id}>
                              {deliverable.title}
                            </option>
                          ))}
                        </select>
                        {line.sourceTimeEntryIds.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            From {line.sourceTimeEntryIds.length} time entr{line.sourceTimeEntryIds.length === 1 ? "y" : "ies"} — saving stamps them billed.
                          </span>
                        ) : null}
                        {line.needsRate ? (
                          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                            No rate found — enter the amount manually.
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(lineAmountPreview(line))}</span>
                        <button
                          type="button"
                          className="openplan-inline-label openplan-inline-label-muted"
                          onClick={() => removeLine(line.key)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="client-invoice-terms" className="text-sm font-medium">
                  Payment terms
                </label>
                <Input
                  id="client-invoice-terms"
                  value={paymentTerms}
                  onChange={(event) => setPaymentTerms(event.target.value)}
                  placeholder="Net 30"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="client-invoice-notes" className="text-sm font-medium">
                  Notes
                </label>
                <Textarea
                  id="client-invoice-notes"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>

            {message ? (
              <p className="border-l-2 border-emerald-400 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
                {message}
              </p>
            ) : null}

            {nteNotice ? (
              <p className="border-l-2 border-amber-400 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                {nteNotice}
              </p>
            ) : null}

            {error ? (
              <p className="border-l-2 border-red-400 bg-red-50/80 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Saves as a draft; send it from the register when it is ready.
              </p>
              <Button type="submit" disabled={isSaving} className="sm:min-w-44">
                {isSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving invoice…
                  </span>
                ) : (
                  "Save client invoice"
                )}
              </Button>
            </div>
          </form>
        </div>

        <aside className="border border-border/60 bg-background/70 px-4 py-4" aria-live="polite">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoice totals</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Live from the line items and retention — the server recomputes the same math on save.
          </p>
          <dl className="mt-4 space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
              <dt>Subtotal</dt>
              <dd className="font-semibold text-foreground">{formatCurrency(totals.subtotalAmount)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
              <dt>Retention ({totals.retentionPercent.toFixed(2)}%)</dt>
              <dd className="font-semibold text-foreground">{formatCurrency(totals.retentionAmount)}</dd>
            </div>
            <div className="space-y-1 pt-1">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoice total</dt>
              <dd className="text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(totals.totalAmount)}</dd>
            </div>
          </dl>
          {selectedEngagement?.notToExceedAmount != null ? (
            <p className="mt-5 border-l-2 border-[color:var(--pine)] bg-[color:var(--pine)]/6 px-3 py-3 text-sm text-foreground">
              {selectedEngagement.title} carries a {formatCurrency(selectedEngagement.notToExceedAmount)} not-to-exceed.
              Billing past it records a warning on save — it never blocks.
            </p>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
