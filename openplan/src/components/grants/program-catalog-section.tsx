"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, Check, ExternalLink, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  describeGrantProgramCoverage,
  isGrantProgramTracked,
  type GrantProgramCatalogEntry,
  type GrantProgramJurisdictionQuery,
} from "@/lib/grants/program-catalog";

export function GrantsProgramCatalogSection({
  trackedTitles,
  workspaceJurisdiction,
}: {
  trackedTitles: string[];
  /**
   * Where this workspace works, as `resolveJurisdiction()` reports it from the
   * home geography. `null` means it has not said — which is disclosed above the
   * list, never resolved into a guess, and never a reason to hide a program.
   * Only the codes cross the boundary; the coverage answer is derived here from
   * the static registry the catalog is already built from.
   */
  workspaceJurisdiction: GrantProgramJurisdictionQuery | null;
}) {
  const coverage = describeGrantProgramCoverage(workspaceJurisdiction);
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [locallyTrackedKeys, setLocallyTrackedKeys] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleTrack(program: GrantProgramCatalogEntry) {
    setPendingKey(program.key);
    setError(null);

    try {
      const response = await fetch("/api/funding-opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: program.name,
          agencyName: program.administeringAgency,
          cadenceLabel: program.cycleNote,
          summary: program.summary,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to track this program as an opportunity");
      }

      setLocallyTrackedKeys((previous) => [...previous, program.key]);
      router.refresh();
    } catch (trackError) {
      setError(
        trackError instanceof Error
          ? trackError.message
          : "Failed to track this program as an opportunity"
      );
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <article className="module-section-surface" id="grants-program-catalog">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <BookMarked className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Discovery</p>
            <h2 className="module-section-title">Program catalog for small and rural agencies</h2>
            <p className="module-section-description">
              Curated funding programs worth watching, each labeled with the jurisdiction it is
              registered for. Track one to create a shared opportunity record; cycle timing is
              guidance only — always verify the current call with the administering agency.
            </p>
          </div>
        </div>
        <span className="module-inline-item">
          <strong>{coverage.programs.length}</strong> programs
          {coverage.coveredProgramCount !== null && coverage.coveredProgramCount < coverage.programs.length
            ? ` · ${coverage.coveredProgramCount} open to ${coverage.workspaceJurisdictionLabel}`
            : ""}
        </span>
      </div>

      {coverage.disclosure ? (
        <div
          data-testid="grants-program-coverage-disclosure"
          className="mt-4 rounded-2xl border-l-2 border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-100"
        >
          <p className="font-semibold tracking-tight">{coverage.disclosure.headline}</p>
          <p className="mt-1">{coverage.disclosure.detail}</p>
          {coverage.disclosure.action ? <p className="mt-1">{coverage.disclosure.action}</p> : null}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <div className="mt-5 divide-y divide-border/60 rounded-2xl border border-border/60 bg-background/70">
        {coverage.programs.map(({ program, bundle }) => {
          const isTracked =
            isGrantProgramTracked(program, trackedTitles) ||
            locallyTrackedKeys.includes(program.key);
          const isPending = pendingKey === program.key;

          return (
            <div key={program.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{program.name}</p>
                  <StatusBadge tone={program.level === "federal" ? "info" : "success"}>
                    {program.level === "federal" ? "Federal" : "State"}
                  </StatusBadge>
                  {/* The jurisdiction badge is unconditional: a program that IS
                      this workspace's still says whose it is, so the absence of a
                      caveat is never mistaken for the absence of a limit. */}
                  <StatusBadge
                    tone={
                      bundle.scope === "other_jurisdiction"
                        ? "warning"
                        : bundle.scope === "unknown_jurisdiction"
                          ? "neutral"
                          : "success"
                    }
                  >
                    {bundle.scopeLabel}
                  </StatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">{program.summary}</p>
                <dl className="grid gap-x-6 gap-y-0.5 text-[0.8rem] text-muted-foreground sm:grid-cols-2">
                  <div className="flex gap-1.5">
                    <dt className="shrink-0 font-semibold text-foreground/70">Agency</dt>
                    <dd>{program.administeringAgency}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="shrink-0 font-semibold text-foreground/70">Applicants</dt>
                    <dd>{program.typicalApplicants}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="shrink-0 font-semibold text-foreground/70">Eligible</dt>
                    <dd>{program.eligibleProjectTypes.join("; ")}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="shrink-0 font-semibold text-foreground/70">Cycle</dt>
                    <dd>{program.cycleNote}</dd>
                  </div>
                  <div className="flex gap-1.5 sm:col-span-2">
                    <dt className="shrink-0 font-semibold text-foreground/70">Match</dt>
                    <dd>{program.matchRequirement}</dd>
                  </div>
                  {program.bcaNote ? (
                    <div className="flex gap-1.5 sm:col-span-2">
                      <dt className="shrink-0 font-semibold text-foreground/70">Benefit-cost</dt>
                      <dd>{program.bcaNote}</dd>
                    </div>
                  ) : null}
                </dl>
                <a
                  href={program.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
                >
                  Official program page
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="shrink-0 pt-0.5">
                {isTracked ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--pine)]">
                    <Check className="h-4 w-4" />
                    Tracked
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleTrack(program)}
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Track as opportunity
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
