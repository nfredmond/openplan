"use client";

/**
 * The revenue-and-cost ledger of an RTP's financial element.
 *
 * Every row here is one line of `rtp_financial_assumptions`: a named source of
 * money, or a named cost, assigned to one horizon band. It is the input side of
 * `buildRtpFiscalConstraint` — the figures a board votes on and a funder
 * verifies are summed from exactly these rows plus the costs of the constrained
 * projects.
 *
 * FIVE THINGS THIS COMPONENT IS DELIBERATE ABOUT, each because getting them
 * wrong produces a plan that looks affordable and is not:
 *
 *   1. **A blank amount is never zero.** An empty amount field is refused with
 *      a sentence, never coerced to `0`. A ledger that quietly reads a blank as
 *      zero understates cost and overstates nothing that anyone would notice.
 *   2. **A subtotal never quietly drops a line it could not read.** The same
 *      rule has to hold for the arithmetic, not only the form: a line whose
 *      stored amount does not parse contributes nothing to its period's
 *      subtotal, so the count of such lines is stated next to the figure rather
 *      than folded into it as a zero. The database forbids the case
 *      (`amount NUMERIC NOT NULL CHECK (amount >= 0)`), which is exactly why a
 *      silent zero here would never be noticed if it ever happened.
 *   3. **Operating and maintaining the system is a cost.** A financial element
 *      holding only capital projects is the commonest way a plan reports itself
 *      affordable, so the absence of any operations-and-maintenance line is
 *      called out in a planner's words rather than left to be noticed.
 *   4. **Which side of the ledger a line is on is visible without reading it.**
 *      Revenue and cost are separated inside every period, and each cost names
 *      its kind, because a misfiled line moves the balance in the wrong
 *      direction by twice its own value.
 *   5. **A line can be moved between periods.** `horizon_band_id` is
 *      ON DELETE RESTRICT, so removing a period that still carries money is
 *      refused and the horizon-band editor tells the planner to move its lines
 *      first. Without a control that does it, that instruction is unactionable
 *      and the period can never be removed — so the edit form carries a period
 *      selector, offering only THIS cycle's bands. The route re-reads the band
 *      filtered by cycle and workspace on every write regardless; the selector
 *      is the reachable path, not the check.
 *
 * Subtotals shown here are the amounts AS ENTERED. The constraint check may
 * restate them in year-of-expenditure dollars when the cycle records an
 * inflation rate, so these figures are labelled rather than presented as the
 * finding.
 *
 * Deleting a line asks first, and names the line and its figure. Every other
 * write here is recoverable by retyping; this one removes money from a
 * financial element a board may already have adopted, and the row is gone.
 *
 * THE ROUTE CONTRACT (`/api/rtp-cycles/{rtpCycleId}/financial-assumptions`),
 * written down because the route is owned by a different change:
 *   POST   { horizonBandId, entryKind, sourceName, amount, amountBasisYear, notes }
 *   PATCH  { assumptionId, horizonBandId, entryKind, sourceName, amount, amountBasisYear, notes }
 *   DELETE { assumptionId }
 * `amountBasisYear` and `notes` are sent as `null` — not omitted — when the
 * planner clears them, because this is an edit and an emptied field means
 * "clear this", not "leave it alone". `horizonBandId` on PATCH is the band the
 * planner chose, which may differ from the line's current one.
 *
 * The currency is formatted as USD, matching the rest of the financial element
 * (`describeRtpFiscalConstraint`). That is a property of this module's current
 * US federal-aid framing, not a global assumption baked into a shared type.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExtractionProvenanceChip } from "@/components/rtp/extraction-provenance-chip";
import {
  transcriptionDocumentHref,
  type TranscriptionRecord,
} from "@/lib/rtp/extraction/display";
import { parseOptionalAmount } from "@/lib/money/optional-amount";
import type { RtpFiscalEntryKind } from "@/lib/rtp/fiscal-constraint";

export type RtpFinancialLedgerBand = {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
};

export type RtpFinancialLedgerLine = {
  id: string;
  horizonBandId: string;
  entryKind: RtpFiscalEntryKind;
  sourceName: string;
  /** NUMERIC arrives as a number or a string depending on the client path. */
  amount: number | string | null;
  amountBasisYear: number | null;
  notes: string | null;
};

export type RtpFinancialLedgerEditorProps = {
  rtpCycleId: string;
  bands: ReadonlyArray<RtpFinancialLedgerBand>;
  lines: ReadonlyArray<RtpFinancialLedgerLine>;
  canWrite: boolean;
  /**
   * Which of these lines were copied out of a document, keyed by line id, so
   * each one can cite its page beside the figure (Nathaniel's Q2 decision,
   * 2026-08-11: provenance everywhere).
   *
   * A line that is not in here was TYPED BY HAND and shows no chip. That is not
   * a gap to fill in later — `extraction_candidate_id IS NULL` means a person
   * entered it, permanently, and there is no backfill anywhere in this feature.
   */
  transcriptions?: Readonly<Record<string, TranscriptionRecord>>;
};

/**
 * Plain language for the three kinds. A `Record` over the union rather than a
 * lookup with a fallback: adding a fourth entry kind must fail the build here
 * rather than render its raw database value to a planner.
 *
 * Declaration order is the order a planner sees, revenue first, because this is
 * also where the select's options come from — the same `Object.keys` trick the
 * route uses to derive its zod enum from this same shape. A fourth kind is then
 * offerable the moment it is nameable, rather than existing in the engine and
 * being unrecordable here.
 */
const ENTRY_KIND_LABELS: Record<RtpFiscalEntryKind, string> = {
  revenue: "Revenue",
  operations_maintenance: "Operations & maintenance",
  other_cost: "Other cost",
};

const ENTRY_KINDS = Object.keys(ENTRY_KIND_LABELS) as RtpFiscalEntryKind[];

/**
 * Everything that is not revenue is a cost, which is how the fiscal engine
 * itself splits them (`buildRtpFiscalConstraint` sends revenue one way and
 * falls through to a cost for everything else). Listing the cost kinds instead
 * would let a kind added later belong to neither column and disappear from the
 * page while still counting against the plan's balance.
 */
function isCostKind(kind: RtpFiscalEntryKind): boolean {
  return kind !== "revenue";
}

/**
 * Money is written WITH cents or WITHOUT them, never with one digit of them.
 *
 * A single formatter carrying `minimumFractionDigits: 0` with
 * `maximumFractionDigits: 2` renders 1000000.5 as "$1,000,000.5" — a figure in
 * an adopted financial element showing half of its cents, which reads as a typo
 * in precisely the document where a reader cannot afford to wonder. It also
 * turns an ordinary floating-point sum (0.1 + 0.2 = 0.30000000000000004) into
 * "$0.3". So the two spellings are separate formatters and the choice is made
 * per figure: a whole number of dollars is written whole, and anything else is
 * written to the cent the ledger column actually stores.
 */
const WHOLE_DOLLAR_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DOLLARS_AND_CENTS_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(value: number): string {
  return Number.isInteger(value)
    ? WHOLE_DOLLAR_FORMATTER.format(value)
    : DOLLARS_AND_CENTS_FORMATTER.format(value);
}

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35";

/** Absent stays absent. `parseOptionalAmount` refuses negatives and blanks. */
function formatAmount(value: number | string | null): string {
  const parsed = parseOptionalAmount(value);
  return parsed === null ? "Not recorded" : formatCurrency(parsed);
}

function amountToInput(value: number | string | null): string {
  const parsed = parseOptionalAmount(value);
  return parsed === null ? "" : String(parsed);
}

function yearToInput(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * A period's subtotal, and how many of its lines the subtotal could not include.
 *
 * `parseOptionalAmount` answers null for an absent, unparseable or negative
 * figure, and `?? 0` on that answer is the same defect this whole module exists
 * to prevent, one layer down: the excluded line disappears into a total that
 * still reads as complete. The count travels with the figure so the surface can
 * say what is missing from it.
 */
type AmountSubtotal = { total: number; unreadableLineCount: number };

function subtotalAmounts(lines: readonly RtpFinancialLedgerLine[]): AmountSubtotal {
  let total = 0;
  let unreadableLineCount = 0;

  for (const line of lines) {
    const parsed = parseOptionalAmount(line.amount);
    if (parsed === null) {
      unreadableLineCount += 1;
      continue;
    }
    total += parsed;
  }

  return { total, unreadableLineCount };
}

/**
 * The subtotal as a figure — or the refusal to state one.
 *
 * The count above is not enough on its own. A period whose ONLY revenue line
 * has no readable amount sums to 0, and "$0" next to the words "Revenue as
 * entered" says something specific and false: that this period expects no
 * money. That is the module's own rule — a blank is not a zero — reappearing
 * one layer up in the arithmetic, and a caveat further down the card does not
 * undo a headline figure a reader has already taken as the answer. When every
 * line a subtotal had was excluded, there is no subtotal, and it says so.
 *
 * A period with NO lines at all is a different thing and still reads "$0":
 * nothing was left out of it.
 */
function formatSubtotal(subtotal: AmountSubtotal, lineCount: number): string {
  if (lineCount > 0 && subtotal.unreadableLineCount === lineCount) return "Not computed";
  return formatCurrency(subtotal.total);
}

type LineDraft = {
  horizonBandId: string;
  entryKind: RtpFiscalEntryKind;
  sourceName: string;
  amount: string;
  amountBasisYear: string;
  notes: string;
};

const EMPTY_DRAFT: LineDraft = {
  horizonBandId: "",
  entryKind: "revenue",
  sourceName: "",
  amount: "",
  amountBasisYear: "",
  notes: "",
};

function draftFromLine(line: RtpFinancialLedgerLine): LineDraft {
  return {
    horizonBandId: line.horizonBandId,
    entryKind: line.entryKind,
    sourceName: line.sourceName,
    amount: amountToInput(line.amount),
    amountBasisYear: yearToInput(line.amountBasisYear),
    notes: line.notes ?? "",
  };
}

/**
 * A non-negative figure written the way money is written: digits, optionally a
 * decimal point, digits. Accepts "1250000", "1250000.75" and ".75"; refuses
 * "1e6", "1,250,000", "$5" and "5." — every spelling `Number()` would happily
 * turn into a figure the planner did not type.
 */
const PLAIN_DECIMAL_AMOUNT = /^(\d+(\.\d+)?|\.\d+)$/;

/**
 * The route's own caps on the two free-text fields
 * (`sourceNameSchema` is `.max(200)`, notes `.max(4000)`). Mirrored onto the
 * inputs so the limit stops the typing rather than arriving as a server
 * refusal after the planner has finished writing.
 */
const SOURCE_NAME_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 4000;

type DraftValidation =
  | { ok: true; sourceName: string; amount: number; amountBasisYear: number | null; notes: string | null }
  | { ok: false; message: string };

/**
 * The blank-is-not-zero rule, in one place so the add form and the edit form
 * cannot drift apart on it.
 */
function validateDraft(draft: LineDraft): DraftValidation {
  const sourceName = draft.sourceName.trim();
  if (!sourceName) {
    return { ok: false, message: "Name the source or the cost, so the ledger says where this money comes from or goes." };
  }

  const rawAmount = draft.amount.trim();
  if (!rawAmount) {
    return {
      ok: false,
      message: "Enter an amount. A blank amount is not zero — a line with no figure would quietly leave money out of the balance.",
    };
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: "The amount must be a number, and cannot be negative." };
  }

  // `amount` is NUMERIC(16, 2). Postgres would round a third decimal place
  // silently, storing a figure the planner never typed into a plan a board
  // adopts — so it is refused here instead, where the original is still on
  // screen to correct.
  //
  // Two refusals rather than one, because a single regex over both cases told
  // a planner who typed "1e6" that they had used too many decimal places,
  // which is a confidently wrong instruction: they had used none. A spelling
  // this ledger cannot read and a figure finer than a cent are different
  // mistakes and are corrected differently.
  if (!PLAIN_DECIMAL_AMOUNT.test(rawAmount)) {
    return {
      ok: false,
      message:
        "Enter the amount as plain digits — for example 1250000 or 1250000.75. Leave out currency symbols, thousands separators, and scientific notation.",
    };
  }

  const [, cents = ""] = rawAmount.split(".");
  if (cents.length > 2) {
    return {
      ok: false,
      message: "Enter the amount in dollars and cents, with at most two decimal places — the ledger records money to the cent.",
    };
  }

  const rawYear = draft.amountBasisYear.trim();
  let amountBasisYear: number | null = null;
  if (rawYear) {
    const year = Number(rawYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return { ok: false, message: "Enter the base year as a four-digit year, or leave it blank to use the plan's base year." };
    }
    amountBasisYear = year;
  }

  return {
    ok: true,
    sourceName,
    amount,
    amountBasisYear,
    notes: draft.notes.trim() || null,
  };
}

export function RtpFinancialLedgerEditor({
  rtpCycleId,
  bands,
  lines,
  canWrite,
  transcriptions,
}: RtpFinancialLedgerEditorProps) {
  const router = useRouter();
  const [addingBandId, setAddingBandId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LineDraft>(EMPTY_DRAFT);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // The error carries the key of the write it belongs to. A refusal reported at
  // the top of a section can sit above the fold while the planner is looking at
  // a form far down the page, waiting for a save that already failed — so it is
  // rendered against the form that caused it, and only a write with no form on
  // screen (a delete) falls back to the top.
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);

  // One write at a time. `pendingKey` holds a single key, so a second write
  // started while the first is in flight would take the spinner with it and
  // leave the first line looking idle while it is still saving.
  const isBusy = pendingKey !== null;

  const bandIds = useMemo(() => new Set(bands.map((band) => band.id)), [bands]);

  const linesByBand = useMemo(() => {
    const grouped = new Map<string, RtpFinancialLedgerLine[]>();
    for (const band of bands) grouped.set(band.id, []);
    for (const line of lines) {
      grouped.get(line.horizonBandId)?.push(line);
    }
    return grouped;
  }, [bands, lines]);

  // A line whose band is not on this page would otherwise vanish silently. The
  // database forbids it (ON DELETE RESTRICT), so this should never fire — say
  // so rather than disappear the money if it ever does.
  const strandedLineCount = lines.filter((line) => !bandIds.has(line.horizonBandId)).length;

  const hasOperationsMaintenance = lines.some((line) => line.entryKind === "operations_maintenance");

  // Closing a form takes its refusal with it. `error` carries the key of the
  // write it belongs to, and a refusal whose form is gone falls back to the
  // banner at the top of the section — so leaving it set made Cancel TELEPORT
  // the sentence a planner had just dismissed to the top of the page, where it
  // reads as a fresh failure of something else. Every caller of this either
  // cancelled the form or completed its write, and a completed write already
  // cleared the error, so clearing here can never hide a live refusal.
  function resetForms() {
    setAddingBandId(null);
    setEditingLineId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  function openAddForm(bandId: string) {
    setError(null);
    setEditingLineId(null);
    setAddingBandId(bandId);
    setDraft({ ...EMPTY_DRAFT, horizonBandId: bandId });
  }

  /** The refusal for one write, rendered where that write was asked for. */
  function renderScopedError(scope: string) {
    if (!error || error.scope !== scope) return null;
    return (
      <p
        role="alert"
        className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >
        {error.message}
      </p>
    );
  }

  function openEditForm(line: RtpFinancialLedgerLine) {
    setError(null);
    setAddingBandId(null);
    setEditingLineId(line.id);
    setDraft(draftFromLine(line));
  }

  async function submitLedgerWrite(
    key: string,
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown>,
    failureMessage: string
  ): Promise<boolean> {
    setError(null);
    setPendingKey(key);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/financial-assumptions`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || failureMessage);
      }

      router.refresh();
      return true;
    } catch (caught) {
      setError({ scope: key, message: caught instanceof Error ? caught.message : failureMessage });
      return false;
    } finally {
      setPendingKey(null);
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>, bandId: string) {
    event.preventDefault();
    const key = `add:${bandId}`;
    const validated = validateDraft(draft);
    if (!validated.ok) {
      setError({ scope: key, message: validated.message });
      return;
    }

    const saved = await submitLedgerWrite(key, "POST", {
      horizonBandId: bandId,
      entryKind: draft.entryKind,
      sourceName: validated.sourceName,
      amount: validated.amount,
      amountBasisYear: validated.amountBasisYear,
      notes: validated.notes,
    }, "Failed to add this ledger line");

    if (saved) resetForms();
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>, line: RtpFinancialLedgerLine) {
    event.preventDefault();
    const key = `save:${line.id}`;
    const validated = validateDraft(draft);
    if (!validated.ok) {
      setError({ scope: key, message: validated.message });
      return;
    }

    // The band the planner chose, falling back to the line's own only if the
    // draft somehow carries none. Never a band id from outside `bands`, which
    // is this cycle's set — and the route re-reads it against the cycle anyway.
    const horizonBandId = bandIds.has(draft.horizonBandId) ? draft.horizonBandId : line.horizonBandId;

    const saved = await submitLedgerWrite(key, "PATCH", {
      assumptionId: line.id,
      horizonBandId,
      entryKind: draft.entryKind,
      sourceName: validated.sourceName,
      amount: validated.amount,
      amountBasisYear: validated.amountBasisYear,
      notes: validated.notes,
    }, "Failed to update this ledger line");

    if (saved) resetForms();
  }

  async function handleDelete(line: RtpFinancialLedgerLine) {
    // Asked before, not undone after: the row is deleted outright, and it is
    // money in a financial element a board may already have adopted.
    const confirmed = window.confirm(
      `Remove “${line.sourceName}” (${formatAmount(line.amount)}) from this plan's financial element? This cannot be undone, and the fiscal-constraint check will be recomputed without it.`
    );
    if (!confirmed) return;

    await submitLedgerWrite(
      `delete:${line.id}`,
      "DELETE",
      { assumptionId: line.id },
      "Failed to remove this ledger line"
    );
  }

  function renderDraftFields(idPrefix: string, options?: { allowBandChange?: boolean }) {
    return (
      <>
        {options?.allowBandChange ? (
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-band`} className="text-xs font-medium text-foreground">
              Period this line belongs to
            </label>
            <select
              id={`${idPrefix}-band`}
              className={SELECT_CLASS}
              value={draft.horizonBandId}
              onChange={(event) => setDraft((current) => ({ ...current, horizonBandId: event.target.value }))}
            >
              {bands.map((band) => (
                <option key={band.id} value={band.id}>
                  {band.label} ({band.startYear}–{band.endYear})
                </option>
              ))}
            </select>
            <p className="text-[0.7rem] text-muted-foreground">
              Moving a line changes which period&apos;s subtotal it counts towards. A period cannot be removed while
              it still carries lines, so this is how they are cleared out first.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-kind`} className="text-xs font-medium text-foreground">
              Entry kind
            </label>
            <select
              id={`${idPrefix}-kind`}
              className={SELECT_CLASS}
              value={draft.entryKind}
              onChange={(event) =>
                setDraft((current) => ({ ...current, entryKind: event.target.value as RtpFiscalEntryKind }))
              }
            >
              {ENTRY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ENTRY_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-source`} className="text-xs font-medium text-foreground">
              Source or cost name
            </label>
            <Input
              id={`${idPrefix}-source`}
              maxLength={SOURCE_NAME_MAX_LENGTH}
              value={draft.sourceName}
              onChange={(event) => setDraft((current) => ({ ...current, sourceName: event.target.value }))}
              placeholder="Local sales tax measure, transit operations, …"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-amount`} className="text-xs font-medium text-foreground">
              Amount (US dollars)
            </label>
            <Input
              id={`${idPrefix}-amount`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={draft.amount}
              onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-basis-year`} className="text-xs font-medium text-foreground">
              Base year of this amount (optional)
            </label>
            <Input
              id={`${idPrefix}-basis-year`}
              type="number"
              value={draft.amountBasisYear}
              onChange={(event) => setDraft((current) => ({ ...current, amountBasisYear: event.target.value }))}
              placeholder="Leave blank to use the plan's base year"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-notes`} className="text-xs font-medium text-foreground">
            Notes (optional)
          </label>
          <Textarea
            id={`${idPrefix}-notes`}
            rows={2}
            maxLength={NOTES_MAX_LENGTH}
            value={draft.notes}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Where this figure comes from, and what it assumes."
          />
        </div>
      </>
    );
  }

  function renderLine(line: RtpFinancialLedgerLine) {
    if (editingLineId === line.id) {
      const saveKey = `save:${line.id}`;
      const isSaving = pendingKey === saveKey;
      return (
        <li key={line.id}>
          <form
            onSubmit={(event) => handleUpdate(event, line)}
            className="space-y-3 rounded-[0.5rem] border border-border/60 bg-muted/20 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Edit ledger line</p>
            {renderScopedError(saveKey)}
            {renderDraftFields(`rtp-ledger-edit-${line.id}`, { allowBandChange: bands.length > 1 })}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={isBusy}>
                {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Save line
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={resetForms} disabled={isSaving}>
                Cancel
              </Button>
            </div>
          </form>
        </li>
      );
    }

    const isRevenue = line.entryKind === "revenue";
    const isDeleting = pendingKey === `delete:${line.id}`;
    // No leading minus on a figure that is not a figure: "− Not recorded" reads
    // as a negative amount and there is no amount at all.
    const hasReadableAmount = parseOptionalAmount(line.amount) !== null;

    return (
      <li
        key={line.id}
        className="flex flex-wrap items-start justify-between gap-3 rounded-[0.5rem] border border-border/50 bg-background/80 px-3 py-2"
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">{line.sourceName}</p>
          <p className="text-[0.7rem] text-muted-foreground">
            {ENTRY_KIND_LABELS[line.entryKind]}
            {line.amountBasisYear ? ` · in ${line.amountBasisYear} dollars` : ""}
          </p>
          {line.notes ? <p className="text-[0.7rem] text-muted-foreground">{line.notes}</p> : null}
          {/*
            THE PAGE THIS FIGURE CAME FROM, beside the figure. Nothing renders
            for a line somebody typed — see `transcriptions` above.
          */}
          {transcriptions?.[line.id] ? (
            <ExtractionProvenanceChip
              record={transcriptions[line.id]}
              audience="planner"
              documentHref={transcriptionDocumentHref(transcriptions[line.id])}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <p
            className={
              isRevenue
                ? "text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
                : "text-sm font-semibold tabular-nums text-foreground"
            }
          >
            {isRevenue || !hasReadableAmount ? "" : "− "}
            {formatAmount(line.amount)}
          </p>
          {canWrite ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openEditForm(line)}
                disabled={isBusy}
                aria-label={`Edit ${line.sourceName}`}
              >
                <PencilLine className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(line)}
                disabled={isBusy}
                aria-label={`Remove ${line.sourceName}`}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          ) : null}
        </div>
      </li>
    );
  }

  // Exactly one banner is ever rendered for a given error — two `role="alert"`
  // nodes carrying the same sentence would be announced twice.
  const openFormScope = addingBandId
    ? `add:${addingBandId}`
    : editingLineId
      ? `save:${editingLineId}`
      : null;

  const errorBanner =
    error && error.scope !== openFormScope ? (
      <p
        role="alert"
        className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >
        {error.message}
      </p>
    ) : null;

  // Nothing on this page works without a period to book money into, and a form
  // that cannot succeed is worse than no form: it looks like the work was done.
  if (bands.length === 0) {
    return (
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Revenues and costs</h3>
        </div>
        <p className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {canWrite
            ? "This plan records no revenue or costs yet, because every revenue source and every cost has to belong to one of the plan's periods and this plan has none. Add the plan's periods first, using the planning periods control on this page, and the ledger opens for each period you add."
            : "This plan records no revenue or costs yet. Every revenue source and every cost belongs to one of the plan's periods, and this plan has no periods yet — someone with edit access adds those first, and the ledger opens for each period they add."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/*
        A plain section rather than a `module-section-surface` card: this sits
        directly beneath the planning-periods control, which is also plain, and
        the two are one element of the plan rather than two features. It also
        composes either way — the page may wrap it in its own section card, and
        a card inside a card is the one arrangement that reads as a mistake.
      */}
      <div>
        <h3 className="text-sm font-semibold text-foreground">Revenues and costs</h3>
        <p className="text-xs text-muted-foreground">
          What this plan expects to receive, and what it expects to spend, in each period. Subtotals below are the
          amounts as entered; the fiscal-constraint check restates them in year-of-expenditure dollars when this plan
          records an inflation rate.
        </p>
      </div>

      {errorBanner}

      {!hasOperationsMaintenance ? (
        <p className="rounded-[0.5rem] border border-amber-400/45 bg-amber-400/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          No operating and maintenance costs are recorded yet. A financial plan is expected to cover what it costs to run
          and maintain the system, not only what it costs to build the projects — leave that out and the plan can look
          affordable when it is not.
        </p>
      ) : null}

      {strandedLineCount > 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">
          {strandedLineCount} recorded {strandedLineCount === 1 ? "line belongs" : "lines belong"} to a period that is
          not shown here, so {strandedLineCount === 1 ? "it is" : "they are"} not included in the subtotals below.
        </p>
      ) : null}

      <div className="space-y-4">
        {bands.map((band) => {
          const bandLines = linesByBand.get(band.id) ?? [];
          const revenueLines = bandLines.filter((line) => line.entryKind === "revenue");
          const costLines = bandLines.filter((line) => isCostKind(line.entryKind));
          const revenueSubtotal = subtotalAmounts(revenueLines);
          const costSubtotal = subtotalAmounts(costLines);
          const unreadableLineCount = revenueSubtotal.unreadableLineCount + costSubtotal.unreadableLineCount;
          const isAdding = addingBandId === band.id;
          const addKey = `add:${band.id}`;
          const isSavingNew = pendingKey === addKey;

          return (
            <article key={band.id} className="space-y-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">{band.label}</p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {band.startYear}–{band.endYear}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[0.7rem] text-muted-foreground">Revenue as entered</p>
                    <p className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {formatSubtotal(revenueSubtotal, revenueLines.length)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.7rem] text-muted-foreground">Costs as entered</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {formatSubtotal(costSubtotal, costLines.length)}
                    </p>
                  </div>
                  {canWrite && !isAdding ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openAddForm(band.id)}
                      disabled={isBusy}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Add a line
                    </Button>
                  ) : null}
                </div>
              </div>

              {unreadableLineCount > 0 ? (
                <p className="text-[0.7rem] text-amber-700 dark:text-amber-300">
                  {unreadableLineCount === 1
                    ? "One line in this period has no readable amount, so it is not in either subtotal above."
                    : `${unreadableLineCount} lines in this period have no readable amount, so they are not in either subtotal above.`}{" "}
                  Open the line and enter its figure — a missing amount is not a zero.
                </p>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                    Revenue
                  </p>
                  {revenueLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No revenue recorded for this period.</p>
                  ) : (
                    <ul className="space-y-2">{revenueLines.map((line) => renderLine(line))}</ul>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Costs</p>
                  {costLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No operating, maintenance, or other costs recorded for this period.
                    </p>
                  ) : (
                    <ul className="space-y-2">{costLines.map((line) => renderLine(line))}</ul>
                  )}
                </div>
              </div>

              {isAdding ? (
                <form
                  onSubmit={(event) => handleCreate(event, band.id)}
                  className="space-y-3 rounded-[0.5rem] border border-border/60 bg-muted/20 p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Add a line to {band.label}
                  </p>
                  {renderScopedError(addKey)}
                  {renderDraftFields(`rtp-ledger-add-${band.id}`)}
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={isBusy}>
                      {isSavingNew ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                      Add line
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={resetForms} disabled={isSavingNew}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
