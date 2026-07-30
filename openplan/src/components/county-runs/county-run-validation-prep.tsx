"use client";

import { useState } from "react";
import { prepareCountyRunValidation } from "@/lib/api/county-onramp-client";
import type { PrepareCountyRunValidationResponse } from "@/lib/api/county-onramp";

/**
 * THE STEP BETWEEN "A MANIFEST ARRIVED" AND "THIS RUN IS VALIDATED SCREENING".
 *
 * A county run only becomes validated screening when its assigned volumes have
 * been checked against observed counts. Everything needed to say whether that
 * check CAN run — the run output directory, the counts CSV, the starter
 * stations, the AequilibraE project database — is already known to
 * `/api/county-runs/[id]/validate`, which also assembles the exact
 * `validate_screening_observed_counts.py` invocation. It had no caller, so the
 * page went quiet at precisely the point an operator gets stuck, and the only
 * way to find out what was missing was to run the script and read the traceback.
 *
 * IT IS NOT RUN AUTOMATICALLY, and that is deliberate rather than unfinished.
 * The check probes this deployment's own filesystem, so the answer is only true
 * for the machine serving the page and only at the moment it is asked. Firing it
 * on mount would put a filesystem stat behind every render of every county run,
 * including runs nowhere near this stage, and would report a stale answer as a
 * current one.
 *
 * WHY THE COMMAND IS SHOWN RATHER THAN EXECUTED. OpenPlan does not run shell
 * commands on behalf of a browser session. The validator is a Python script on
 * the operator's own machine against their own run directory; handing them the
 * assembled command with the paths already resolved is the honest form of help.
 * The automation variant appends the callback that posts results back, and it
 * appears ONLY when a bearer token is configured — otherwise a copied command
 * would fail at the last step with an auth error, which is worse than not
 * offering it.
 */
export function CountyRunValidationPrep({ countyRunId }: { countyRunId: string }) {
  const [prep, setPrep] = useState<PrepareCountyRunValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function check() {
    setError(null);
    setLoading(true);
    try {
      setPrep(await prepareCountyRunValidation(countyRunId));
    } catch (cause) {
      // The check itself failed. That is not the same as "this run cannot be
      // validated", and saying so would send an operator hunting for a missing
      // file that is present.
      setError(cause instanceof Error ? cause.message : "Could not check validation readiness.");
      setPrep(null);
    } finally {
      setLoading(false);
    }
  }

  function copy(label: string, value: string) {
    void navigator.clipboard?.writeText(value).then(() => setCopied(label));
  }

  return (
    <section className="mt-6 rounded-xl border border-border/70 bg-background/50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Count validation</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Whether this run can be checked against observed traffic counts yet — and, if it can, the
            command that does it. Validation is what moves a run from screening output to validated
            screening; until it runs, the volumes are unvalidated.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={loading}
          className="shrink-0 rounded-md border border-border/70 px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {loading ? "Checking…" : prep ? "Check again" : "Check readiness"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {error} This is a problem reading the run, not a finding about it.
        </p>
      ) : null}

      {prep ? (
        <div className="mt-4 space-y-3" data-testid="county-validation-prep">
          <p className="text-sm font-semibold text-foreground">{prep.statusLabel}</p>

          {prep.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {prep.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          {prep.command ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Run this
                </p>
                <button
                  type="button"
                  onClick={() => copy("command", prep.command as string)}
                  className="text-xs font-medium underline underline-offset-4 hover:text-foreground"
                >
                  {copied === "command" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
                <code>{prep.command}</code>
              </pre>
            </div>
          ) : null}

          {prep.automationCommand ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Or run it and post the results back
                </p>
                <button
                  type="button"
                  onClick={() => copy("automation", prep.automationCommand as string)}
                  className="text-xs font-medium underline underline-offset-4 hover:text-foreground"
                >
                  {copied === "automation" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
                <code>{prep.automationCommand}</code>
              </pre>
            </div>
          ) : prep.ready ? (
            <p className="text-sm text-muted-foreground">
              Results can be posted back to <code className="break-all">{prep.refreshUrl}</code>, which
              needs a callback bearer token this deployment has not configured. Without it the command
              above still validates the run — the results just have to be ingested separately.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
