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
 * DESIGN NOTE: the run citation is a plain id field rather than a picker.
 * A picker over three run tables (Analysis Studio runs, worker model runs,
 * county validation runs) is a real improvement and a bigger change; what
 * matters first is that the schema and this path can carry the citation at all,
 * so the field is present, labelled with which kind it is, and honest that it is
 * optional. A decision recorded without one is complete — most gates do not turn
 * on a run.
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

export function StageGateDecisionRecorder({
  workspaceId,
  projectId,
  gate,
  canWrite,
  evidenceIdExample,
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"PASS" | "HOLD">("PASS");
  const [rationale, setRationale] = useState("");
  const [missingArtifacts, setMissingArtifacts] = useState("");
  const [runCitationKind, setRunCitationKind] = useState<RunCitationKind>("none");
  const [runCitationId, setRunCitationId] = useState("");
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
    setError(null);
    setOpen(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    // A run kind chosen with the id left blank used to fall out of the payload
    // entirely: the decision saved, the citation vanished, and nothing said so.
    // Silently discarding evidence someone deliberately reached for is worse
    // than refusing, so the omission is named and the form stays open.
    if (runCitationKind !== "none" && !runCitationId.trim()) {
      setError(
        `Enter the ${RUN_CITATION_LABELS[runCitationKind].toLowerCase()} id, or choose "No run cited". ` +
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
            onChange={(event) => setRunCitationKind(event.target.value as RunCitationKind)}
          >
            <option value="none">No run cited</option>
            {(Object.keys(RUN_CITATION_LABELS) as Array<keyof typeof RUN_CITATION_LABELS>).map((kind) => (
              <option key={kind} value={kind}>
                {RUN_CITATION_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        {runCitationKind !== "none" ? (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">{RUN_CITATION_LABELS[runCitationKind]} id</span>
            <Input
              value={runCitationId}
              onChange={(event) => setRunCitationId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
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
