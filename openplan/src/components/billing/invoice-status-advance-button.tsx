"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function InvoiceStatusAdvanceButton({
  invoiceId,
  workspaceId,
  currentStatus,
  canWrite,
}: {
  invoiceId: string;
  workspaceId: string;
  currentStatus: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const nextStatus = nextStatusForInvoice(currentStatus);
  const actionLabel = actionLabelForInvoice(currentStatus);

  async function handleAdvance() {
    if (!canWrite || !nextStatus) return;

    setError(null);
    setMessage(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/billing/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          status: nextStatus,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to advance invoice status");
      }

      setMessage(`Invoice moved to ${nextStatus.replace(/[_-]+/g, " ")}.`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to advance invoice status");
    } finally {
      setIsSaving(false);
    }
  }

  if (!canWrite || !nextStatus || !actionLabel) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void handleAdvance()} disabled={isSaving}>
        {isSaving ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Updating…
          </span>
        ) : (
          actionLabel
        )}
      </Button>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
