"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2 } from "lucide-react";

/**
 * Setting an award's LAPSE DATE after the award already exists.
 *
 * `funding_awards.expenditure_deadline_at` — the date an unspent balance goes
 * back to the funder — shipped write-once. The create form accepted it and no
 * request anywhere could change it afterwards, which meant the entire
 * expenditure-reminder lane built on that column was unreachable for every
 * award already in the database: an agency adopting OpenPlan, or anyone who
 * simply did not know the date on the day they recorded the award, could never
 * get a lapse reminder at all. The column also rendered on no surface, so
 * nobody could confirm what had been recorded even at creation.
 *
 * WHY A DATE INPUT AND NOT A DATETIME. The route takes an ISO instant, but a
 * lapse date is a calendar date in a funding agreement — nobody's award lapses
 * at 14:30. The date is sent as UTC midnight, the same normalization the award
 * creator uses, so a deadline entered here and one entered at creation land on
 * the same instant rather than differing by the author's timezone.
 *
 * CLEARING IS A REAL EDIT, not an absence. An emptied field sends `null`
 * explicitly — "this award has no lapse date" — because leaving the key out
 * means "do not touch it" to the route, and a planner who cleared the box and
 * saw nothing change would reasonably believe the deadline was gone.
 */

/** UTC midnight for a `yyyy-mm-dd`, or null for the empty field. */
export function lapseDateToIsoInstant(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** The `yyyy-mm-dd` a stored instant should show in the input. */
export function isoInstantToLapseDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

export function AwardExpenditureDeadlineControl({
  awardId,
  expenditureDeadlineAt,
  canWrite,
}: {
  awardId: string;
  /**
   * `undefined` means the page did not select the column — a different fact
   * from `null` (no lapse date recorded), and it is disclosed rather than
   * rendered as "none", because "no deadline" is the reassuring reading of a
   * missing projection.
   */
  expenditureDeadlineAt: string | null | undefined;
  /** `programs.write`, the action the PATCH route authorizes on. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => isoInstantToLapseDate(expenditureDeadlineAt));
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  if (expenditureDeadlineAt === undefined) {
    return (
      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
        Lapse date not loaded on this view, so nothing here says whether one is recorded.
      </p>
    );
  }

  async function save() {
    setState({ kind: "saving" });

    try {
      const response = await fetch(`/api/funding-awards/${awardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expenditureDeadlineAt: lapseDateToIsoInstant(draft) }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: string }
        | null;

      if (!response.ok) {
        setState({
          kind: "failed",
          message:
            [payload?.error, payload?.details].filter((part) => typeof part === "string" && part).join(" ") ||
            `The lapse date was not saved (HTTP ${response.status}).`,
        });
        return;
      }

      setState({ kind: "saved" });
      router.refresh();
    } catch (error) {
      setState({
        kind: "failed",
        message:
          error instanceof Error && error.message
            ? `The lapse date could not be sent: ${error.message}`
            : "The lapse date could not be sent, and the reason was not reported.",
      });
    }
  }

  const recorded = isoInstantToLapseDate(expenditureDeadlineAt);
  const saving = state.kind === "saving";

  return (
    <div className="mt-1.5">
      <p className="text-[0.73rem] text-muted-foreground">
        <CalendarClock className="mr-1 inline h-3 w-3" aria-hidden />
        Funds must be spent by{" "}
        {recorded ? (
          <span className="font-semibold text-foreground">{recorded}</span>
        ) : (
          <span>no lapse date recorded — no expenditure reminder will be sent for this award</span>
        )}
      </p>

      {canWrite ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[0.73rem] text-muted-foreground">
            Lapse date
            <input
              type="date"
              aria-label="Award lapse date"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setState({ kind: "idle" });
              }}
              className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving || draft === recorded}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs font-semibold text-foreground transition hover:bg-muted/40 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {saving ? "Saving…" : "Save lapse date"}
          </button>
          {state.kind === "saved" ? (
            <span className="text-[0.73rem] text-muted-foreground">Saved.</span>
          ) : null}
        </div>
      ) : null}

      {state.kind === "failed" ? (
        <p role="alert" className="mt-1.5 text-[0.73rem] text-foreground">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
