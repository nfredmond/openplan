"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AWARD_CLOSURE_HISTORY_LIMIT,
  readAwardClosureHistory,
  readClosureBasis,
  type AwardClosureHistory,
  type AwardClosureReceipt,
} from "@/lib/grants/award-closure-history";

const eventLabels: Record<AwardClosureReceipt["event"], string> = {
  earned_coverage: "Closed on recorded paid coverage",
  recorded_on_import: "Closure recorded on import",
  reopen: "Reopened",
};
const destinationLabels = { not_started: "Not started", active: "Active", delayed: "Delayed" };

function Receipt({ receipt }: { receipt: AwardClosureReceipt }) {
  const basis = readClosureBasis(receipt);
  return (
    <li className="min-w-0 space-y-2 rounded-lg border border-border/60 p-3 text-xs">
      <p className="font-semibold">{eventLabels[receipt.event]} ({receipt.event})</p>
      <dl className="space-y-1 break-all">
        <div><dt className="inline font-semibold">Retained timestamp: </dt><dd className="inline"><time dateTime={receipt.created_at}>{receipt.created_at}</time></dd></div>
        <div><dt className="inline font-semibold">Receipt ID: </dt><dd className="inline">{receipt.id}</dd></div>
        <div><dt className="inline font-semibold">Revision: </dt><dd className="inline">{receipt.revision_id ?? "Not recorded"}</dd></div>
        <div><dt className="inline font-semibold">Actor ID: </dt><dd className="inline">{receipt.actor_id}</dd></div>
      </dl>
      {basis.kind === "unassessed" ? (
        <p>Retained basis unassessed. Its legacy or malformed shape cannot support a reason, destination or financial summary here.</p>
      ) : (
        <div className="space-y-1 whitespace-pre-wrap break-words">
          <p><strong>{basis.kind === "reopen" ? "Reopen reason" : "Stated close-out basis"}: </strong>{basis.note ?? "Not recorded"}</p>
          {basis.kind === "reopen" ? (
            <p><strong>Selected destination: </strong>{basis.reopenSpendingStatus ? destinationLabels[basis.reopenSpendingStatus] : "Not recorded"}</p>
          ) : (
            <>
              <p><strong>Retained ceiling: </strong>{basis.currency} {basis.ceiling}</p>
              <p><strong>Retained paid amount: </strong>{basis.currency} {basis.paid}</p>
            </>
          )}
          <p><strong>Previous closure basis: </strong>{basis.previousClosure.basis ?? "Not recorded"}</p>
          <p><strong>Previous closure timestamp: </strong>{basis.previousClosure.closedAt ?? "Not recorded"}</p>
          <p><strong>Previous closure note: </strong>{basis.previousClosure.note ?? "Not recorded"}</p>
        </div>
      )}
      <details>
        <summary className="cursor-pointer">Retained basis details</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(receipt.basis, null, 2)}</pre>
      </details>
    </li>
  );
}

type ReadState = { key: string } & (
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "available"; history: AwardClosureHistory }
);

/** Keep history failure separate from current facts and ordinary write controls. */
export function FundingAwardClosureHistory({ awardId, refreshKey }: { awardId: string; refreshKey: string }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReadState | null>(null);
  const key = `${awardId}:${refreshKey}:${attempt}`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setState({ key, kind: "loading" });
      try {
        const response = await fetch(`/api/funding-awards/${awardId}/closure-history`, { cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json();
        const history = response.ok ? readAwardClosureHistory(payload, awardId) : null;
        if (!cancelled) setState(history ? { key, kind: "available", history } : { key, kind: "unavailable" });
      } catch {
        if (!cancelled) setState({ key, kind: "unavailable" });
      }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [awardId, key, open]);

  // A new selection or mutation hides the prior response even before effect cleanup.
  const current = state?.key === key ? state : null;
  return (
    <div className="mt-3 min-w-0">
      <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        {open ? "Hide close and reopen history" : "Close and reopen history"}
      </Button>
      {open ? (
        <section id={panelId} aria-label="Award close and reopen history" className="mt-2 min-w-0 space-y-2">
          <p className="text-xs text-muted-foreground">Retained transition receipts, oldest first. This reader requires all receipts within a {AWARD_CLOSURE_HISTORY_LIMIT}-receipt limit; it shows no partial list. Legacy awards may have no receipts. Receipt amounts describe the retained event, not current balances or spending authorization.</p>
          {!current || current.kind === "loading" ? <p role="status" className="text-xs">Loading award transition history...</p> : null}
          {current?.kind === "unavailable" ? <p role="status" className="text-xs">Award transition history unavailable. No partial history is shown. Current award facts and other controls remain separate.</p> : null}
          {current?.kind === "available" ? current.history.receipts.length ? (
            <ol className="space-y-2">{current.history.receipts.map((receipt) => <Receipt key={receipt.id} receipt={receipt} />)}</ol>
          ) : <p className="text-xs">No retained close or reopen receipts for this award. This does not establish that no earlier transition occurred.</p> : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>Refresh history</Button>
        </section>
      ) : null}
    </div>
  );
}
