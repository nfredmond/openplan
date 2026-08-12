"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

/**
 * The caller for `GET /api/funding-awards/[awardId]/drawdown-worksheet`.
 *
 * The worksheet route shipped with no caller anywhere in the product — the
 * eighth instance of this repo's most expensive recurring defect, and caught
 * here by `every-api-route-has-a-caller.test.ts` rather than by a planner
 * wondering where their reimbursement packet was. This control is that caller,
 * and it lives on the per-award row of the project funding lane because that is
 * where the award's claim position is already displayed: the packet is the
 * printable form of the numbers immediately above it.
 *
 * WHY THIS IS A FETCH AND NOT A LINK. The obvious wiring is an `<a href>`, and
 * the crash export beside it in this codebase does exactly that. It is wrong
 * here. This route refuses in two cases that matter — the invoice register is
 * unreadable (500) or has not been migrated onto this deployment yet (503) —
 * and it refuses precisely because rendering a worksheet showing $0 claimed
 * against a $250,000 award would state a database outage as a financial fact.
 * A plain link throws away that care: the browser navigates away from the
 * project page and paints `{"error":"…"}` as raw text. So the response is
 * fetched, and the route's own sentence is shown in place, next to the award it
 * concerns. The refusal IS the explanation — the same posture the award
 * close-out control takes toward its 422.
 *
 * THIS COMPONENT COMPUTES NO MONEY. It sends an award id, a workspace id and an
 * optional period, and receives a PDF. Every figure on that PDF is built by
 * `buildAwardDrawdownLedger` on the server from recorded rows. There is
 * deliberately no client-side total here to reassure anyone before the download
 * — a second arithmetic path is a second answer, and the one thing worse than
 * no worksheet is two that disagree.
 */

/** The period bounds, empty string meaning "not set" — the route omits an absent bound. */
type PeriodDraft = { start: string; end: string };

type DownloadState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "failed"; message: string };

/**
 * The download filename the route asked for, or null if it did not name one.
 *
 * Read off `content-disposition` rather than rebuilt here, so the file a planner
 * saves is named by the same code that named it in the audit log. Anything with
 * a path separator is rejected outright: a filename is a leaf name, and a
 * response header is not a trusted source for one.
 */
export function worksheetFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header) ?? /filename=([^;]+)/.exec(header);
  const candidate = match?.[1]?.trim();
  if (!candidate) return null;
  if (candidate.includes("/") || candidate.includes("\\")) return null;
  return candidate;
}

/**
 * The query the route parses back. Bounds are sent only when set, because the
 * route distinguishes "no period" (the whole award to date) from a bounded one,
 * and an empty string is neither.
 */
export function worksheetRequestPath(params: {
  awardId: string;
  workspaceId: string;
  period: PeriodDraft;
}): string {
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.period.start) search.set("periodStart", params.period.start);
  if (params.period.end) search.set("periodEnd", params.period.end);
  return `/api/funding-awards/${params.awardId}/drawdown-worksheet?${search.toString()}`;
}

/**
 * Pulls the route's own refusal sentence out of an error response.
 *
 * A generic "download failed" would hide the difference between "this
 * deployment has not run the migration" and "the read broke", which are the two
 * things the planner needs to tell apart. The status-based fallbacks exist only
 * for a response with no parseable body.
 */
async function readRefusal(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const message = (body as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // Falls through to the status-shaped message below.
  }

  if (response.status === 401 || response.status === 403) {
    return "You do not have access to this award's reimbursement worksheet.";
  }
  if (response.status === 404) {
    return "This funding award could not be found.";
  }
  return "The reimbursement worksheet could not be generated.";
}

export function ReimbursementWorksheetDownload({
  awardId,
  workspaceId,
}: {
  awardId: string;
  /**
   * Required, never defaulted. The route answers 404 on a workspace mismatch, so
   * a caller that forgot this prop would produce a control that always fails
   * with "award not found" — a wiring bug wearing the costume of missing data.
   */
  workspaceId: string;
}) {
  const [period, setPeriod] = useState<PeriodDraft>({ start: "", end: "" });
  const [state, setState] = useState<DownloadState>({ kind: "idle" });

  async function requestWorksheet() {
    setState({ kind: "working" });

    try {
      const response = await fetch(worksheetRequestPath({ awardId, workspaceId, period }));

      if (!response.ok) {
        setState({ kind: "failed", message: await readRefusal(response) });
        return;
      }

      const blob = await response.blob();
      const filename =
        worksheetFilenameFromDisposition(response.headers.get("content-disposition")) ??
        "reimbursement-worksheet.pdf";

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setState({ kind: "idle" });
    } catch (error) {
      setState({
        kind: "failed",
        message:
          error instanceof Error && error.message
            ? `The reimbursement worksheet could not be generated: ${error.message}`
            : "The reimbursement worksheet could not be generated.",
      });
    }
  }

  const working = state.kind === "working";

  return (
    <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Reimbursement worksheet
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        A PDF of this award&apos;s claim position — awarded, claimed, paid and remaining — built from
        the invoice records linked to it, with the project&apos;s costs for the period listed
        underneath. Prepared as supporting work for your own reimbursement request; it is not your
        funder&apos;s form.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Costs from
          <input
            type="date"
            value={period.start}
            onChange={(event) => setPeriod((current) => ({ ...current, start: event.target.value }))}
            className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Costs to
          <input
            type="date"
            value={period.end}
            onChange={(event) => setPeriod((current) => ({ ...current, end: event.target.value }))}
            className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>

        <button
          type="button"
          onClick={requestWorksheet}
          disabled={working}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted/40 disabled:opacity-50"
        >
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {working ? "Preparing worksheet…" : "Download worksheet (PDF)"}
        </button>
      </div>

      {/*
        This said "only the itemised costs follow the period", which was false:
        `selectWorksheetInvoiceLines` scopes the INVOICE TABLE by the period as
        well, and drops any invoice carrying no date. A planner who set a period
        got a shorter invoice list than the sentence promised, with nothing on
        screen accounting for the difference.
      */}
      <p className="mt-2 text-xs text-muted-foreground">
        Leave both dates empty for every recorded cost to date. The award totals always cover the
        whole award; the itemised costs and the invoice list both follow the period, and an invoice
        with no date on it is left out and counted in the packet.
      </p>

      {state.kind === "failed" ? (
        <p
          role="alert"
          className="mt-3 rounded-md border-l-2 border-[color:var(--copper)] bg-muted/30 px-3 py-2 text-sm text-foreground"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
