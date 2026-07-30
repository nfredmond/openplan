"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * FINISHING A CUSTODY PASS THAT RAN OUT OF TIME, from a button rather than a runbook.
 *
 * Custody runs inside the processing callback, where the vendor's download links
 * are known-good but the time budget is short — a large point cloud does not
 * belong inside an HTTP handler. When the budget runs out, the links are still
 * valid and the bytes are still saveable, and `POST
 * /api/aerial/processing-callback/custody` exists to finish the job.
 *
 * IT HAD NO CALLER. The route's own documentation said the member branch existed
 * "so a retry can be a button rather than a runbook", and there was no button —
 * so the only way to save deliverables before their links lapsed was for someone
 * to know the endpoint existed and construct the request by hand. That is the
 * defect class this repo has now shipped ten times, and it is worse here than
 * usual: the window it applies to closes on its own.
 *
 * IT IS OFFERED ONLY WHEN IT CAN HELP. A retry cannot recover an artifact whose
 * source link has already lapsed — those bytes are gone and the honest next step
 * is re-processing, not a button that will fail. The caller decides that from
 * the custody posture (`recoverableCount`), so this control appears only when
 * something is actually still saveable.
 */
export function AerialCustodyRetry({
  processingJobId,
  recoverableCount,
}: {
  processingJobId: string;
  /** Artifacts not held whose source link is still valid. Zero means nothing to do. */
  recoverableCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (recoverableCount < 1) return null;

  async function retry() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/aerial/processing-callback/custody", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processingJobId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; detail?: string }
        | null;

      if (!response.ok) {
        // The route's own sentence, verbatim. It knows things this component
        // does not — that a link lapsed between render and click, that the
        // ceiling was hit, that the bucket refused.
        setError(body?.error ?? "The retry could not be started.");
        return;
      }

      setDone(body?.detail ?? "Custody was attempted again for this job's outputs.");
      // The custody ledger is read server-side; without this the panel keeps
      // showing the posture from before the retry.
      router.refresh();
    } catch {
      setError("Could not reach OpenPlan. Nothing was attempted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void retry()}
        disabled={busy}
        className="rounded-[0.4rem] border border-[color:var(--line)] px-2.5 py-1 text-[0.68rem] font-semibold disabled:opacity-50"
      >
        {busy ? "Saving…" : `Try again to save ${recoverableCount} output${recoverableCount === 1 ? "" : "s"}`}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[0.68rem] text-destructive">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-1 text-[0.68rem] text-muted-foreground">
          {done}
        </p>
      ) : null}
    </div>
  );
}
