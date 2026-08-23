"use client";

/**
 * The mission map — where a flight's held imagery actually sits on the ground.
 *
 * TWO LAYERS, EACH WITH A TOGGLE AND A STATED ABSENCE:
 *
 *   * The ORTHOMOSAIC PREVIEW: a worker-produced PNG held in OpenPlan's own
 *     custody, drawn as a Mapbox image source at the WGS84 bounds the worker
 *     read from the GeoTIFF's own tags. The server loader
 *     (`lib/aerial/ortho-preview.ts`) decided whether one may be drawn; this
 *     component receives EITHER a preview or the loader's refusal sentence and
 *     renders whichever it was handed. It never infers a position.
 *   * PHOTO LOCATIONS: the mission's uploaded source photos that carry GPS in
 *     their own EXIF, fetched from the imagery route BY URL (a string seam —
 *     the imagery lane owns that route; importing from it would couple the two).
 *
 * THE HONESTY RULES, same as every map in this repo: an empty layer says why
 * it is empty; a failed fetch renders as a failure, never as "no photos"; a
 * bounds rectangle is re-validated HERE before the layer mounts, because a map
 * that draws whatever it is handed will eventually paint an image over a
 * continent; and a deployment with no Mapbox key is told its key is missing
 * rather than shown a blank box.
 *
 * MEASUREMENT IS DEFERRED, and the card says so where a user would look for
 * it: the preview is a rendering for orientation, and measuring belongs in GIS
 * against the GeoTIFF until a measurement story exists here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Map as MapIcon } from "lucide-react";

import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { extractArtifactGeoref } from "@/lib/aerial/artifact-custody";
import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { useAerialOrthoLayers } from "@/components/cartographic/aerial-ortho-layer-context";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

const HAS_UNUSABLE_MAPBOX_TOKEN =
  hasInvalidPublicMapboxToken(
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  ) && !MAPBOX_ACCESS_TOKEN;

const ORTHO_SOURCE_ID = "aerial-mission-ortho-preview";
const ORTHO_LAYER_ID = "aerial-mission-ortho-preview-layer";
const PHOTOS_SOURCE_ID = "aerial-mission-photo-points";
const PHOTOS_LAYER_ID = "aerial-mission-photo-points-layer";

/** Photo dots: the AOI orange family, distinct from every backdrop layer. */
const PHOTO_DOT_COLOR = "#e45635";

export type AerialMissionMapPreview = {
  /** Present on the authenticated mission page so this preview can become a workspace layer. */
  custodyId?: string;
  /** Short-lived signed URL for the held preview PNG. Never rendered as a link. */
  url: string;
  /** WGS84 [west, south, east, north] — re-validated here before the layer mounts. */
  bounds: [number, number, number, number];
  crs: string | null;
  pixelSizeM: number | null;
};

export type AerialMissionMapProps = {
  missionId: string;
  /** The ortho preview the server loader authorized, or null when it refused. */
  preview: AerialMissionMapPreview | null;
  /**
   * Why there is no preview, in the loader's own words (a typed refusal or a
   * read failure). Null exactly when `preview` is set.
   */
  previewNotice: string | null;
  /**
   * The operator's half of `previewNotice` — a database message or a missing
   * deployment key. Rendered behind a disclosure under its own notice so the
   * planner's line stays a planner's line and the fact still reaches the person
   * who can act on it.
   */
  previewNoticeDetail?: string | null;
};

type PhotoPoint = {
  id: string;
  lat: number;
  lon: number;
  filename: string | null;
};

type PhotoState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; points: PhotoPoint[]; withoutLocation: number };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Read the imagery route's rows defensively. The route is another lane's file
 * and this component reaches it only by URL, so the parse must not assume more
 * than the pinned column names (`gps_lat` / `gps_lon`, per the imagery table).
 * A row without GPS is counted, not dropped silently — "no location recorded
 * in this photo" is a fact the panel states.
 */
export function photoPointsFromImageryPayload(payload: unknown): {
  points: PhotoPoint[];
  withoutLocation: number;
} {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).imagery as unknown[] | undefined) ??
        ((payload as Record<string, unknown>).items as unknown[] | undefined) ??
        ((payload as Record<string, unknown>).photos as unknown[] | undefined) ??
        []
      : [];

  const points: PhotoPoint[] = [];
  let withoutLocation = 0;

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const lat = finite(row.gps_lat ?? row.gpsLat);
    const lon = finite(row.gps_lon ?? row.gpsLon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      withoutLocation += 1;
      continue;
    }
    points.push({
      id: typeof row.id === "string" ? row.id : `${points.length}`,
      lat,
      lon,
      filename:
        typeof row.original_filename === "string"
          ? row.original_filename
          : typeof row.originalFilename === "string"
            ? row.originalFilename
            : null,
    });
  }

  return { points, withoutLocation };
}

/**
 * The preview's bounds, re-validated with the same shared validator the
 * callback used, or null. Exported so a test can prove a hostile rectangle is
 * refused at the LAYER, not only at intake — the row travelled through a
 * database and a serializer to get here, and this component is the last thing
 * standing between it and a drawn exhibit.
 */
export function validatedPreviewBounds(
  preview: AerialMissionMapPreview | null,
): [number, number, number, number] | null {
  if (!preview) return null;
  const extraction = extractArtifactGeoref({ boundsWgs84: preview.bounds });
  if (!extraction.georef) return null;
  const { boundsWest, boundsSouth, boundsEast, boundsNorth } = extraction.georef;
  return [boundsWest, boundsSouth, boundsEast, boundsNorth];
}

export function AerialMissionMap({
  missionId,
  preview,
  previewNotice,
  previewNoticeDetail = null,
}: AerialMissionMapProps) {
  const [photoState, setPhotoState] = useState<PhotoState>({ status: "loading" });
  const [mapStartupFailed, setMapStartupFailed] = useState(false);
  const [showOrtho, setShowOrtho] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  const { layers: workspaceOrthoLayers, selected: workspaceOrthoSelected, setSelected: setWorkspaceOrthoSelected } =
    useAerialOrthoLayers();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleLoadedRef = useRef(false);

  const bounds = useMemo(() => validatedPreviewBounds(preview), [preview]);
  // A preview whose bounds fail re-validation is not a smaller preview — it is
  // one this map refuses to place, and it says so.
  const previewRejectedHere = preview !== null && bounds === null;
  const previewIsInWorkspaceCatalog = Boolean(
    preview?.custodyId && workspaceOrthoLayers.some((layer) => layer.custodyId === preview.custodyId),
  );

  // Photo dots, self-fetched from the imagery lane's GET route by URL string.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/aerial/missions/${missionId}/imagery`, {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (controller.signal.aborted) return;
          setPhotoState({ status: "failed" });
          return;
        }
        const payload = (await response.json()) as unknown;
        if (controller.signal.aborted) return;
        const { points, withoutLocation } = photoPointsFromImageryPayload(payload);
        setPhotoState({ status: "ready", points, withoutLocation });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setPhotoState({ status: "failed" });
      }
    })();
    return () => controller.abort();
  }, [missionId]);

  const photoPoints = useMemo(
    () => (photoState.status === "ready" ? photoState.points : []),
    [photoState],
  );
  const hasSomethingToDraw = bounds !== null || photoPoints.length > 0;

  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
  }, []);

  useEffect(() => {
    if (!MAPBOX_ACCESS_TOKEN) return;
    if (!hasSomethingToDraw) return;
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        attributionControl: false,
      });
    } catch {
      setMapStartupFailed(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      styleLoadedRef.current = true;

      if (bounds) {
        const [west, south, east, north] = bounds;
        map.addSource(ORTHO_SOURCE_ID, {
          type: "image",
          url: preview!.url,
          coordinates: [
            [west, north],
            [east, north],
            [east, south],
            [west, south],
          ],
        });
        map.addLayer({
          id: ORTHO_LAYER_ID,
          type: "raster",
          source: ORTHO_SOURCE_ID,
          paint: { "raster-opacity": 0.92, "raster-fade-duration": 0 },
        });
      }

      map.addSource(PHOTOS_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: photoPoints.map((point) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [point.lon, point.lat] },
            properties: { filename: point.filename ?? "" },
          })),
        } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: PHOTOS_LAYER_ID,
        type: "circle",
        source: PHOTOS_SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 6],
          "circle-color": PHOTO_DOT_COLOR,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": 0.9,
        },
      });

      // Frame the mission's own evidence: the ortho if placed, else its photos.
      // Never a place constant — everything framed here came from this mission.
      const fit = new mapboxgl.LngLatBounds();
      if (bounds) {
        fit.extend([bounds[0], bounds[1]]);
        fit.extend([bounds[2], bounds[3]]);
      } else {
        for (const point of photoPoints) fit.extend([point.lon, point.lat]);
      }
      if (!fit.isEmpty()) {
        map.fitBounds(fit, { padding: 48, maxZoom: 18, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // Rebuild only when whether-there-is-anything-to-draw flips; new photo data
    // rides in through the source-update effect below without a teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSomethingToDraw]);

  // Carry later-arriving photo points into the live map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const source = map.getSource(PHOTOS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: photoPoints.map((point) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        properties: { filename: point.filename ?? "" },
      })),
    } as GeoJSON.FeatureCollection);
  }, [photoPoints]);

  // Layer toggles — visibility only, never a data refetch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (map.getLayer(ORTHO_LAYER_ID)) {
      map.setLayoutProperty(ORTHO_LAYER_ID, "visibility", showOrtho ? "visible" : "none");
    }
  }, [showOrtho]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (map.getLayer(PHOTOS_LAYER_ID)) {
      map.setLayoutProperty(PHOTOS_LAYER_ID, "visibility", showPhotos ? "visible" : "none");
    }
  }, [showPhotos]);

  const notices: Array<{ text: string; operatorDetail?: string }> = [];
  if (previewNotice) notices.push({ text: previewNotice, operatorDetail: previewNoticeDetail ?? undefined });
  if (previewRejectedHere) {
    notices.push({
      text: "The held preview's reported georeference failed validation (its rectangle is not one a single flight could produce), so the map refuses to place it rather than draw it somewhere wrong. It remains available as a download.",
    });
  }
  if (photoState.status === "failed") {
    notices.push({
      text: "The mission's photo locations could not be read, so no photo dots are drawn. That is a read failure, not a finding that this mission has no photos.",
    });
  }
  if (photoState.status === "ready" && photoState.withoutLocation > 0) {
    notices.push({
      text: `${photoState.withoutLocation} uploaded ${photoState.withoutLocation === 1 ? "photo has" : "photos have"} no location recorded in the file, so ${photoState.withoutLocation === 1 ? "it is" : "they are"} not drawn. ${photoState.withoutLocation === 1 ? "It is" : "They are"} still held and listed in the imagery panel.`,
    });
  }

  return (
    <div className="space-y-3" data-testid="aerial-mission-map">
      {notices.length > 0 ? (
        <ul className="space-y-1.5 rounded-[0.5rem] border border-amber-400/45 bg-amber-400/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-100">
          {notices.map((note) => (
            <li key={note.text}>
              {note.text}
              {note.operatorDetail ? (
                <OperatorDetail>
                  <p className="break-words font-mono">{note.operatorDetail}</p>
                </OperatorDetail>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!MAPBOX_ACCESS_TOKEN ? (
        <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No map key is configured on this deployment</p>
          <p className="mt-1.5">
            {HAS_UNUSABLE_MAPBOX_TOKEN
              ? "A Mapbox token is set but is not a public key. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a token beginning with pk. — a secret sk. token is deliberately refused rather than sent to the browser."
              : "Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and this map will draw."}
          </p>
          {bounds ? (
            <p className="mt-1.5">
              This mission has a placed orthomosaic preview that would be drawn. Nothing about the
              imagery is missing — only the basemap.
            </p>
          ) : null}
        </div>
      ) : !hasSomethingToDraw ? (
        <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-foreground">Nothing to place on a map yet</p>
          <p className="mx-auto mt-1.5 max-w-prose text-sm text-muted-foreground">
            {photoState.status === "loading"
              ? "Checking this mission's photo locations…"
              : "When a processing run reports a georeferenced preview, or uploaded photos carry GPS in their EXIF, they appear here."}
          </p>
        </div>
      ) : mapStartupFailed ? (
        <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">The map could not start in this browser</p>
          <p className="mt-1.5">
            Mapbox needs WebGL. The mission&apos;s imagery is still available from the imagery panel
            and the processing jobs list.
          </p>
        </div>
      ) : (
        <div
          ref={attachContainer}
          data-testid="aerial-mission-map-canvas"
          className="h-[420px] w-full overflow-hidden rounded-[0.5rem] border border-border/70 bg-muted/10"
        />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {bounds ? (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showOrtho}
              onChange={(event) => setShowOrtho(event.target.checked)}
            />
            Orthomosaic preview
            {preview?.pixelSizeM ? (
              <span className="text-muted-foreground/80">
                (~{preview.pixelSizeM < 0.01 ? preview.pixelSizeM.toFixed(4) : preview.pixelSizeM.toFixed(2)}{" "}
                m/px{preview.crs ? `, source ${preview.crs}` : ""})
              </span>
            ) : preview?.crs ? (
              <span className="text-muted-foreground/80">(source {preview.crs})</span>
            ) : null}
          </label>
        ) : null}
        {preview?.custodyId && previewIsInWorkspaceCatalog ? (
          <label className="flex items-center gap-1.5 font-medium text-foreground">
            <input
              type="checkbox"
              checked={workspaceOrthoSelected[preview.custodyId] === true}
              onChange={(event) => setWorkspaceOrthoSelected(preview.custodyId!, event.target.checked)}
            />
            Show this preview on other planning maps
          </label>
        ) : null}
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPhotos}
            onChange={(event) => setShowPhotos(event.target.checked)}
          />
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full border border-white/70"
            style={{ backgroundColor: PHOTO_DOT_COLOR }}
          />
          Photo locations
          {photoState.status === "ready" ? ` (${photoPoints.length})` : ""}
        </label>
        <span className="flex items-center gap-1.5 text-muted-foreground/80">
          <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Measurement is not available on this map yet — for measuring, download the GeoTIFF
          orthomosaic from the processing jobs list and open it in GIS.
        </span>
      </div>
    </div>
  );
}
