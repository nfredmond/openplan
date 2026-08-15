"use client";

import { useState } from "react";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STAGE_GATE_REBIND_DECISION_INVARIANT,
  type StageGateGateRef,
  type StageGateRebindChoices,
  type StageGateRebindOption,
} from "@/lib/stage-gates/rebind";

/**
 * Show which stage-gate template a workspace delivers under, and let an
 * owner/admin re-bind it.
 *
 * WHY IT IS HERE AND NOT ON A PROJECT
 *   The binding is a column on `workspaces`. Every project's gate board reads
 *   it, so changing it from inside one project would silently re-frame all the
 *   others. It belongs beside the workspace geography, which is the other
 *   setting the whole app reads.
 *
 * THREE THINGS THIS SURFACE OWES A PLANNER
 *   1. THE CURRENT TRUTH, INCLUDING WHEN NOBODY CHOSE IT. The disclosure comes
 *      from `describeStageGateBinding`, unconditionally — one render path, so a
 *      forgotten branch cannot drop it. When the jurisdiction was assumed it is
 *      called out loudly, because the gate names and evidence ids on screen then
 *      belong to another jurisdiction and must not be filed as this agency's own.
 *   2. AN EXPLICIT REVIEW STEP. Selecting a template does not change anything.
 *      The operator is shown, by name, the gates that will stop appearing and the
 *      gates that will start, and confirms against that list.
 *   3. AN HONEST ACCOUNT WHEN THERE IS NOTHING TO CHOOSE. A deployment that
 *      registers one template offers no alternative, and this says so and why
 *      rather than rendering an empty picker. Disclose, never hide.
 */

type WorkspaceStageGatePanelProps = {
  workspaceId: string;
  /** Only owners and admins may rebind; the API enforces this too. */
  canManage: boolean;
  /**
   * Built on the server by `buildStageGateRebindChoices` from the workspace ROW,
   * so what is rendered is the same reconciliation every other reader performs.
   */
  choices: StageGateRebindChoices;
};

function GateList({ label, gates }: { label: string; gates: readonly StageGateGateRef[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {gates.map((gate) => (
          <li key={gate.gateId} className="text-sm text-foreground">
            {gate.name} <span className="text-xs text-muted-foreground">({gate.gateId})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WorkspaceStageGatePanel({
  workspaceId,
  canManage,
  choices,
}: WorkspaceStageGatePanelProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The binding this panel wrote in THIS session, if any.
   *
   * Deliberately NOT a `router.refresh()`. Every gate list this panel shows —
   * what leaves the board, what arrives — is computed by the server against the
   * template that was bound when the page rendered. Once the binding changes,
   * every one of those diffs describes a starting point that no longer exists,
   * so continuing to offer the picker would invite a second rebind reviewed
   * against stale facts. The panel closes instead and says what it wrote,
   * leaving a reload as the way back to a picker whose numbers are true.
   */
  const [reboundTo, setReboundTo] = useState<StageGateRebindOption | null>(null);

  if (choices.kind === "unreadable") {
    // A failed read may not be rendered as an answer. Saying "this workspace has
    // not stated where it works" — which is what a null row resolves to — would
    // be a claim about the agency that a broken query cannot support, and it
    // would send an operator to change a setting that may already be correct.
    return (
      <section className="rounded-xl border border-border/70 p-5" aria-label="Stage-gate template">
        <h2 className="text-sm font-semibold text-foreground">Stage-gate template</h2>
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-foreground">
              OpenPlan could not read which stage-gate template this workspace is bound to. That is
              a failed read, not a finding: it does not mean no template is bound, and it does not
              mean this workspace has stated no geography. Nothing was changed, and no recorded gate
              decision is affected.
            </p>
            <p className="mt-1 text-muted-foreground">
              Rebinding is unavailable until the current binding can be read, because the effect of
              a rebind is described relative to it. Reload this page; if it keeps failing, the
              database reason below is what an operator needs.
            </p>
            {choices.readErrorMessage ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {choices.readErrorMessage}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                The read returned no reason of its own.
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (choices.kind === "no_template_registered") {
    return (
      <section className="rounded-xl border border-border/70 p-5" aria-label="Stage-gate template">
        <h2 className="text-sm font-semibold text-foreground">Stage-gate template</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This deployment registers no stage-gate template, so project gate boards have no gates to
          show. Nothing here can be chosen until a template pack is registered.
        </p>
      </section>
    );
  }

  const options = choices.options;
  const currentTemplateId = choices.kind === "bound" ? choices.binding.templateId : null;
  const selected: StageGateRebindOption | null =
    options.find((option) => option.templateId === selectedTemplateId) ?? null;

  async function rebind(option: StageGateRebindOption) {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/stage-gate-template", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          templateId: option.templateId,
          ...(currentTemplateId ? { expectedCurrentTemplateId: currentTemplateId } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          [body.error, body.details].filter(Boolean).join(" ") ||
            "Could not change the stage-gate template",
        );
      }
      setReviewing(false);
      setSelectedTemplateId(null);
      setReboundTo(option);
    } catch (rebindError) {
      setError(
        rebindError instanceof Error
          ? rebindError.message
          : "Could not change the stage-gate template",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Stage-gate template">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Stage-gate template</h2>
        {/*
          THE BINDING THIS SESSION WROTE WINS OVER THE ONE THE PAGE RENDERED WITH.

          `choices` is server state from page load. After a successful rebind the
          notice below says "Bound to <new template>" while this header still
          named the OLD one — two contradicting answers to the same question,
          eight lines apart, with no way for a planner to tell which is true.
          Two fresh testers walked into it independently in their first hour.

          The fix is deliberately only the header. Do NOT "fix" this with a
          router.refresh(): every gate diff on this screen was computed by the
          server against the binding that existed at render, so refreshing part
          of it would offer a second rebind reviewed against facts that no longer
          hold. That design is explained where `reboundTo` is declared and it is
          right. The picker stays closed and the reload notice stays as it is.
        */}
        {reboundTo ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" />
            {reboundTo.templateName} v{reboundTo.templateVersion}
          </p>
        ) : choices.kind === "bound" ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" />
            {choices.binding.templateName} v{choices.binding.templateVersion}
          </p>
        ) : null}
      </div>

      {choices.kind === "unknown_template" ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <p className="text-foreground">
            This workspace is bound to{" "}
            <span className="font-medium">
              {choices.boundTemplateId ? `“${choices.boundTemplateId}”` : "no registered template"}
            </span>
            , which this deployment does not register. Project gate boards cannot render, and which
            gates would leave a board on a rebind cannot be determined — the current template is not
            here to compare against. Recorded decisions are unaffected and stay exactly as signed.
          </p>
        </div>
      ) : (
        <div
          className={
            choices.disclosure.isJurisdictionAssumed && !reboundTo
              ? "mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
              : "mt-2"
          }
        >
          {/*
            THE DISCLOSURE DESCRIBES THE BINDING AT PAGE LOAD, so once this
            session has written a new one it is describing the past.

            It is server-computed and correct when the page renders. After a
            rebind it kept asserting "this workspace is still bound to <the old
            template>" and, worse, kept instructing "Rebind this workspace to the
            template registered for <jurisdiction>" — telling a planner to do the
            thing they had just done, two paragraphs above the notice confirming
            they had done it. A tester reported the page as contradicting itself
            and needing a reload to be trusted.

            THE PANEL STILL DOES NOT REFRESH, deliberately: the gate lists behind
            this were computed against the old binding, and re-fetching part of
            it would offer a second rebind reviewed against stale facts. So the
            stale sentences are WITHDRAWN rather than updated, and the two
            accurate paragraphs already below — what was written, and that a
            reload is how to continue — are left to speak for themselves.
          */}
          {reboundTo ? null : (
            <>
              <p className="text-sm font-medium text-foreground">{choices.disclosure.headline}</p>
              <p className="mt-1 text-sm text-muted-foreground">{choices.disclosure.detail}</p>
              {choices.disclosure.action ? (
                <p className="mt-1 text-sm text-muted-foreground">{choices.disclosure.action}</p>
              ) : null}
            </>
          )}
          {choices.binding.templateDescription ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {choices.binding.templateDescription}
            </p>
          ) : null}
          {choices.binding.scopeNotes && choices.binding.scopeNotes.length > 0 ? (
            // The template's own account of its limits. It is part of the
            // binding, not fine print: a planner reading these gates needs to
            // know what they deliberately do NOT cover.
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {choices.binding.scopeNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {choices.currentGateCount} gate{choices.currentGateCount === 1 ? "" : "s"} in this
            template.
          </p>
        </div>
      )}

      {reboundTo ? (
        <div className="mt-3 rounded-lg border border-border/70 p-3">
          <p className="text-sm text-foreground">
            Bound to {reboundTo.templateName} ({reboundTo.jurisdictionLabel}). No recorded gate
            decision was edited, re-mapped, or deleted.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            The current binding shown above, and the gate lists behind it, still describe the
            template that was bound when this page loaded. Reload the page to review any further
            change from the new starting point.
          </p>
        </div>
      ) : options.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          This deployment registers {choices.registeredTemplateCount} stage-gate template
          {choices.registeredTemplateCount === 1 ? "" : "s"} and there is no other one to bind to.
          Registering a pack for another jurisdiction makes it selectable here — no code change is
          needed to offer it.
        </p>
      ) : !canManage ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {options.length} other registered template{options.length === 1 ? "" : "s"} could be bound
          instead. Ask a workspace owner or admin to change it.
        </p>
      ) : reviewing && selected ? (
        <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-4">
          <p className="text-sm font-medium text-foreground">
            Rebind to {selected.templateName} ({selected.jurisdictionLabel}), version{" "}
            {selected.templateVersion}?
          </p>

          {selected.templateDescription ? (
            <p className="text-sm text-muted-foreground">{selected.templateDescription}</p>
          ) : null}
          {selected.scopeNotes && selected.scopeNotes.length > 0 ? (
            // What the template being bound says it does NOT cover — shown at
            // the moment of choosing, not discovered after.
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {selected.scopeNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {selected.gatesLeaving === null || selected.gatesArriving === null ? (
            <p className="text-sm text-muted-foreground">
              Which gates would change could not be determined, because the template this workspace
              currently names is not registered here. That is not a statement that nothing changes.
            </p>
          ) : (
            <div className="space-y-3">
              {selected.gatesLeaving.length > 0 ? (
                <GateList
                  label="Gates that will stop appearing on project boards"
                  gates={selected.gatesLeaving}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No gate leaves the board: every gate in the current template also exists in this
                  one.
                </p>
              )}
              {selected.gatesArriving.length > 0 ? (
                <GateList label="Gates that will start appearing" gates={selected.gatesArriving} />
              ) : null}
            </div>
          )}

          <p className="text-sm text-muted-foreground">{STAGE_GATE_REBIND_DECISION_INVARIANT}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={working} onClick={() => void rebind(selected)}>
              {working ? "Rebinding…" : `Rebind to ${selected.templateName}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => {
                setReviewing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Other registered templates
            </legend>
            {options.map((option) => (
              <label key={option.templateId} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="stage-gate-template"
                  className="mt-1"
                  value={option.templateId}
                  checked={selectedTemplateId === option.templateId}
                  onChange={() => {
                    setSelectedTemplateId(option.templateId);
                    setError(null);
                  }}
                />
                <span>
                  <span className="font-medium text-foreground">{option.templateName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {option.jurisdictionLabel}, v{option.templateVersion}
                  </span>
                  {option.coversWorkspaceJurisdiction ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (registered for this workspace&apos;s jurisdiction)
                    </span>
                  ) : null}
                  {option.isInterimDefault ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (the interim default — applied when nothing has chosen)
                    </span>
                  ) : null}
                  {option.templateDescription ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.templateDescription}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>

          <Button
            type="button"
            disabled={!selected || working}
            onClick={() => {
              setReviewing(true);
              setError(null);
            }}
          >
            {selected ? `Review rebind to ${selected.templateName}` : "Select a template"}
          </Button>
        </div>
      )}

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
