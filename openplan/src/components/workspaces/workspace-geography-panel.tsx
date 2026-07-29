"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { CensusTractCoverageControl } from "@/components/geographies/census-tract-coverage-control";
import { placeIdentityOnly } from "@/lib/geographies/place-of-record";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import {
  homeGeographyLabel,
  placeOfRecordFromHomeGeography,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

/**
 * Set the workspace's HOME GEOGRAPHY — where this agency actually works.
 *
 * WHY THIS EXISTS
 *   The home-geography columns, their API, and four readers all shipped before
 *   anything could WRITE one. The map camera
 *   (cartographic-shell.tsx), the stage-gate jurisdiction binding
 *   (stage-gates/template-loader.ts), the equity choropleth's tract ingest, and
 *   Safety's study-area prefill were each already asking the workspace where it
 *   is — and every workspace answered "unset", forever, because no surface could
 *   say otherwise. This panel is that missing surface; it is the only reason the
 *   rest of that spine does anything.
 *
 * TWO RULES INHERITED FROM THE SUBSYSTEM
 *   1. Never name a fallback place. When the geography is unset this says so and
 *      describes the CONSEQUENCE (a neutral continental map, unbound
 *      jurisdiction rules). Suggesting a plausible place is the exact defect
 *      src/lib/workspaces/home-geography.ts exists to prevent.
 *   2. One geography front door. The picker is `StudyAreaPicker`, the app's
 *      existing TIGERweb-backed any-place selector. A second selector here would
 *      be a second thing to keep correct — see CLAUDE.md non-negotiable #1.
 *
 * VISIBLE TO EVERY MEMBER, EDITABLE BY OWNER/ADMIN
 *   This deliberately differs from `WorkspaceTeamPanel`, which renders nothing
 *   for a member. An unset geography changes what every member sees on every
 *   map, so hiding the explanation would leave them with a neutral map and no
 *   account of why. They see the state; they are told who can change it.
 */

type WorkspaceGeographyPanelProps = {
  workspaceId: string;
  /** Only owners and admins may write it; the API enforces this too. */
  canManage: boolean;
};

export function WorkspaceGeographyPanel({ workspaceId, canManage }: WorkspaceGeographyPanelProps) {
  const router = useRouter();
  const [geography, setGeography] = useState<WorkspaceHomeGeography | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // `StudyAreaPicker` is a controlled component around the GeoJSON text of the
  // chosen area; this panel only needs the resolved place, but must still hold
  // that state for the picker to render its own selection summary.
  const [corridorText, setCorridorText] = useState("");
  const [pendingPlace, setPendingPlace] = useState<PlaceBoundaryResponse | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces/home-geography?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to load the workspace geography");
      setGeography((body.homeGeography as WorkspaceHomeGeography | null) ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load the workspace geography");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetPicker() {
    setCorridorText("");
    setPendingPlace(null);
  }

  /**
   * A hand-drawn polygon arrives as `null` — it has no place identity, and the
   * API requires a resolvable place reference so the server can re-derive the
   * boundary from the source of record. Drop it rather than storing an
   * unverifiable extent.
   */
  function handlePlaceResolved(place: PlaceBoundaryResponse | null) {
    setPendingPlace(place);
    setNotice(null);
    setError(null);
  }

  async function save() {
    if (!pendingPlace) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/workspaces/home-geography", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          kind: pendingPlace.kind,
          geoid: pendingPlace.geoid,
          ...(pendingPlace.label ? { label: pendingPlace.label } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not set the workspace geography");
      setGeography((body.homeGeography as WorkspaceHomeGeography | null) ?? null);
      setEditing(false);
      resetPicker();
      // Say what the server actually kicked off, and only when it applies. The
      // tract load is best-effort and asynchronous, so promising populated
      // equity data would be an overclaim.
      // Just "Saved." The old text promised that census tracts "are loading in
      // the background — the equity layer fills in shortly", which this code
      // could not observe and, for a large county on the default function
      // budget, was not true. The coverage control below reports what is
      // actually stored, and offers a retry.
      setNotice("Saved.");
      // The first-run checklist and the map camera are rendered on the server
      // from this same setting. Without a refresh the page would show the
      // panel saying "Saved" directly beneath a step still claiming the
      // geography is unset — one screen contradicting itself.
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not set the workspace geography");
    } finally {
      setWorking(false);
    }
  }

  async function clear() {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/workspaces/home-geography", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not clear the workspace geography");
      setGeography(null);
      setEditing(false);
      resetPicker();
      setNotice("Cleared. Maps return to the neutral continental view until a geography is set.");
      router.refresh();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Could not clear the workspace geography");
    } finally {
      setWorking(false);
    }
  }

  const label = homeGeographyLabel(geography);

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Workspace geography">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Workspace geography</h2>
        {label ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {label}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading workspace geography…</p>
      ) : label ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan use{" "}
          <span className="font-medium text-foreground">{label}</span>{" "}
          as this workspace&apos;s place of record.
        </p>
      ) : (
        <div className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
          <Globe2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            <span className="font-medium text-foreground">No home geography set.</span> Maps open on a
            neutral continental view, no jurisdiction-specific stage-gate rules are bound, and equity
            layers stay empty until a place is chosen.
            {canManage ? "" : " Ask a workspace owner or admin to set one."}
          </p>
        </div>
      )}

      {!loading ? (
        <CensusTractCoverageControl
          place={placeIdentityOnly(placeOfRecordFromHomeGeography(geography))}
          origin="workspace_home_geography"
          affectsWorkspaceLayer
          // The first-run checklist and the map camera render from this same
          // setting on the server, so a filled layer must not sit under a
          // screen still describing it as empty.
          onCoverageChanged={() => router.refresh()}
        />
      ) : null}

      {canManage && !loading ? (
        editing ? (
          <div className="mt-4 space-y-3">
            <StudyAreaPicker
              corridorText={corridorText}
              onCorridorChange={setCorridorText}
              onPlaceResolved={handlePlaceResolved}
              // No model run follows a workspace-configuration choice, so the
              // engine-routing warning would be advice about a run that is not
              // going to happen.
              showRunEngineHint={false}
            />

            {corridorText && !pendingPlace ? (
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A drawn area can&apos;t be a workspace geography — it has no official boundary to
                re-resolve. Search for the county, city, CDP, or metro area instead.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void save()} disabled={!pendingPlace || working}>
                {working
                  ? "Saving…"
                  : pendingPlace
                    ? // The resolver's label is nullable; fall back to generic wording
                      // rather than rendering an empty or "null" place name.
                      `Use ${pendingPlace.label ?? "this place"}`
                    : "Select a place"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={working}
                onClick={() => {
                  setEditing(false);
                  resetPicker();
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={label ? "outline" : "default"}
              disabled={working}
              onClick={() => {
                setEditing(true);
                setNotice(null);
                setError(null);
              }}
            >
              {label ? "Change geography" : "Set workspace geography"}
            </Button>
            {label ? (
              <Button type="button" variant="outline" disabled={working} onClick={() => void clear()}>
                {working ? "Clearing…" : "Clear"}
              </Button>
            ) : null}
          </div>
        )
      ) : null}

      {notice ? <p className="mt-3 text-sm text-muted-foreground">{notice}</p> : null}

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
