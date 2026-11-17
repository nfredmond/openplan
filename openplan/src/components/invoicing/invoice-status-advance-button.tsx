"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { browserToday } from "@/lib/time/workspace-calendar";

/**
 * The next step for a reimbursement request. The database allows only forward
 * moves, paid only after approval, and rejected only from submitted or
 * approved (20261117000100), so this control offers exactly those.
 */
function nextStatusForInvoice(status: string): string | null {
  switch (status) {
    case "draft":
      return "internal_review";
    case "internal_review":
      return "submitted";
    case "submitted":
      return "approved_for_payment";
    case "approved_for_payment":
      return "paid";
    default:
      return null;
  }
}

function actionLabelForInvoice(status: string): string | null {
  switch (status) {
    case "draft":
      return "Move to internal review";
    case "internal_review":
      return "Mark submitted";
    case "submitted":
      return "Mark approved for payment";
    case "approved_for_payment":
      return "Mark paid";
    default:
      return null;
  }
}

/** Rejected and paid are final; only a submitted or approved request can be returned. */
function canMarkInvoiceRejected(status: string): boolean {
  return status === "submitted" || status === "approved_for_payment";
}

/**
 * Where a rejected request is resubmitted: the register's composer, prefilled
 * with the number plus a letter and linked to the request it replaces.
 */
function resubmitInvoiceHref(invoiceId: string): string {
  return `/invoicing?resubmit=${encodeURIComponent(invoiceId)}#record-invoice`;
}

type Mode = "idle" | "paid" | "rejected";

export function InvoiceStatusAdvanceButton({
  invoiceId,
  workspaceId,
  currentStatus,
  canWrite,
  canResubmit = false,
}: {
  invoiceId: string;
  workspaceId: string;
  currentStatus: string;
  canWrite: boolean;
  /** A rejected request on an award, with no resubmission yet. */
  canResubmit?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [paidDate, setPaidDate] = useState("");
  const [reason, setReason] = useState("");

  const nextStatus = nextStatusForInvoice(currentStatus);
  const actionLabel = actionLabelForInvoice(currentStatus);
  const canReject = canMarkInvoiceRejected(currentStatus);

  async function send(body: Record<string, unknown>, done: string) {
    setError(null);
    setMessage(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/invoicing/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, ...body }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to update the request");
      setMessage(done);
      setMode("idle");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update the request");
    } finally {
      setIsSaving(false);
    }
  }

  if (!canWrite) return null;

  if (currentStatus === "rejected") {
    return canResubmit ? (
      <Link href={resubmitInvoiceHref(invoiceId)} className="inline-flex items-center text-sm font-semibold text-[color:var(--pine)] hover:underline">
        Resubmit
      </Link>
    ) : null;
  }

  if (!nextStatus || !actionLabel) return null;

  const spinner = (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      Updating…
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              if (nextStatus === "paid") {
                setPaidDate(browserToday());
                setMode("paid");
                return;
              }
              void send({ status: nextStatus }, `Moved to ${nextStatus.replace(/[_-]+/g, " ")}.`);
            }}
          >
            {isSaving ? spinner : actionLabel}
          </Button>
          {canReject ? (
            <Button type="button" variant="ghost" size="sm" disabled={isSaving} onClick={() => setMode("rejected")}>
              Mark rejected
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "paid" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!paidDate) return setError("Enter the payment date.");
            void send({ status: "paid", paidDate }, `Marked paid on ${paidDate}.`);
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground" htmlFor={`paid-date-${invoiceId}`}>
            Payment date
            <Input id={`paid-date-${invoiceId}`} type="date" required value={paidDate} max={browserToday()} onChange={(event) => setPaidDate(event.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={isSaving}>{isSaving ? spinner : "Mark paid"}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={isSaving} onClick={() => setMode("idle")}>Cancel</Button>
        </form>
      ) : null}

      {mode === "rejected" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return setError("Enter the reason the funder gave.");
            void send({ status: "rejected", rejectionReason: reason.trim() }, "Marked rejected.");
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground" htmlFor={`reject-reason-${invoiceId}`}>
            Reason the funder gave (required)
            <Textarea id={`reject-reason-${invoiceId}`} rows={2} maxLength={2000} required value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={isSaving}>{isSaving ? spinner : "Mark rejected"}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={isSaving} onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {message ? <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
