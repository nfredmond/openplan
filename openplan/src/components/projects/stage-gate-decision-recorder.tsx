"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

/**
 * Record a PASS or HOLD against one gate.
 *
 * WHY THIS EXISTS AT ALL. The stage-gate cockpit rendered nine gates and had no
 * control anywhere in the product that could put a decision on any of them —
 * `/api/stage-gates/decisions` exported GET and nothing else. So the board
 * displayed a workflow that could not be driven, and the only rows in the
 * decision log came from report exports writing an off-vocabulary gate id.
 *
 * DESIGN NOTE: the run citation is a picker over runs the page already loaded,
 * with pasting a raw id kept as an explicit fallback. The picker only appears
 * for a citation kind the page actually handed a list for (`runOptions`); a
 * kind with no list — county validation runs today — keeps the plain id field,
 * because an empty picker would read as "no runs exist" when the truth is
 * "this page did not load them". A decision recorded without a citation is
 * complete — most gates do not turn on a run.
 */

export type StageGateDecisionTarget = {
  gateId: string;
  gateName: string;
  sequence: number;
};

type RunCitationKind = "none" | "runId" | "modelRunId" | "countyRunId";

const RUN_CITATION_LABELS: Record<Exclude<RunCitationKind, "none">, string> = {
  runId: "Analysis Studio run",
  modelRunId: "Model run",
  countyRunId: "County validation run",
};

/** One run the planner can cite by choosing it instead of pasting its id. */
export type StageGateRunOption = {
  id: string;
  title: string;
  status?: string | null;
  createdAt?: string | null;
};

/**
 * Runs the surrounding page already loaded, keyed by which citation kind they
 * satisfy. A kind that is absent (or empty) here falls back to the manual id
 * field — the page has no list of that kind to offer, and this component must
 * not invent one.
 */
export type StageGateRunOptions = Partial<Record<Exclude<RunCitationKind, "none">, StageGateRunOption[]>>;

function runOptionLabel(option: StageGateRunOption): string {
  const parts = [option.title || option.id];
  if (option.status) parts.push(option.status);
  if (option.createdAt) {
    const parsed = new Date(option.createdAt);
    if (!Number.isNaN(parsed.getTime())) parts.push(parsed.toLocaleDateString());
  }
  // The short id tail lets a planner match the choice against a run id they
  // have in hand (a report citation, a colleague's note) without pasting it.
  parts.push(option.id.slice(0, 8));
  return parts.join(" · ");
}

export function StageGateDecisionRecorder({
  workspaceId,
  projectId,
  gate,
  canWrite,
  evidenceIdExample,
  runOptions,
}: {
  workspaceId: string;
  projectId: string;
  gate: StageGateDecisionTarget;
  /**
   * False for the read-only viewer tier. The control is HIDDEN rather than
   * disabled: a disabled button on a governance surface reads as "you may do
   * this later", and the viewer tier is a standing role, not a pending state.
   */
  canWrite: boolean;
  /**
   * An evidence id from the BOUND TEMPLATE's own vocabulary, used as the
   * placeholder. Null when the gate declares no required evidence, in which case
   * the field falls back to a hint that names no vocabulary at all.
   */
  evidenceIdExample?: string | null;
  /**
   * Runs the page already loaded, offered as a picker per citation kind.
   * Optional and additive: with no lists (or an empty list for the chosen
   * kind) the manual id field renders exactly as it always has.
   */
  runOptions?: StageGateRunOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"PASS" | "HOLD">("PASS");
  const [rationale, setRationale] = useState("");
  const [missingArtifacts, setMissingArtifacts] = useState("");
  const [runCitationKind, setRunCitationKind] = useState<RunCitationKind>("none");
  const [runCitationId, setRunCitationId] = useState("");
  /**
   * True when the planner explicitly asked to paste an id instead of picking
   * from the offered list. Only meaningful for a kind that HAS a list; a kind
   * without one is always manual.
   */
  const [manualRunEntry, setManualRunEntry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the server said about a write that SUCCEEDED but could not be read back.
   *
   * `insertNotReadableBackResponse` answers 201 with `record: null` when the row
   * was inserted and the follow-up select returned nothing (an INSERT policy with
   * no matching SELECT). Treating that as an ordinary success would close the
   * form, refresh the board, and leave the gate still reading "No decision
   * recorded" — the planner's decision rendered as an absence, silently. The
   * write must NOT be retried, so this is a notice rather than an error.
   */
  const [notice, setNotice] = useState<string | null>(null);

  if (!canWrite) return null;

  function reset() {
    setDecision("PASS");
    setRationale("");
    setMissingArtifacts("");
    setRunCitationKind("none");
    setRunCitationId("");
    setManualRunEntry(false);
    setError(null);
    setOpen(false);
  }

  const optionsForKind: StageGateRunOption[] =
    runCitationKind !== "none" ? runOptions?.[runCitationKind] ?? [] : [];
  const pickerAvailable = optionsForKind.length > 0;
  const usePicker = pickerAvailable && !manualRunEntry;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    // A run kind chosen with the id left blank used to fall out of the payload
    // entirely: the decision saved, the citation vanished, and nothing said so.
    // Silently discarding evidence someone deliberately reached for is worse
    // than refusing, so the omission is named and the form stays open.
    if (runCitationKind !== "none" && !runCitationId.trim()) {
      const kindLabel = RUN_CITATION_LABELS[runCitationKind].toLowerCase();
      setError(
        (usePicker
          ? `Choose a ${kindLabel} from the list (or paste its id), or choose "No run cited". `
          : `Enter the ${kindLabel} id, or choose "No run cited". `) +
          "A citation left blank would be recorded as no citation at all."
      );
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/stage-gates/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId,
          gateId: gate.gateId,
          decision,
          rationale,
          missingArtifacts: missingArtifacts
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
          ...(runCitationKind !== "none" && runCitationId.trim()
            ? { [runCitationKind]: runCitationId.trim() }
            : {}),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        created?: boolean;
        record?: unknown;
      };

      if (!response.ok) {
        // The route's refusals are written to be shown: an off-vocabulary gate
        // lists the template's real gates, a bad citation names which run kind
        // it could not reach. Surfacing `details` over `error` keeps that.
        throw new Error(body.details || body.error || "The decision was not recorded");
      }

      // Written, but not readable back. The board is about to render this gate
      // as undecided even though it is not, so say so rather than let the
      // absence stand as the answer.
      const wroteButCannotRead = body.created === true && body.record === null;

      reset();
      setNotice(
        wroteButCannotRead
          ? body.details ||
              "The decision was recorded, but this page cannot read it back, so the board below may still show this gate as undecided. Do not record it again."
          : null
      );
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The decision was not recorded");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 space-y-2">
        {notice ? (
          <p
            role="status"
            className="rounded-[0.5rem] border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {notice}
          </p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Record decision
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-[0.5rem] border border-border/70 bg-background/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Record a decision on gate {gate.sequence} · {gate.gateName}
      </p>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-foreground">Decision</legend>
        <div className="flex gap-4">
          {(["PASS", "HOLD"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`decision-${gate.gateId}`}
                value={option}
                checked={decision === option}
                onChange={() => setDecision(option)}
              />
              {option === "PASS" ? "Pass" : "Hold"}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">Rationale</span>
        {/* Required by the server and by the column. A gate verdict with no
            stated reason is one nobody downstream can review or overturn. */}
        <Textarea
          required
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Why this gate passes, or what is holding it."
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">
          Outstanding evidence <span className="text-muted-foreground">(optional, one per line)</span>
        </span>
        <Textarea
          value={missingArtifacts}
          onChange={(event) => setMissingArtifacts(event.target.value)}
          rows={2}
          placeholder={evidenceIdExample ?? "One evidence id per line"}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">
            Cited run <span className="text-muted-foreground">(optional)</span>
          </span>
          <select
            className="h-9 w-full rounded-[0.4rem] border border-border/70 bg-background px-2 text-sm"
            value={runCitationKind}
            onChange={(event) => {
              setRunCitationKind(event.target.value as RunCitationKind);
              // An id chosen for one kind is meaningless for another (the three
              // kinds cite three different tables), so it never carries over.
              setRunCitationId("");
              setManualRunEntry(false);
            }}
          >
            <option value="none">No run cited</option>
            {(Object.keys(RUN_CITATION_LABELS) as Array<keyof typeof RUN_CITATION_LABELS>).map((kind) => (
              <option key={kind} value={kind}>
                {RUN_CITATION_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        {runCitationKind !== "none" && usePicker ? (
          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">{RUN_CITATION_LABELS[runCitationKind]}</span>
              <select
                className="h-9 w-full rounded-[0.4rem] border border-border/70 bg-background px-2 text-sm"
                value={optionsForKind.some((option) => option.id === runCitationId) ? runCitationId : ""}
                onChange={(event) => setRunCitationId(event.target.value)}
              >
                <option value="">Choose a run…</option>
                {optionsForKind.map((option) => (
                  <option key={option.id} value={option.id}>
                    {runOptionLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setManualRunEntry(true);
                setRunCitationId("");
              }}
            >
              Paste an id instead
            </button>
          </div>
        ) : runCitationKind !== "none" ? (
          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">{RUN_CITATION_LABELS[runCitationKind]} id</span>
              <Input
                value={runCitationId}
                onChange={(event) => setRunCitationId(event.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </label>
            {pickerAvailable ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  setManualRunEntry(false);
                  setRunCitationId("");
                }}
              >
                Choose from the list instead
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        {/* Named differently from the control that opened this form so the two
            are distinguishable — to a screen reader as much as to a test. */}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save decision
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
