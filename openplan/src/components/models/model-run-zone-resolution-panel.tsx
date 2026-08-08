"use client";

import { useEffect, useState } from "react";
import { Loader2, Ruler } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  LINK_VALIDATION_NOT_SUPPORTED_CAVEAT,
  bandIntrazonalShare,
} from "@/lib/models/zone-resolution";

/**
 * WHAT THIS RUN'S ZONE SYSTEM CAN SUPPORT, on the run itself.
 *
 * The diagnostic is stored as the `intrazonal_trip_share` KPI. A KPI nothing
 * renders is the defect this repository keeps shipping — complete, tested, and
 * unreachable — so it is mounted here, unfolded by default rather than behind a
 * disclosure, because the moment it matters is the moment a planner is looking
 * at results and wondering why the counts do not line up.
 */

type ZoneResolutionBreakdown = {
  zone_count?: unknown;
  zone_geography?: unknown;
  intrazonal_trips?: unknown;
  sample_trips?: unknown;
  band?: unknown;
  supports_link_level_validation?: unknown;
  interpretation?: unknown;
};

type PanelState =
  | { status: "loading" }
  /** The read failed. NOT the same as "this run has no diagnostic". */
  | { status: "failed"; message: string }
  /** The run predates the diagnostic, or produced no trips. */
  | { status: "absent" }
  | {
      status: "measured";
      sharePct: number;
      zoneCount: number | null;
      /** "tract" | "block_group" when the producer recorded it. */
      zoneGeography: string | null;
      supportsLinkLevelValidation: boolean;
      interpretation: string;
    };

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function ModelRunZoneResolutionPanel({
  modelId,
  modelRunId,
}: {
  modelId: string;
  modelRunId: string;
}) {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/kpis`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          kpis?: Array<Record<string, unknown>>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Failed to load run KPIs");

        const row = (payload.kpis ?? []).find((kpi) => kpi.kpi_name === "intrazonal_trip_share");
        const share = row ? asNumber(row.value) : null;
        if (!row || share === null) {
          // A run from before this diagnostic existed, or one that produced no
          // trips to measure. Either way there is nothing to report — and
          // reporting 0% would be the most flattering possible answer.
          if (!cancelled) setState({ status: "absent" });
          return;
        }

        const breakdown = (row.breakdown_json ?? {}) as ZoneResolutionBreakdown;
        const zoneCount = asNumber(breakdown.zone_count);
        /**
         * THE VERDICT IS COMPUTED HERE, from the number, rather than read back
         * out of whatever the producer stored.
         *
         * The two engines that emit this KPI store different things: the in-app
         * sketch engine writes a full breakdown, and the AequilibraE worker
         * writes the share and the raw counts because the banding is not its to
         * decide. Reading `supports_link_level_validation` off the row therefore
         * treated every worker run as unvalidatable — a false verdict on the one
         * engine whose link volumes people actually compare to counts. Banding
         * at display time gives one answer for both, and bands a run recorded
         * before this judgement existed correctly too.
         */
        const banded = bandIntrazonalShare(share * 100, zoneCount);
        if (cancelled) return;
        setState({
          status: "measured",
          sharePct: banded.intrazonalSharePct ?? share * 100,
          zoneCount,
          zoneGeography:
            typeof breakdown.zone_geography === "string" ? breakdown.zone_geography : null,
          supportsLinkLevelValidation: banded.supportsLinkLevelValidation,
          interpretation: banded.summary,
        });
      } catch (loadError) {
        if (cancelled) return;
        setState({
          status: "failed",
          message: loadError instanceof Error ? loadError.message : "Failed to load run KPIs",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [modelId, modelRunId]);

  if (state.status === "absent") return null;

  return (
    <div className="module-subpanel mt-4" data-testid="zone-resolution-panel">
      <div className="flex items-center gap-2">
        <Ruler className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          What this zone system can support
        </p>
        {state.status === "measured" ? (
          <StatusBadge tone={state.supportsLinkLevelValidation ? "success" : "warning"}>
            {state.supportsLinkLevelValidation
              ? "Link comparison is meaningful"
              : "Link comparison cannot settle this"}
          </StatusBadge>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Measuring how much of this run&apos;s travel reaches the network…
        </p>
      ) : null}

      {state.status === "failed" ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This run&apos;s figures could not be read, so nothing is known here about how much of its
          travel reaches the network. That is a failed read, not a finding that the zone system is
          fine.
        </p>
      ) : null}

      {state.status === "measured" ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            <span className="font-semibold tabular-nums">{state.sharePct.toFixed(1)}%</span> of this
            run&apos;s trips begin and end in the same zone
            {state.zoneCount === null ? "" : ` of ${state.zoneCount.toLocaleString()}`}, so they
            never travel on any link.
          </p>
          {state.interpretation ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {state.interpretation}
            </p>
          ) : null}
          {state.supportsLinkLevelValidation ? null : (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {LINK_VALIDATION_NOT_SUPPORTED_CAVEAT}
            </p>
          )}
          {/*
            THE WAY OUT, named only where OpenPlan can actually offer it.
            A diagnostic that says "split the zone system finer" and leaves a
            planner to find the control is half a feature — and the control
            exists: the launch form's "Zone geography (TAZ resolution)" select
            builds roughly three times as many zones from block groups. It is
            offered ONLY for a tract-resolution run, because a run already at
            block-group resolution has nothing finer to switch to and telling it
            to try would be advice that cannot be taken.
          */}
          {!state.supportsLinkLevelValidation && state.zoneGeography === "tract" ? (
            <p className="mt-1.5 text-xs leading-relaxed text-foreground">
              To model this area at a finer resolution, set{" "}
              <span className="font-semibold">Zone geography (TAZ resolution)</span> to{" "}
              <span className="font-semibold">Block groups (~3x finer zones)</span> when you launch
              the next run. It lowers this share; both resolutions stay screening-grade.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
