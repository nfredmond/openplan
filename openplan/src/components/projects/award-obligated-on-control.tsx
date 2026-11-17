"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * The date an award was obligated, authorized or allocated
 * (`funding_awards.obligated_on`, 20261117000200). Costs before it are
 * generally not reimbursable, so a request dated earlier draws a warning and
 * the worksheet prints the date. A calendar day, never an instant. Nothing
 * fills it in: a missing date reads "Not recorded".
 */
export function AwardObligatedOnControl({
  awardId,
  obligatedOn,
  canWrite,
}: {
  awardId: string;
  obligatedOn: string | null | undefined;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(obligatedOn ?? "");
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "failed"; message: string }>({ kind: "idle" });

  if (obligatedOn === undefined) return null;

  async function save() {
    setState({ kind: "saving" });
    try {
      const response = await fetch(`/api/funding-awards/${awardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ obligatedOn: draft || null }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; details?: string } | null;
      if (!response.ok) {
        setState({
          kind: "failed",
          message:
            [payload?.error, payload?.details].filter((part) => typeof part === "string" && part).join(" ") ||
            `The obligated date was not saved (HTTP ${response.status}).`,
        });
        return;
      }
      setState({ kind: "saved" });
      router.refresh();
    } catch (error) {
      setState({ kind: "failed", message: error instanceof Error ? error.message : "The obligated date could not be sent." });
    }
  }

  const saving = state.kind === "saving";

  return (
    <div className="mt-1.5">
      <p className="text-label text-muted-foreground">
        Obligated on <span className="font-semibold text-foreground">{obligatedOn ?? "Not recorded"}</span>
      </p>
      {canWrite ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="Date the award was obligated, authorized or allocated"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setState({ kind: "idle" });
            }}
            className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || draft === (obligatedOn ?? "")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs font-semibold text-foreground transition hover:bg-muted/40 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            Save obligated date
          </button>
          {state.kind === "saved" ? <span role="status" className="text-xs text-muted-foreground">Saved.</span> : null}
          {state.kind === "failed" ? <span role="alert" className="text-xs text-destructive">{state.message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
