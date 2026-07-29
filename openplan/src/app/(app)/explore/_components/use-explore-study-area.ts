"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { resolveStudyArea, type ResolvedStudyArea } from "@/lib/models/study-area";
import type { PlaceOfRecord } from "@/lib/geographies/place-of-record";
import {
  placeOfRecordFromHomeGeography,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import type { CorridorGeometry, HomeGeographyLoadState } from "./_types";

/**
 * Which area Analysis Studio opens on, and why.
 *
 * PRECEDENCE IS NOT DECIDED HERE. `resolveStudyArea` states it once for the
 * whole app — the record's own area, then the project, then the workspace home,
 * then the previous run, then nothing — and Explore is the third front door to
 * be routed through it, after Safety and county onboarding. Before that, this
 * hook read the workspace's home geography and NOTHING else, so an agency whose
 * workspace home is a county but whose projects are corridors or cities opened
 * every study on the county without being told a narrower area of record
 * existed. That was the silent version of the defect: the number was wrong and
 * nothing on screen said so.
 *
 * WHY THE TWO CANDIDATES ARRIVE BY DIFFERENT ROADS. The project this page was
 * opened for is named in the URL, so the server component above can read its
 * area of record from the row — the same read Safety and county onboarding do,
 * and the reason no second endpoint was invented for it. The workspace is NOT
 * known at render time here: `/explore` resolves it client-side, and the
 * bootstrap flow can create one mid-session without a navigation, so its home
 * geography is asked for over the same endpoint the dashboard geography panel
 * asks — `GET /api/workspaces/home-geography`. Two lifecycles, two reads, one
 * resolver.
 *
 * THREE OUTCOMES, KEPT APART. A workspace with a stated geography prefills. A
 * workspace WITHOUT one preselects nothing, on purpose. A lookup that fails
 * preselects nothing because it does not know — and says so differently, because
 * telling a planner "no home geography is set" when the request simply failed is
 * a confident answer to a question nobody could answer.
 *
 * A PREFILL IS A STARTING POINT. It is applied once, and only into an empty
 * study area, so it can never overwrite an area the planner picked or the
 * corridor of a run they reloaded while the lookup was in flight. That gate is
 * this hook's job because Explore fetches its geography AFTER the field is on
 * screen; the server-rendered pages seed `useState` instead and need no ref.
 * Nothing here ever invents a place: with neither candidate carrying a boundary
 * the field stays empty (see src/lib/workspaces/home-geography.ts).
 */
export function useExploreStudyArea({
  workspaceId,
  projectPlace,
  setCorridorGeojson,
}: {
  workspaceId: string;
  /**
   * The area of record of the project this page was OPENED for, resolved on the
   * server. Null when no project was named, when it is not in this workspace, or
   * when its row could not be read — each of which the page discloses in its own
   * words rather than letting the workspace county stand in silently.
   */
  projectPlace: PlaceOfRecord | null;
  setCorridorGeojson: Dispatch<SetStateAction<CorridorGeometry | null>>;
}): { studyArea: ResolvedStudyArea; loadState: HomeGeographyLoadState } {
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

  // The project candidate is in hand from the first render; the workspace home
  // arrives later. That ordering is safe precisely BECAUSE the project outranks
  // it: applying a project area immediately can never be overtaken by a lower
  // candidate, and a page with no project area simply waits for the fetch.
  const studyArea = useMemo(
    () =>
      resolveStudyArea({
        project: projectPlace,
        workspaceHome: placeOfRecordFromHomeGeography(homeGeography),
      }),
    [projectPlace, homeGeography]
  );

  const prefillAppliedRef = useRef(false);

  useEffect(() => {
    if (prefillAppliedRef.current) return;
    const geometry = studyArea.geometry;
    if (!geometry) return;

    prefillAppliedRef.current = true;
    setCorridorGeojson((current) => current ?? geometry);
  }, [studyArea, setCorridorGeojson]);

  return { studyArea, loadState };
}
