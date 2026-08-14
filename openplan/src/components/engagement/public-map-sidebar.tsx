"use client";

import type { EngagementGeometry } from "@/lib/engagement/geometry";
import type { EngagementDrawMode } from "@/lib/engagement/draw-state";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import {
  PortalSubmissionForm,
  type PortalFormCategory,
} from "./portal-submission-form";

/**
 * The shape a category arrives in on this surface. Re-exported under its old
 * name because `portal-surface-props.ts` and the shell already speak it, and
 * renaming a type across a server/client seam buys nothing.
 */
export type SidebarCategory = PortalFormCategory;

/**
 * THE RAIL BESIDE THE FULL-SCREEN MAP — now an adapter, not an implementation.
 *
 * WHAT THIS FILE USED TO BE. It held a complete, guided, fully translated
 * submission form, which was the SECOND implementation of the form that already
 * lived inside `public-engagement-portal.tsx`. Both were reachable by the
 * public — this one at `/engage/<token>`, the other at `/engage/<token>/about`
 * and `/embed/<token>` — and the older one had fallen behind on things residents
 * feel: it answered an API refusal in English on a Spanish page, it let an empty
 * comment reach the server, it did not send through `submitPortalInput`, and it
 * printed a server-composed English sentence describing the map.
 *
 * The form moved to `portal-submission-form.tsx` on 2026-08-14 and all three
 * routes render it. What is left here is the one fact this surface knows that
 * the others do not: the map is not inside the form. A full-screen stage owns
 * the drawing and the shell owns the geometry, so this component's whole job is
 * to say so.
 *
 * KEPT AS A NAMED EXPORT rather than deleted at the call site: `PublicMapShell`
 * and its tests address this surface by this name, and a rename would be churn
 * that proves nothing. The test ids the rail is found by (`portal-guided-form`,
 * `portal-step-*`, `portal-location-status`) belong to the shared form and are
 * unchanged, which is what makes this a move rather than a rewrite.
 */
export function PublicMapSidebar({
  shareToken,
  acceptingSubmissions,
  categories,
  demographicsEnabled,
  translator,
  geometry,
  onClearGeometry,
  drawMode,
  onDrawModeChange,
  mapAvailable,
  previewMode = false,
  className,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: SidebarCategory[];
  demographicsEnabled: boolean;
  translator: PortalTranslator;
  /** What the resident drew on the stage, owned by the shell so the map and the rail agree. */
  geometry: EngagementGeometry | null;
  onClearGeometry: () => void;
  drawMode: EngagementDrawMode;
  onDrawModeChange: (mode: EngagementDrawMode) => void;
  /** Whether there is a map beside this rail at all. See `PortalFormPlace`. */
  mapAvailable: boolean;
  previewMode?: boolean;
  className?: string;
}) {
  return (
    <PortalSubmissionForm
      shareToken={shareToken}
      acceptingSubmissions={acceptingSubmissions}
      categories={categories}
      demographicsEnabled={demographicsEnabled}
      translator={translator}
      place={{
        source: "stage",
        geometry,
        onClearGeometry,
        drawMode,
        onDrawModeChange,
        mapAvailable,
      }}
      previewMode={previewMode}
      className={className}
    />
  );
}
