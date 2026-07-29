"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CeqaVmtScreenBody } from "@/components/ceqa/ceqa-vmt-screen-body";
import type { CeqaVmtKpiRowLike } from "@/lib/models/ceqa-vmt-screen";
import {
  claimStatusLabel,
  parseVmtSignificanceScreeningRow,
  summarizeRecord,
  type VmtClaimTierEvidence,
  type VmtDeterminationSaveRequest,
  type VmtSignificanceScreeningRecord,
} from "@/lib/planner-pack/vmt-screening-records";
import type { VmtFrameworkResolution } from "@/lib/planner-pack/vmt-significance-frameworks";

/**
 * VMT significance screen for a succeeded model run.
 *
 * The AequilibraE worker stores `daily_vmt` / `vmt_per_capita` /
 * `population_total` KPIs in the directly-readable `general` category (no
 * consent gate — the behavioral consent gate applies only to county-run
 * behavioral_onramp KPIs), so this panel lazily fetches the run's KPI rows and
 * feeds the shared screen body.
 *
 * It also fetches the run's PERSISTED determinations and the jurisdiction gate,
 * because a determination is only useful once it can be cited, and only safe
 * once it carries the framework and claim tier it was issued under. Both fetches
 * are deferred until the operator opens the screen: the panel appears once per
 * run in a list, and firing two requests per run on page load would cost every
 * planner a round trip for a panel most of them will not open.
 */
type ModelRunCeqaVmtScreenProps = {
  modelId: string;
  modelRunId: string;
  runTitle: string;
};

type ScreenState = {
  framework: VmtFrameworkResolution | null;
  frameworkUnavailableReason: string | null;
  claimTier: VmtClaimTierEvidence | null;
  screenings: VmtSignificanceScreeningRecord[];
  unreadableCount: number;
};

const EMPTY_STATE: ScreenState = {
  framework: null,
  frameworkUnavailableReason: null,
  claimTier: null,
  screenings: [],
  unreadableCount: 0,
};

function formatSavedAt(createdAt: string | null): string {
  if (!createdAt) return "date not recorded";
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? "date not recorded"
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ModelRunCeqaVmtScreen({ modelId, modelRunId, runTitle }: ModelRunCeqaVmtScreenProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<CeqaVmtKpiRowLike[] | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>(EMPTY_STATE);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const significanceEndpoint = `/api/models/${modelId}/runs/${modelRunId}/vmt-significance`;

  /**
   * Load the jurisdiction gate, the claim tier, and the saved history.
   *
   * A failure here is REPORTED, not absorbed. If it were absorbed, the body's
   * "no framework established" state would render for a workspace that has one,
   * and a planner would be told their jurisdiction is uncovered because a
   * request failed. The reason travels into the panel instead.
   */
  const loadSignificance = useCallback(async (): Promise<ScreenState> => {
    try {
      const response = await fetch(significanceEndpoint, { cache: "no-store" });
      const payload = (await response.json()) as {
        framework?: VmtFrameworkResolution;
        claimTier?: VmtClaimTierEvidence;
        screenings?: unknown[];
        unreadable_screening_count?: number;
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        return {
          ...EMPTY_STATE,
          frameworkUnavailableReason:
            payload.details ||
            payload.error ||
            "The jurisdiction and saved-determination lookup failed, so OpenPlan cannot say which framework governs this workspace.",
        };
      }

      const screenings = (payload.screenings ?? [])
        .map(parseVmtSignificanceScreeningRow)
        .filter((record): record is VmtSignificanceScreeningRecord => record !== null);

      return {
        framework: payload.framework ?? null,
        frameworkUnavailableReason: payload.framework
          ? null
          : "The server returned no jurisdiction resolution for this workspace, so no framework can be established here.",
        claimTier: payload.claimTier ?? null,
        screenings,
        unreadableCount: payload.unreadable_screening_count ?? 0,
      };
    } catch (err) {
      return {
        ...EMPTY_STATE,
        frameworkUnavailableReason:
          err instanceof Error
            ? `The jurisdiction and saved-determination lookup failed: ${err.message}`
            : "The jurisdiction and saved-determination lookup failed.",
      };
    }
  }, [significanceEndpoint]);

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (!nextOpen || kpis !== null || isLoading) return;

    setError(null);
    setIsLoading(true);
    try {
      const [kpiResponse, significance] = await Promise.all([
        fetch(`/api/models/${modelId}/runs/${modelRunId}/kpis`, { cache: "no-store" }),
        loadSignificance(),
      ]);
      const payload = (await kpiResponse.json()) as {
        kpis?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (!kpiResponse.ok) {
        throw new Error(payload.error || "Failed to load run KPIs");
      }
      setScreenState(significance);
      setKpis(
        (payload.kpis ?? []).map((row) => ({
          kpi_name: String(row.kpi_name ?? ""),
          kpi_label: typeof row.kpi_label === "string" ? row.kpi_label : null,
          value: typeof row.value === "number" ? row.value : null,
          unit: typeof row.unit === "string" ? row.unit : null,
          geometry_ref: typeof row.geometry_ref === "string" ? row.geometry_ref : null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run KPIs");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveDetermination(request: VmtDeterminationSaveRequest) {
    setSavePending(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const response = await fetch(significanceEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as {
        screening?: unknown;
        reason?: string;
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        // The server's refusal names its own reason (a missing framework, a run
        // with no VMT KPI, a calibrated basis this run cannot supply). Showing
        // it verbatim is the point — a generic "could not save" would hide which.
        setSaveError(payload.reason || payload.details || payload.error || "The determination was not saved.");
        return;
      }

      const record = parseVmtSignificanceScreeningRow(payload.screening);
      if (!record) {
        // The write landed; only the read-back did not. Saying "failed" here
        // would invite a retry that stores a second determination.
        setSaveNotice(
          payload.details ||
            "The determination was saved, but it could not be read back. Reopen the screen to see it; do not retry."
        );
        return;
      }
      setScreenState((current) => ({ ...current, screenings: [record, ...current.screenings] }));
      setSaveNotice(`Determination saved — ${summarizeRecord(record)}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "The determination was not saved.");
    } finally {
      setSavePending(false);
    }
  }

  const latest = screenState.screenings[0] ?? null;

  return (
    <article className="module-section-surface" data-testid="model-run-ceqa-vmt-screen">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Scale className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">CEQA VMT screen</p>
            <h2 className="module-section-title">§15064.3 transportation-impact screening</h2>
            <p className="module-section-description">
              Screens this run&apos;s stored VMT KPIs — derived from assignment link volumes
              (Σ volume × length), screening-grade, not measured — against an operator-supplied
              reference baseline using the OPR percent-below threshold. Arithmetic only; nothing is
              estimated when the KPI set lacks VMT.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">Screening-level — not a determination of record</StatusBadge>
      </div>

      {/* THE COLLAPSED FORM. This is the shape a determination is most likely to
          be read at a glance and quoted from, so it carries the same four facts
          the full panel does — via the shared summarizer, which cannot produce a
          line without a tier and a jurisdiction. */}
      {latest ? (
        <p
          className="mt-3 rounded-[0.5rem] border border-border/70 bg-background/60 px-3 py-2 text-xs text-foreground/90"
          data-testid="model-run-ceqa-vmt-latest-summary"
        >
          <span className="font-semibold">Saved determination:</span> {summarizeRecord(latest)} ·
          saved {formatSavedAt(latest.createdAt)}
        </p>
      ) : null}

      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={handleToggle}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {isOpen ? "Hide CEQA screen" : "Run CEQA screen"}
        </Button>
      </div>

      {isOpen ? (
        isLoading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stored KPIs…
          </p>
        ) : error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : kpis !== null ? (
          <>
            <CeqaVmtScreenBody
              scenarioId={runTitle}
              kpis={kpis}
              frameworkResolution={screenState.framework}
              frameworkUnavailableReason={screenState.frameworkUnavailableReason}
              claimTier={screenState.claimTier}
              onSaveDetermination={handleSaveDetermination}
              savePending={savePending}
              saveError={saveError}
              saveNotice={saveNotice}
            />
            {/* The unreadable count is rendered OUTSIDE the "has readable rows"
                branch on purpose. Nested inside it, a run whose determinations
                were ALL unparseable showed nothing at all — no list and no
                warning — which is the silent disappearance this count exists to
                make impossible. A stored determination may go unrendered; it may
                never go unmentioned. */}
            {screenState.unreadableCount > 0 ? (
              <p
                className="mt-4 text-xs text-destructive"
                data-testid="model-run-ceqa-vmt-unreadable"
              >
                {screenState.unreadableCount} saved determination
                {screenState.unreadableCount === 1 ? "" : "s"} for this run could not be read by this
                version of OpenPlan and {screenState.unreadableCount === 1 ? "is" : "are"} not shown.
                This is a defect to report, not an absence of determinations.
              </p>
            ) : null}
            {screenState.screenings.length > 0 ? (
              <div className="mt-5" data-testid="model-run-ceqa-vmt-history">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Saved determinations for this run
                </p>
                <ul className="mt-2 space-y-2">
                  {screenState.screenings.map((record) => (
                    <li
                      key={record.id}
                      className="rounded-[0.5rem] border border-border/60 bg-background/60 px-3 py-2 text-xs text-foreground/90"
                    >
                      <span className="font-medium">{summarizeRecord(record)}</span>
                      <span className="block text-muted-foreground">
                        {record.vmtPerCapita} VMT/capita against a cut line of{" "}
                        {record.thresholdVmtPerCapita} ({Math.round(record.thresholdPct * 100)}% below
                        the {record.referenceLabel} reference of {record.referenceVmtPerCapita}) ·{" "}
                        {claimStatusLabel(record.claimStatus)} · saved {formatSavedAt(record.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null
      ) : null}
    </article>
  );
}
