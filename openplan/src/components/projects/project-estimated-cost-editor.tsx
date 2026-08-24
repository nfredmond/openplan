"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SourceOption = { id: string; title: string };

type ProjectEstimatedCostEditorProps = {
  projectId: string;
  canWrite: boolean;
  value: {
    amount: number | string | null;
    currency: string | null;
    basisYear: number | null;
    sourceDocumentId: string | null;
    recordedAt: string | null;
  };
  sourceOptions: SourceOption[];
};

function displayCost(amount: number | string, currency: string): string {
  const numeric = typeof amount === "number" ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(numeric)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${currency} ${numeric.toLocaleString()}`;
  }
}

export function ProjectEstimatedCostEditor({
  projectId,
  canWrite,
  value,
  sourceOptions,
}: ProjectEstimatedCostEditorProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(value.amount === null ? "" : String(value.amount));
  const [currency, setCurrency] = useState(value.currency ?? "");
  const [basisYear, setBasisYear] = useState(value.basisYear === null ? "" : String(value.basisYear));
  const [sourceDocumentId, setSourceDocumentId] = useState(value.sourceDocumentId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(estimatedCost: Record<string, unknown> | null) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimatedCost }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the estimate.");
      setMessage(estimatedCost ? "Estimated project cost saved." : "Estimated project cost cleared.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the estimate.");
    } finally {
      setSaving(false);
    }
  }

  const currentSource = sourceOptions.find((option) => option.id === value.sourceDocumentId);

  return (
    <article className="module-section-surface" aria-labelledby="estimated-project-cost-heading">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Project identity</p>
          <h2 id="estimated-project-cost-heading" className="module-section-title">
            Planning-level estimated project cost
          </h2>
          <p className="module-section-description">
            The candidate&apos;s estimated capital or planning cost. This is separate from the
            project-management budget, funding need, and awards below.
          </p>
        </div>
      </div>

      {value.amount !== null && value.currency ? (
        <div className="mt-4 rounded-lg border bg-background/70 p-3 text-sm">
          <p className="font-semibold">{displayCost(value.amount, value.currency)}</p>
          <p className="text-muted-foreground">
            {value.basisYear ? `Basis year ${value.basisYear}. ` : "Basis year not recorded. "}
            {currentSource
              ? `Source: ${currentSource.title}.`
              : value.sourceDocumentId
                ? "The linked source document is not readable in this document list."
                : "No source document linked."}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No planning-level cost estimate is recorded.</p>
      )}

      {canWrite ? (
        <form
          className="mt-4 grid gap-3 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsedAmount = Number.parseFloat(amount);
            void save({
              amount: parsedAmount,
              currency: currency.trim().toUpperCase(),
              basisYear: basisYear ? Number.parseInt(basisYear, 10) : null,
              sourceDocumentId: sourceDocumentId || null,
            });
          }}
        >
          <label className="grid gap-1 text-sm">
            Amount
            <input className="rounded-md border bg-background px-3 py-2" inputMode="decimal" required min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Currency
            <input className="rounded-md border bg-background px-3 py-2 uppercase" required minLength={3} maxLength={3} placeholder="USD" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </label>
          <label className="grid gap-1 text-sm">
            Basis year (optional)
            <input className="rounded-md border bg-background px-3 py-2" type="number" min={1800} max={3000} value={basisYear} onChange={(event) => setBasisYear(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Source document (optional)
            <select className="rounded-md border bg-background px-3 py-2" value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)}>
              <option value="">No document linked</option>
              {sourceOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2 md:col-span-4">
            <button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save estimated cost"}
            </button>
            {value.amount !== null ? (
              <button className="rounded-md border px-3 py-2 text-sm" type="button" disabled={saving} onClick={() => void save(null)}>
                Clear estimate
              </button>
            ) : null}
            {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
          </div>
        </form>
      ) : null}
    </article>
  );
}
