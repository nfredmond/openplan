"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionFeedback } from "@/components/ui/action-feedback";

/**
 * Inline form that records a direct-cost entry in the project spend ledger
 * (POST /api/projects/[projectId]/spend-entries). Attribution to a
 * deliverable is optional — an unattributed entry still counts at the
 * project level.
 */
export function ProjectSpendEntryForm({
  projectId,
  deliverableOptions,
}: {
  projectId: string;
  deliverableOptions: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [vendorLabel, setVendorLabel] = useState("");
  const [deliverableId, setDeliverableId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError("Enter the amount spent as a non-negative number.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/spend-entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          description,
          entryDate: entryDate || undefined,
          vendorLabel: vendorLabel || undefined,
          deliverableId: deliverableId || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to record spend entry");
      }

      setAmount("");
      setDescription("");
      setEntryDate("");
      setVendorLabel("");
      setDeliverableId("");
      setMessage("Spend entry recorded.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to record spend entry");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <ReceiptText className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Spend ledger</p>
          <h3 className="text-sm font-semibold text-foreground">Record project spend</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct costs such as subconsultant charges or expenses. Attributing a deliverable is optional.
          </p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Amount</label>
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1250.00" required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Entry date</label>
            <Input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Description</label>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Traffic counts subconsultant, June progress"
            required
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Vendor</label>
            <Input value={vendorLabel} onChange={(event) => setVendorLabel(event.target.value)} placeholder="Optional vendor or subconsultant" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Deliverable</label>
            <select
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={deliverableId}
              onChange={(event) => setDeliverableId(event.target.value)}
            >
              <option value="">Project level (no deliverable)</option>
              {deliverableOptions.map((deliverable) => (
                <option key={deliverable.id} value={deliverable.id}>
                  {deliverable.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
          Record spend
        </Button>
        {/* One renderer for every save outcome in the product — and the roles
            it carries are why a screen reader now hears this one at all. */}
        <ActionFeedback state={{ busy: isSubmitting, error, details: null, message }} />
      </form>
    </article>
  );
}
