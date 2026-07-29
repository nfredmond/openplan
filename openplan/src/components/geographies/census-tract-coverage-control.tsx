"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlaceOfRecord } from "@/lib/geographies/place-of-record";
import {
  describeBlockedCoverage,
  describeCountyCoverage,
  describeCoverageLoadFailure,
  describeCoverageLoadOutcome,
  resolveCensusTractCoverageTarget,
  type CensusTractCoverageOrigin,
} from "@/lib/geographies/census-tract-coverage";
import type { CountyIngestResult } from "@/lib/data-sources/census-tract-ingest";

/**
 * Load census tracts for a county, and say honestly what is there.
 *
 * The equity layer was the one advertised map layer with no in-product writer.
 * Its only trigger was a fire-and-forget `after()` on the home-geography PATCH
 * that swallowed every error, could not be retried, and — until this wave —
 * ran on the default function budget while the ingest route documents needing
 * sixty seconds. A large county was therefore cut off mid-load, leaving a
 * partly-filled layer with no way to see it and no way to try again.
 *
 * Two rules hold everything here together:
 *
 *   1. EVERY COUNT SHOWN IS RE-READ FROM THE DATABASE, never taken from the
 *      ingest response. `ingestCensusTractsForCounty` upserts tract by tract and
 *      returns a PARTIAL `tractsUpserted` when an upsert fails midway, so
 *      echoing its number would assert a completed load that did not complete.
 *   2. A FAILED LOAD STILL RE-CHECKS. The sixty-second cut-off is an expected
 *      outcome, and after it some tracts ARE stored. Reporting "the load failed"
 *      without saying what is now there would present a partial county as nothing.
 *
 * There is no role prop, deliberately. The ingest route's rule is "any signed-in
 * user", stated and justified in its own header because the data is public and
 * cross-tenant. A UI-only gate the server does not enforce would be a second,
 * softer authorization story — and would leave a member staring at an empty
 * layer they are in fact allowed to fill.
 */

type CoverageState =
  | { status: "blocked" }
  | { status: "checking" }
  | { status: "checked"; tractCount: number }
  | { status: "check_failed"; message: string }
  | { status: "loading"; elapsedSeconds: number }
  | { status: "loaded"; result: CountyIngestResult; tractCount: number }
  | { status: "load_failed"; message: string; httpStatus: number | null; tractCount: number };

export function CensusTractCoverageControl(props: {
  /** Identity only — a county boundary polygon is megabytes and is not needed here. */
  place: PlaceOfRecord | null;
  /** Chooses wording only. Never changes which county is derived. */
  origin: CensusTractCoverageOrigin;
  /** True when a successful load changes what THIS workspace's equity layer draws. */
  affectsWorkspaceLayer: boolean;
  onCoverageChanged?: (tractCount: number) => void;
}) {
  const target = resolveCensusTractCoverageTarget(props.place);

  if (target.kind === "blocked") {
    // The workspace panel already has its own empty state for an unset home
    // geography, and the first-run checklist mirrors it. A third account of the
    // same setting would be a third thing to keep true.
    const notes =
      target.reason === "no_place" && props.origin === "workspace_home_geography"
        ? []
        : describeBlockedCoverage(target, { origin: props.origin });

    return notes.length ? <CoverageShell notes={notes} /> : null;
  }

  // Keyed by county so that changing the place RESETS this state by remounting,
  // rather than by writing state from inside an effect.
  return (
    <CountyCoverage
      key={`${target.stateFips}${target.countyFips}`}
      stateFips={target.stateFips}
      countyFips={target.countyFips}
      label={target.label}
      affectsWorkspaceLayer={props.affectsWorkspaceLayer}
      onCoverageChanged={props.onCoverageChanged}
    />
  );
}

function CoverageShell({ notes, children }: { notes: string[]; children?: React.ReactNode }) {
  return (
    <div className="mt-3 space-y-2 rounded-[0.5rem] border border-border/60 bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <MapPinned className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Equity layer coverage
        </p>
      </div>
      {notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
      {children}
    </div>
  );
}

function CountyCoverage({
  stateFips,
  countyFips,
  label,
  affectsWorkspaceLayer,
  onCoverageChanged,
}: {
  stateFips: string;
  countyFips: string;
  label: string | null;
  affectsWorkspaceLayer: boolean;
  onCoverageChanged?: (tractCount: number) => void;
}) {
  const [state, setState] = useState<CoverageState>({ status: "checking" });
  const cancelledRef = useRef(false);

  async function readCoverage(): Promise<number> {
    const response = await fetch(
      `/api/geographies/census-tracts/coverage?stateFips=${stateFips}&countyFips=${countyFips}`
    );
    if (!response.ok) throw new Error("Coverage check failed");
    const body = (await response.json()) as { tractCount?: number };
    return body.tractCount ?? 0;
  }

  useEffect(() => {
    cancelledRef.current = false;

    void (async () => {
      try {
        const tractCount = await readCoverage();
        if (!cancelledRef.current) setState({ status: "checked", tractCount });
      } catch (error) {
        if (!cancelledRef.current) {
          setState({
            status: "check_failed",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFips, countyFips]);

  // Elapsed seconds while loading — a minute of silence with no feedback reads
  // as a hung page.
  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = setInterval(() => {
      setState((current) =>
        current.status === "loading" ? { ...current, elapsedSeconds: current.elapsedSeconds + 1 } : current
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [state.status]);

  async function handleLoad() {
    setState({ status: "loading", elapsedSeconds: 0 });

    // Deliberately NOT aborted on unmount: aborting only stops us listening,
    // while the server keeps writing. Killing the request would waste a load
    // that is going to complete anyway.
    try {
      const response = await fetch("/api/geographies/census-tracts/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ counties: [{ stateFips, countyFips }] }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        results?: CountyIngestResult[];
        error?: string;
      };

      // Re-read even on failure: the 60-second cut-off is an expected outcome,
      // and after it some tracts ARE stored. Saying "the load failed" without
      // saying what is now there would present a partial county as nothing.
      const tractCount = await readCoverage().catch(() => 0);

      if (!response.ok) {
        setState({
          status: "load_failed",
          message: payload.error || `Request failed (${response.status})`,
          httpStatus: response.status,
          tractCount,
        });
        return;
      }

      setState({
        status: "loaded",
        result:
          payload.results?.[0] ?? {
            stateFips,
            countyFips,
            status: "ingested",
            tractsUpserted: 0,
            unmatched: 0,
            error: null,
          },
        tractCount,
      });
      onCoverageChanged?.(tractCount);
    } catch (error) {
      const tractCount = await readCoverage().catch(() => 0);
      setState({
        status: "load_failed",
        message: error instanceof Error ? error.message : "Unknown error",
        httpStatus: null,
        tractCount,
      });
    }
  }

  function describeState(): string[] {
    switch (state.status) {
      case "checking":
        return [`Checking census-tract coverage for ${label ?? "this county"}…`];
      case "check_failed":
        return [
          `Could not check tract coverage for ${label ?? "this county"}: ${state.message}. This says ` +
            "nothing about whether tracts are loaded — the check itself did not complete.",
        ];
      case "loading":
        return [
          `Loading census tracts for ${label ?? "this county"}… ${state.elapsedSeconds}s elapsed. ` +
            "This fetches every tract boundary and its ACS demographics from the US Census Bureau and " +
            "can take up to a minute. Leaving this page does not stop the load.",
        ];
      case "loaded":
        return [
          ...describeCoverageLoadOutcome(state.result, { label, storedTractCount: state.tractCount }),
          ...(affectsWorkspaceLayer
            ? []
            : describeCountyCoverage({
                label,
                storedTractCount: state.tractCount,
                affectsWorkspaceLayer,
              }).slice(-1)),
        ];
      case "load_failed":
        return describeCoverageLoadFailure({
          label,
          message: state.message,
          httpStatus: state.httpStatus,
          storedTractCount: state.tractCount,
        });
      case "checked":
      default:
        return describeCountyCoverage({
          label,
          storedTractCount: state.status === "checked" ? state.tractCount : 0,
          affectsWorkspaceLayer,
        });
    }
  }

  const notes = describeState();
  const showLoadButton = state.status !== "checking" && state.status !== "loading";
  const isReload = state.status === "checked" && state.tractCount > 0;

  return (
    <CoverageShell notes={notes}>
      {showLoadButton ? (
        <div className="space-y-1.5">
          <Button type="button" size="sm" variant={isReload ? "outline" : "default"} onClick={handleLoad}>
            {isReload ? "Reload from the Census Bureau" : "Load census tracts"}
          </Button>
          {isReload ? (
            <p className="text-[0.72rem] text-muted-foreground">
              Reloading re-fetches boundaries and the latest ACS values and overwrites what is stored for
              this county. It never deletes tracts.
            </p>
          ) : null}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      ) : null}
    </CoverageShell>
  );
}
