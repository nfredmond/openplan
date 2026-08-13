"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type ClientInvoiceStatusControlProps = {
  workspaceId: string;
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  canWrite: boolean;
};

/**
 * Status lifecycle control for one client invoice: draft → sent → paid, with
 * void as the correction path from any live status. Voiding is confirmed with
 * copy that names its real consequence — every time entry billed on the
 * invoice's lines returns to the unbilled pool. The PDF is generated on
 * demand by the server route; the link here never stores anything.
 */
export function ClientInvoiceStatusControl({
  workspaceId,
  invoiceId,
  invoiceNumber,
  status,
  canWrite,
}: ClientInvoiceStatusControlProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  async function transitionTo(nextStatus: "sent" | "paid" | "void") {
    setError(null);
    setSavingStatus(nextStatus);

    try {
      const response = await fetch(`/api/invoicing/client-invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status: nextStatus }),
      });
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to update invoice status");
      }
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update invoice status");
    } finally {
      setSavingStatus(null);
    }
  }

  async function handleVoid() {
    const confirmed = await confirm({
      headline: `Void invoice ${invoiceNumber}?`,
      consequence:
        "It stops counting as a receivable, its number stays claimed, and every time entry billed on its lines returns to the unbilled pool.",
      confirmLabel: "Void this invoice",
      cancelLabel: "Leave it as it is",
    });
    if (!confirmed) {
      return;
    }
    void transitionTo("void");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/api/invoicing/client-invoices/${invoiceId}/pdf`}
        className="openplan-inline-label"
        download
      >
        Download PDF
      </a>

      {canWrite && status === "draft" ? (
        <button
          type="button"
          className="openplan-inline-label"
          disabled={savingStatus !== null}
          onClick={() => void transitionTo("sent")}
        >
          {savingStatus === "sent" ? "Marking sent…" : "Mark sent"}
        </button>
      ) : null}

      {canWrite && status === "sent" ? (
        <button
          type="button"
          className="openplan-inline-label"
          disabled={savingStatus !== null}
          onClick={() => void transitionTo("paid")}
        >
          {savingStatus === "paid" ? "Marking paid…" : "Mark paid"}
        </button>
      ) : null}

      {canWrite && status !== "void" ? (
        <button
          type="button"
          className="openplan-inline-label openplan-inline-label-muted"
          disabled={savingStatus !== null}
          onClick={() => void handleVoid()}
        >
          {savingStatus === "void" ? "Voiding…" : "Void…"}
        </button>
      ) : null}

      {error ? <span className="text-xs text-red-700 dark:text-red-300">{error}</span> : null}
      {confirmDialog}
    </div>
  );
}
