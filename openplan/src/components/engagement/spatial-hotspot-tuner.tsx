"use client";

import { useState } from "react";
import { ParticipationDashboard } from "@/components/engagement/participation-dashboard";
import { ParticipationHeatmapMap, type HeatmapPoint } from "@/components/engagement/participation-heatmap-map";
import {
  HOTSPOT_DEFAULT_EPS_METERS,
  HOTSPOT_DEFAULT_MIN_POINTS,
  hotspotsToFeatureCollection,
  type HotspotAnalysis,
} from "@/lib/engagement/hotspots";
import type { summarizeEngagementItems } from "@/lib/engagement/summary";
import type { IntakeTrend } from "@/lib/engagement/participation-dashboard";
import { AerialOrthoLayersPanel } from "@/components/cartographic/aerial-ortho-layers-panel";

type EngagementCounts = ReturnType<typeof summarizeEngagementItems>;

/**
 * A CLUSTER RADIUS IS A CLAIM ABOUT GEOGRAPHIC SCALE, AND IT CANNOT BE ONE NUMBER.
 *
 * The hotspot test is DBSCAN: `eps` is how far apart two comments can be and
 * still count as the same place, and `minPoints` is how many it takes before a
 * place is a cluster at all. 250 m and 5 points are reasonable defaults for a
 * downtown corridor. They are the wrong question entirely for a rural county,
 * where 250 m separates nothing and every comment is noise, and they are too
 * coarse for a single intersection redesign.
 *
 * The page rendered those defaults and offered no way past them, which made a
 * scale assumption fixed in code for every agency in the country — the thing
 * this repo is not allowed to do. `/api/engagement/campaigns/[id]/hotspots`
 * was built for exactly this, with the clamps already in it (25–2000 m, 2–50
 * points), and had no caller.
 *
 * WHAT IS AND IS NOT RE-COMPUTED. Only the clustering. Sentiment comes from the
 * campaign's E1 synthesis and is not touched, so no AI call happens and there is
 * nothing to rate-limit; the significance test re-runs over the new clusters
 * with the same Bonferroni adjustment. Changing the radius therefore changes
 * WHERE the test looks, never how strict it is.
 *
 * THE FIRST RENDER IS THE SERVER'S. The initial analysis is passed in already
 * computed, so the map and the dashboard are complete before any JavaScript
 * runs and a planner who never touches the controls sees exactly what they saw
 * before. Tuning is an addition to the surface, not a precondition for it.
 */
export function SpatialHotspotTuner({
  campaignId,
  points,
  initialHotspots,
  counts,
  categories,
  intake,
}: {
  campaignId: string;
  points: HeatmapPoint[];
  initialHotspots: HotspotAnalysis;
  counts: EngagementCounts;
  categories: Array<{ id: string; label: string | null; color?: string | null }>;
  intake: IntakeTrend;
}) {
  const [hotspots, setHotspots] = useState(initialHotspots);
  const [eps, setEps] = useState(initialHotspots.epsMeters || HOTSPOT_DEFAULT_EPS_METERS);
  const [minPoints, setMinPoints] = useState(initialHotspots.minPoints || HOTSPOT_DEFAULT_MIN_POINTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recompute(nextEps: number, nextMinPoints: number) {
    setError(null);
    setLoading(true);
    try {
      const query = new URLSearchParams({ eps: String(nextEps), minPoints: String(nextMinPoints) });
      const response = await fetch(
        `/api/engagement/campaigns/${campaignId}/hotspots?${query.toString()}`
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        // The analysis on screen is still the one the server computed, and it is
        // still true — it is just not the one that was asked for. Saying which
        // settings are actually displayed is the difference between a stale
        // reading and a wrong one.
        setError(body?.error ?? "Could not recompute clusters. The reading below is unchanged.");
        return;
      }
      const body = (await response.json()) as { hotspots: HotspotAnalysis };
      setHotspots(body.hotspots);
    } catch {
      setError("Could not reach OpenPlan. The reading below is unchanged.");
    } finally {
      setLoading(false);
    }
  }

  // Read off the ANALYSIS rather than the inputs: the route clamps, so what came
  // back may not be what was asked for, and the labels must describe the map.
  const appliedEps = hotspots.epsMeters;
  const appliedMinPoints = hotspots.minPoints;
  const pendingChange = appliedEps !== eps || appliedMinPoints !== minPoints;
  const features = hotspotsToFeatureCollection(hotspots.clusters);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3">
        <AerialOrthoLayersPanel compact />
      </div>
      <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            <span>Cluster radius (metres)</span>
            <input
              type="number"
              min={25}
              max={2000}
              step={25}
              value={eps}
              onChange={(event) => setEps(Number(event.target.value))}
              className="w-32 rounded-md border border-border/70 bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            <span>Minimum comments</span>
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={minPoints}
              onChange={(event) => setMinPoints(Number(event.target.value))}
              className="w-32 rounded-md border border-border/70 bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={() => void recompute(eps, minPoints)}
            disabled={loading || !pendingChange}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-semibold text-background transition-opacity disabled:opacity-50"
          >
            {loading ? "Recomputing…" : "Apply"}
          </button>
          {appliedEps !== HOTSPOT_DEFAULT_EPS_METERS || appliedMinPoints !== HOTSPOT_DEFAULT_MIN_POINTS ? (
            <button
              type="button"
              onClick={() => {
                setEps(HOTSPOT_DEFAULT_EPS_METERS);
                setMinPoints(HOTSPOT_DEFAULT_MIN_POINTS);
                void recompute(HOTSPOT_DEFAULT_EPS_METERS, HOTSPOT_DEFAULT_MIN_POINTS);
              }}
              disabled={loading}
              className="rounded-md border border-border/70 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              Reset
            </button>
          ) : null}
        </div>

        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Showing clusters of at least {appliedMinPoints} comments within {appliedEps} m of one another.
          The right radius depends on how spread out your study area is — a downtown block and a rural
          county are not the same question. Changing it changes where the test looks, not how strict it
          is.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
          >
            {error}
          </p>
        ) : null}
      </div>

      {/*
        The condition is on FEATURES, not clusters — a cluster whose convex hull
        could not be built has nothing to draw, and this is the same test the
        page made before the control existed. Keeping it identical means the
        control changed what a planner can ask for and nothing else.
      */}
      {points.length > 0 || features.features.length > 0 ? (
        <ParticipationHeatmapMap
          privateAerialOrthos
          points={points}
          hotspots={features}
          sentimentAvailable={hotspots.sentimentAvailable}
        />
      ) : null}

      <ParticipationDashboard
        counts={counts}
        categories={categories}
        hotspots={hotspots}
        intake={intake}
      />
    </div>
  );
}
