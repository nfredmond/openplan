"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2, MapPin, Save, Spline, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
import {
  CORRIDOR_LOS_GRADES,
  CORRIDOR_LOS_GRADE_LABELS,
  CORRIDOR_TYPE_LABELS,
  CORRIDOR_TYPES,
  DEFAULT_CORRIDOR_TYPE,
  type CorridorLosGrade,
  type CorridorType,
} from "@/lib/cartographic/corridor-vocabulary";
import type { ProjectCorridor } from "@/lib/cartographic/project-corridor-record";

/**
 * Putting a project on the map.
 *
 * Three backdrop layers — project markers, study corridors, and RTP pins — read
 * columns that nothing in the product ever wrote. Their only author was a demo
 * seed, so once it was deleted a project created by using the app could not
 * appear on the map at all, and a corridor could not be created by any means.
 * This panel is the write path for the first two.
 *
 * It reuses the geometry picker the engagement portal and the study-area picker
 * already share, in single-mode form: "point" for the project marker, "line" for
 * a corridor. That picker is keyboard-operable (WCAG 2.1.1) and caps vertices,
 * so neither behavior had to be reinvented here.
 */

const GeometryPickerMap = dynamic(
  () => import("@/components/engagement/geometry-picker-map").then((m) => m.GeometryPickerMap),
  {
    ssr: false,
    loading: () => <div className="h-[300px] w-full animate-pulse rounded-xl border border-border bg-muted/20" />,
  },
);

type CorridorDraft = {
  name: string;
  corridorType: CorridorType;
  losGrade: CorridorLosGrade | "";
  geometry: EngagementGeometry | null;
};

const EMPTY_DRAFT: CorridorDraft = {
  name: "",
  corridorType: DEFAULT_CORRIDOR_TYPE,
  losGrade: "",
  geometry: null,
};

const FIELD_LABEL_CLASS =
  "text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function isLineString(geometry: EngagementGeometry | null): geometry is Extract<EngagementGeometry, { type: "LineString" }> {
  return geometry?.type === "LineString";
}

function isPoint(geometry: EngagementGeometry | null): geometry is Extract<EngagementGeometry, { type: "Point" }> {
  return geometry?.type === "Point";
}

/** Round to ~1 cm so a stored coordinate is not 15 digits of float noise. */
function round(value: number): number {
  return Number(value.toFixed(6));
}

export function ProjectMapPresence({
  projectId,
  initialLatitude,
  initialLongitude,
  initialCorridors,
  /**
   * Where the picker opens. The caller passes the workspace's own home
   * geography when it has one; otherwise this falls back to the neutral
   * continental view. No place is hardcoded — an agency in Ohio must not open
   * its map over somebody else's county.
   */
  initialCenter = CONTINENTAL_US_CENTER,
  initialZoom = 3.5,
  canWrite = true,
}: {
  projectId: string;
  initialLatitude: number | null;
  initialLongitude: number | null;
  initialCorridors: ProjectCorridor[];
  initialCenter?: [number, number];
  initialZoom?: number;
  canWrite?: boolean;
}) {
  const router = useRouter();

  const [latitude, setLatitude] = useState(initialLatitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(initialLongitude?.toString() ?? "");
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [corridors, setCorridors] = useState<ProjectCorridor[]>(initialCorridors);
  const [draft, setDraft] = useState<CorridorDraft>(EMPTY_DRAFT);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSavingCorridor, setIsSavingCorridor] = useState(false);
  const [corridorError, setCorridorError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasLocation = initialLatitude !== null && initialLongitude !== null;

  async function saveLocation(nextLatitude: number | null, nextLongitude: number | null) {
    setIsSavingLocation(true);
    setLocationMessage(null);
    setLocationError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/location`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latitude: nextLatitude, longitude: nextLongitude }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to save project location");

      setLocationMessage(
        nextLatitude === null
          ? "Location cleared. This project no longer appears on the map."
          : "Location saved. This project now appears on the map backdrop."
      );
      router.refresh();
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Failed to save project location");
    } finally {
      setIsSavingLocation(false);
    }
  }

  function handleSaveLocation() {
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);

    if (!latitude.trim() || !longitude.trim()) {
      setLocationError("Enter both a latitude and a longitude, or clear the location.");
      return;
    }
    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      setLocationError("Latitude and longitude must be numbers.");
      return;
    }
    if (parsedLatitude < -90 || parsedLatitude > 90) {
      setLocationError("Latitude must be between -90 and 90.");
      return;
    }
    if (parsedLongitude < -180 || parsedLongitude > 180) {
      setLocationError("Longitude must be between -180 and 180.");
      return;
    }

    void saveLocation(round(parsedLatitude), round(parsedLongitude));
  }

  function handleLocationPicked(geometry: EngagementGeometry | null) {
    if (!isPoint(geometry)) return;
    const [pickedLongitude, pickedLatitude] = geometry.coordinates;
    setLatitude(String(round(pickedLatitude)));
    setLongitude(String(round(pickedLongitude)));
    setLocationError(null);
    setLocationMessage(null);
  }

  async function handleCreateCorridor() {
    if (!draft.name.trim()) {
      setCorridorError("Give the corridor a name.");
      return;
    }
    if (!isLineString(draft.geometry)) {
      setCorridorError("Draw the corridor on the map first — a corridor needs at least two points.");
      return;
    }

    setIsSavingCorridor(true);
    setCorridorError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/corridors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          corridorType: draft.corridorType,
          losGrade: draft.losGrade || null,
          geometry: draft.geometry,
        }),
      });
      const payload = (await response.json()) as { corridor?: ProjectCorridor; error?: string };
      if (!response.ok || !payload.corridor) {
        throw new Error(payload.error || "Failed to create corridor");
      }

      setCorridors((previous) => [...previous, payload.corridor as ProjectCorridor]);
      setDraft(EMPTY_DRAFT);
      setIsDrawing(false);
      router.refresh();
    } catch (error) {
      setCorridorError(error instanceof Error ? error.message : "Failed to create corridor");
    } finally {
      setIsSavingCorridor(false);
    }
  }

  async function handleDeleteCorridor(corridorId: string) {
    setDeletingId(corridorId);
    setCorridorError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/corridors/${corridorId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to delete corridor");
      }
      setCorridors((previous) => previous.filter((corridor) => corridor.id !== corridorId));
      router.refresh();
    } catch (error) {
      setCorridorError(error instanceof Error ? error.message : "Failed to delete corridor");
    } finally {
      setDeletingId(null);
    }
  }

  const draftVertexCount = isLineString(draft.geometry) ? draft.geometry.coordinates.length : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Map location</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasLocation
                ? "This project has a marker on the cartographic backdrop."
                : "This project has no location yet, so it does not appear on the cartographic backdrop."}
            </p>
          </div>
        </div>

        {canWrite ? (
          <>
            <div className="mt-3">
              <GeometryPickerMap
                onGeometryChange={handleLocationPicked}
                initialMode="point"
                allowedModes={["point"]}
                initialCenter={
                  initialLatitude !== null && initialLongitude !== null
                    ? [initialLongitude, initialLatitude]
                    : initialCenter
                }
                initialZoom={initialLatitude !== null ? 11 : initialZoom}
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="project-location-latitude" className={FIELD_LABEL_CLASS}>
                  Latitude
                </label>
                <Input
                  id="project-location-latitude"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                  inputMode="decimal"
                  placeholder="39.9612"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="project-location-longitude" className={FIELD_LABEL_CLASS}>
                  Longitude
                </label>
                <Input
                  id="project-location-longitude"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                  inputMode="decimal"
                  placeholder="-82.9988"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleSaveLocation} disabled={isSavingLocation}>
                {isSavingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                Save location
              </Button>
              {hasLocation ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingLocation}
                  onClick={() => {
                    setLatitude("");
                    setLongitude("");
                    void saveLocation(null, null);
                  }}
                >
                  <X className="h-4 w-4" />
                  Clear location
                </Button>
              ) : null}
              {locationMessage ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-300">{locationMessage}</p>
              ) : null}
              {locationError ? <p className="text-sm text-destructive">{locationError}</p> : null}
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            You have read-only access to this workspace, so the project location cannot be changed here.
          </p>
        )}
      </section>

      <section className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Study corridors</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Planning-level corridor lines drawn on the backdrop. These are display corridors, not a
              transportation-model network package.
            </p>
          </div>
          {canWrite && !isDrawing ? (
            <Button type="button" variant="outline" onClick={() => setIsDrawing(true)}>
              <Spline className="h-4 w-4" />
              Draw a corridor
            </Button>
          ) : null}
        </div>

        {corridors.length === 0 && !isDrawing ? (
          <p className="mt-3 text-xs text-muted-foreground">No corridors yet.</p>
        ) : null}

        {corridors.length > 0 ? (
          <ul className="mt-3 divide-y divide-border/60 rounded-[0.4rem] border border-border/60">
            {corridors.map((corridor) => (
              <li key={corridor.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{corridor.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {CORRIDOR_TYPE_LABELS[corridor.corridorType as CorridorType] ?? corridor.corridorType}
                    {corridor.losGrade ? ` · LOS ${corridor.losGrade}` : " · no LOS grade"}
                  </p>
                </div>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete corridor ${corridor.name}`}
                    disabled={deletingId === corridor.id}
                    onClick={() => void handleDeleteCorridor(corridor.id)}
                  >
                    {deletingId === corridor.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canWrite && isDrawing ? (
          <div className="mt-4 space-y-3 rounded-[0.4rem] border border-dashed border-border/70 p-3">
            <GeometryPickerMap
              onGeometryChange={(geometry) => setDraft((previous) => ({ ...previous, geometry }))}
              initialMode="line"
              allowedModes={["line"]}
              initialCenter={
                initialLatitude !== null && initialLongitude !== null
                  ? [initialLongitude, initialLatitude]
                  : initialCenter
              }
              initialZoom={initialLatitude !== null ? 11 : initialZoom}
            />

            <p className="text-xs text-muted-foreground">
              {draftVertexCount >= 2
                ? `${draftVertexCount} points drawn.`
                : "Click along the street or route to draw the corridor. At least two points are needed."}
            </p>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="corridor-name" className={FIELD_LABEL_CLASS}>
                  Name
                </label>
                <Input
                  id="corridor-name"
                  value={draft.name}
                  onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                  placeholder="Main Street"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="corridor-type" className={FIELD_LABEL_CLASS}>
                  Type
                </label>
                <select
                  id="corridor-type"
                  className={SELECT_CLASS}
                  value={draft.corridorType}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, corridorType: event.target.value as CorridorType }))
                  }
                >
                  {CORRIDOR_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CORRIDOR_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="corridor-los" className={FIELD_LABEL_CLASS}>
                  LOS grade
                </label>
                <select
                  id="corridor-los"
                  className={SELECT_CLASS}
                  value={draft.losGrade}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, losGrade: event.target.value as CorridorLosGrade | "" }))
                  }
                >
                  {/* Optional on purpose: an ungraded corridor is a normal state
                      and paints with the neutral base color. */}
                  <option value="">Not graded</option>
                  {CORRIDOR_LOS_GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {CORRIDOR_LOS_GRADE_LABELS[grade]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void handleCreateCorridor()} disabled={isSavingCorridor}>
                {isSavingCorridor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save corridor
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isSavingCorridor}
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setIsDrawing(false);
                  setCorridorError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {corridorError ? <p className="mt-3 text-sm text-destructive">{corridorError}</p> : null}
      </section>
    </div>
  );
}
