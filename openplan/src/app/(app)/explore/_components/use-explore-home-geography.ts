"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { studyAreaPrefillFromHomeGeography, type StudyAreaPrefill } from "@/lib/models/study-area";
import type { WorkspaceHomeGeography } from "@/lib/workspaces/home-geography";
import type { CorridorGeometry, HomeGeographyLoadState } from "./_types";

/**
 * Open Analysis Studio on the place this workspace actually works in.
 *
 * WHERE THE ANSWER COMES FROM. `/explore` is a client page, so it asks the same
 * endpoint the dashboard geography panel asks — `GET
 * /api/workspaces/home-geography` — rather than growing a second way to answer
 * one question. Safety reads the same record server-side and prefills the same
 * way; this is that pattern, adapted to a client page, not a new mechanism.
 *
 * THREE OUTCOMES, KEPT APART. A workspace with a stated geography prefills. A
 * workspace WITHOUT one preselects nothing, on purpose. A lookup that fails
 * preselects nothing because it does not know — and says so differently, because
 * telling a planner "no home geography is set" when the request simply failed is
 * a confident answer to a question nobody could answer.
 *
 * A PREFILL IS A STARTING POINT. It is applied once, and only into an empty
 * study area, so it can never overwrite an area the planner picked or the
 * corridor of a run they reloaded while the lookup was in flight. Nothing here
 * ever invents a place: an unset workspace stays empty (see
 * src/lib/workspaces/home-geography.ts).
 */
export function useExploreHomeGeography({
  workspaceId,
  setCorridorGeojson,
}: {
  workspaceId: string;
  setCorridorGeojson: Dispatch<SetStateAction<CorridorGeometry | null>>;
}): { prefill: StudyAreaPrefill; loadState: HomeGeographyLoadState } {
  const [homeGeography, setHomeGeography] = useState<WorkspaceHomeGeography | null>(null);
  const [loadState, setLoadState] = useState<HomeGeographyLoadState>("idle");

  useEffect(() => {
    let isCancelled = false;

    async function loadHomeGeography() {
      if (!workspaceId) {
        setHomeGeography(null);
        setLoadState("idle");
        return;
      }

      setLoadState("loading");

      try {
        const response = await fetch(
          `/api/workspaces/home-geography?workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: "GET" }
        );

        if (!response.ok) {
          throw new Error("Failed to load the workspace home geography.");
        }

        const payload = (await response.json()) as { homeGeography?: WorkspaceHomeGeography | null };
        if (isCancelled) return;

        setHomeGeography(payload.homeGeography ?? null);
        setLoadState("loaded");
      } catch {
        if (!isCancelled) {
          setHomeGeography(null);
          setLoadState("unavailable");
        }
      }
    }

    void loadHomeGeography();

    return () => {
      isCancelled = true;
    };
  }, [workspaceId]);

  const prefill = useMemo(() => studyAreaPrefillFromHomeGeography(homeGeography), [homeGeography]);

  const prefillAppliedRef = useRef(false);

  useEffect(() => {
    if (prefillAppliedRef.current) return;
    const geometry = prefill.geometry;
    if (!geometry) return;

    prefillAppliedRef.current = true;
    setCorridorGeojson((current) => current ?? geometry);
  }, [prefill, setCorridorGeojson]);

  return { prefill, loadState };
}
