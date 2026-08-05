"use client";

/**
 * What this project costs in one plan, and which period of that plan pays for it.
 *
 * Without this control the whole fiscal-constraint check is unusable: the
 * migration and the route both accept a programmed cost, and nothing could
 * send one, so every plan in the product would have reported "not determined —
 * constrained projects have no cost recorded" forever. A complete engine no
 * planner can feed is the same defect as a complete feature no planner can
 * reach.
 *
 * The cost lives on the LINK, not on the project, because it is a property of
 * this project's placement in THIS plan. The same project can sit in two
 * cycles, in different periods, at different costs. That is also why the
 * control appears once per linked cycle rather than once on the project.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RtpLinkCostBandOption = {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
};

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function numberToInput(value: number | string | null): string {
  if (value === null || value === undefined) return "";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

export function RtpLinkCostEditor({
  projectId,
  linkId,
  bands,
  initialEstimatedCost,
  initialCostBasisYear,
  initialHorizonBandId,
  canWrite,
}: {
  projectId: string;
  linkId: string;
  /** The periods declared by THIS link's cycle. Empty means the plan has none yet. */
  bands: ReadonlyArray<RtpLinkCostBandOption>;
  initialEstimatedCost: number | string | null;
  initialCostBasisYear: number | null;
  initialHorizonBandId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState(numberToInput(initialEstimatedCost));
  const [costBasisYear, setCostBasisYear] = useState(numberToInput(initialCostBasisYear));
  const [horizonBandId, setHorizonBandId] = useState(initialHorizonBandId ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storedCost = numberToInput(initialEstimatedCost);
  const band = bands.find((option) => option.id === initialHorizonBandId) ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedCost = estimatedCost.trim();
    if (trimmedCost && (!Number.isFinite(Number(trimmedCost)) || Number(trimmedCost) < 0)) {
      setError("A programmed cost must be a number and cannot be negative.");
      return;
    }

    setIsSaving(true);
    try {
      // An emptied field sends null, which means UNPRICED — deliberately not 0.
      // A zero here would make the plan's constrained total look complete while
      // this project's real cost was simply never entered.
      const response = await fetch(`/api/projects/${projectId}/rtp-links`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          linkId,
          estimatedCost: trimmedCost ? Number(trimmedCost) : null,
          costBasisYear: costBasisYear.trim() ? Number(costBasisYear) : null,
          horizonBandId: horizonBandId || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to save this project's programmed cost");

      setIsOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save this project's programmed cost");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {storedCost ? (
            <>
              <span className="font-medium text-foreground">{CURRENCY.format(Number(storedCost))}</span>
              {initialCostBasisYear ? ` in ${initialCostBasisYear} dollars` : null}
              {band ? ` · ${band.label}` : " · no period assigned"}
            </>
          ) : (
            // "Not priced" rather than "$0" — the distinction the whole fiscal
            // check turns on, stated where a planner will act on it.
            "No cost recorded for this plan, so it is not counted in the plan's fiscal constraint."
          )}
        </span>
        {canWrite ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
            {storedCost ? "Edit cost" : "Add cost"}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-[0.5rem] border border-border/60 bg-muted/20 p-3">
      {error ? (
        <p className="rounded-[0.4rem] border border-red-300/80 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`rtp-cost-${linkId}`} className="text-xs font-medium text-foreground">
            Programmed cost in this plan
          </label>
          <Input
            id={`rtp-cost-${linkId}`}
            type="number"
            min="0"
            step="1"
            value={estimatedCost}
            onChange={(event) => setEstimatedCost(event.target.value)}
          />
          <p className="text-[0.7rem] text-muted-foreground">Leave blank if the cost is not known yet.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={`rtp-cost-year-${linkId}`} className="text-xs font-medium text-foreground">
            Cost is in dollars of year
          </label>
          <Input
            id={`rtp-cost-year-${linkId}`}
            type="number"
            value={costBasisYear}
            onChange={(event) => setCostBasisYear(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`rtp-band-${linkId}`} className="text-xs font-medium text-foreground">
          Period of the plan that pays for it
        </label>
        {bands.length === 0 ? (
          <p className="text-[0.7rem] text-muted-foreground">
            This plan has no periods declared yet, so a cost cannot be assigned to one. Add the plan&apos;s
            horizon periods on the plan page first.
          </p>
        ) : (
          <select
            id={`rtp-band-${linkId}`}
            value={horizonBandId}
            onChange={(event) => setHorizonBandId(event.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">No period assigned</option>
            {bands.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} ({option.startYear}–{option.endYear})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save cost
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
