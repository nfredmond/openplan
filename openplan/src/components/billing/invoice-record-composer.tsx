"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { computeNetInvoiceAmount, computeRetentionAmount } from "@/lib/billing/invoice-records";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type ProjectOption = {
  id: string;
  name: string;
};

type InvoiceRecordComposerProps = {
  workspaceId: string;
  projects: ProjectOption[];
  canWrite: boolean;
};

export function InvoiceRecordComposer({ workspaceId, projects, canWrite }: InvoiceRecordComposerProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [consultantName, setConsultantName] = useState("Nat Ford");
  const [billingBasis, setBillingBasis] = useState("time_and_materials");
  const [status, setStatus] = useState("draft");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("0");
  const [supportingDocsStatus, setSupportingDocsStatus] = useState("pending");
  const [submittedTo, setSubmittedTo] = useState("");
  const [caltransPosture, setCaltransPosture] = useState("deferred_exact_forms");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const amountValue = Number.parseFloat(amount || "0") || 0;
  const retentionPercentValue = Number.parseFloat(retentionPercent || "0") || 0;

  const retentionAmountPreview = useMemo(
    () => computeRetentionAmount(amountValue, retentionPercentValue),
    [amountValue, retentionPercentValue]
  );
  const netAmountPreview = useMemo(
    () => computeNetInvoiceAmount(amountValue, retentionAmountPreview, retentionPercentValue),
    [amountValue, retentionAmountPreview, retentionPercentValue]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/billing/invoices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          projectId: projectId || undefined,
          invoiceNumber,
          consultantName,
          billingBasis,
          status,
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
          invoiceDate: invoiceDate || undefined,
          dueDate: dueDate || undefined,
          amount: amountValue,
          retentionPercent: retentionPercentValue,
          supportingDocsStatus,
          submittedTo,
          caltransPosture,
          notes,
        }),
      });

      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to save invoice record");
      }

      setProjectId("");
      setInvoiceNumber("");
      setConsultantName("Nat Ford");
      setBillingBasis("time_and_materials");
      setStatus("draft");
      setPeriodStart("");
      setPeriodEnd("");
      setInvoiceDate("");
      setDueDate("");
      setAmount("");
      setRetentionPercent("0");
      setSupportingDocsStatus("pending");
      setSubmittedTo("");
      setCaltransPosture("deferred_exact_forms");
      setNotes("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save invoice record");
    } finally {
      setIsSaving(false);
    }
  }

  if (!canWrite) {
    return (
      <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice entry</p>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Read-only for member role</h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Members can review the invoice register, but owner/admin role is required before OpenPlan will write new consulting invoice records.
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <FileSpreadsheet className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice entry</p>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Log a consulting invoice record</h2>
        </div>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Capture consulting invoice records with retention, backup posture, and workspace/project linkage.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="invoice-number" className="text-sm font-medium">
              Invoice number
            </label>
            <Input id="invoice-number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="OP-2026-001" required />
          </div>
          <div className="space-y-2">
            <label htmlFor="invoice-project" className="text-sm font-medium">
              Project link
            </label>
            <select id="invoice-project" className="module-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Workspace-level / no specific project</option>
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
            <label htmlFor="consultant-name" className="text-sm font-medium">
              Consultant / billing entity
            </label>
            <Input id="consultant-name" value={consultantName} onChange={(event) => setConsultantName(event.target.value)} placeholder="Nat Ford" />
          </div>
          <div className="space-y-2">
            <label htmlFor="billing-basis" className="text-sm font-medium">
              Billing basis
            </label>
            <select id="billing-basis" className="module-select" value={billingBasis} onChange={(event) => setBillingBasis(event.target.value)}>
              <option value="time_and_materials">Time and materials</option>
              <option value="lump_sum">Lump sum</option>
              <option value="cost_plus">Cost plus</option>
              <option value="milestone">Milestone</option>
              <option value="progress_payment">Progress payment</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="invoice-status" className="text-sm font-medium">
              Status
            </label>
            <select id="invoice-status" className="module-select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="draft">Draft</option>
              <option value="internal_review">Internal review</option>
              <option value="submitted">Submitted</option>
              <option value="approved_for_payment">Approved for payment</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <label htmlFor="period-start" className="text-sm font-medium">
              Period start
            </label>
            <Input id="period-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="period-end" className="text-sm font-medium">
              Period end
            </label>
            <Input id="period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="invoice-date" className="text-sm font-medium">
              Invoice date
            </label>
            <Input id="invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="invoice-due-date" className="text-sm font-medium">
              Due date
            </label>
            <Input id="invoice-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label htmlFor="invoice-amount" className="text-sm font-medium">
              Gross amount
            </label>
            <Input id="invoice-amount" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="12500" required />
          </div>
          <div className="space-y-2">
            <label htmlFor="retention-percent" className="text-sm font-medium">
              Retention %
            </label>
            <Input id="retention-percent" type="number" min="0" max="100" step="0.01" value={retentionPercent} onChange={(event) => setRetentionPercent(event.target.value)} />
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm" aria-live="polite">
            <p className="font-medium text-foreground">Net request preview</p>
            <p className="mt-1 text-muted-foreground">Updates live from the gross amount and retention fields so the billing request math is visible before save.</p>
            <dl className="mt-3 space-y-1 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <dt>Gross amount</dt>
                <dd className="font-medium text-foreground">{formatCurrency(amountValue)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Retention ({retentionPercentValue.toFixed(2)}%)</dt>
                <dd className="font-medium text-foreground">{formatCurrency(retentionAmountPreview)}</dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Net request</p>
              <p className="text-base font-semibold text-foreground">{formatCurrency(netAmountPreview)}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label htmlFor="supporting-docs-status" className="text-sm font-medium">
              Backup posture
            </label>
            <select id="supporting-docs-status" className="module-select" value={supportingDocsStatus} onChange={(event) => setSupportingDocsStatus(event.target.value)}>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="complete">Complete</option>
              <option value="accepted">Accepted</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="submitted-to" className="text-sm font-medium">
              Submitted to
            </label>
            <Input id="submitted-to" value={submittedTo} onChange={(event) => setSubmittedTo(event.target.value)} placeholder="Caltrans D3 Local Assistance" />
          </div>
          <div className="space-y-2">
            <label htmlFor="caltrans-posture" className="text-sm font-medium">
              CALTRANS posture
            </label>
            <select id="caltrans-posture" className="module-select" value={caltransPosture} onChange={(event) => setCaltransPosture(event.target.value)}>
              <option value="deferred_exact_forms">Exact forms deferred</option>
              <option value="local_agency_consulting">Local-agency consulting</option>
              <option value="federal_aid_candidate">Federal-aid candidate</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="invoice-notes" className="text-sm font-medium">
            Notes
          </label>
          <Textarea
            id="invoice-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder="Capture supporting-doc gaps, reviewer comments, reimbursement caveats, or why exact LAPM exhibit/form numbers remain deferred."
          />
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving}>
          {isSaving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving invoice record…
            </span>
          ) : (
            "Save invoice record"
          )}
        </Button>
      </form>
    </article>
  );
}
