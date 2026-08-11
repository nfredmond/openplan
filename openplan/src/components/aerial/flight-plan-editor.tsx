"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import {
  altitudeAglForGsdCmPerPx,
  DEFAULT_CAMERA_KEY,
  getCamera,
  gsdCmPerPxAtAltitude,
  hashFlightPlanParams,
  listCameras,
  type FlightPlanHashInput,
} from "@/lib/aerial/camera-registry";
import {
  DEFAULT_TURN_ALLOWANCE_SECONDS,
  generateSurveyGrid,
  type SurveyGridSuccess,
} from "@/lib/aerial/survey-grid";
import {
  buildFlightPlanSnapshot,
  LITCHI_WAYPOINT_LIMIT,
  parseFlightPlanSnapshot,
  type ParsedFlightSnapshot,
} from "@/lib/aerial/flight-exports";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

/**
 * Flight-plan editor for a mission that already has an AOI. The planner picks
 * a camera from the registry, states ONE half of the vertical profile (target
 * ground resolution OR altitude — the other is derived live and labeled as
 * derived), sets overlaps/speed/margin/battery, generates the survey grid
 * client-side (src/lib/aerial/survey-grid.ts is pure), reviews the lines and
 * every assumption on the map and stats panel, and saves. Exports unlock only
 * while the SAVED snapshot matches the CURRENT settings — the same
 * fingerprint the route enforces (hashFlightPlanParams), computed with the
 * same function, so the editor never promises a download the route will
 * refuse.
 *
 * UI starting values are stated defaults, not hidden constants: 75/65 overlap
 * (the common photogrammetric starting point) and nadir gimbal are visible in
 * their fields and editable; speed, battery minutes and the vertical profile
 * have NO default — they belong to the planner's aircraft and intent.
 */

type AoiPolygon = { type: "Polygon"; coordinates: [number, number][][] };

function isAoiPolygon(value: unknown): value is AoiPolygon {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  return (
    candidate.type === "Polygon" &&
    Array.isArray(candidate.coordinates) &&
    Array.isArray(candidate.coordinates[0]) &&
    candidate.coordinates[0].length >= 4
  );
}

type FlightPlanRow = {
  camera_key: string;
  target_gsd_cm_per_px: number | string | null;
  altitude_agl_m: number | string | null;
  front_overlap_pct: number | string;
  side_overlap_pct: number | string;
  speed_m_s: number | string | null;
  gimbal_pitch_deg: number | string | null;
  cross_grid: boolean;
  boundary_margin_m: number | string | null;
  corridor_width_m: number | string | null;
  crew_pilot_name: string | null;
  rth_altitude_m: number | string | null;
  notes: string | null;
  generated_plan: unknown;
  generated_with: string | null;
};

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositive(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseNonNegative(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatKm(meters: number): string {
  return (meters / 1000).toFixed(2);
}

function formatMinutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

export function FlightPlanEditor({
  missionId,
  aoiGeojson,
  canEdit,
}: {
  missionId: string;
  /** The mission row's aoi_geojson, exactly as stored — it is part of the
   *  staleness fingerprint, so it must be byte-for-byte what the route hashes. */
  aoiGeojson: unknown;
  /** False for read-only workspace roles: the plan and exports render, the
   *  form and save do not. */
  canEdit: boolean;
}) {
  const idPrefix = useId();
  const hasAoi = isAoiPolygon(aoiGeojson);

  // ---- form state ---------------------------------------------------------
  const [cameraKey, setCameraKey] = useState<string>(DEFAULT_CAMERA_KEY);
  const [verticalMode, setVerticalMode] = useState<"gsd" | "altitude">("gsd");
  const [gsdText, setGsdText] = useState("");
  const [altitudeText, setAltitudeText] = useState("");
  // 75/65: the common photogrammetric starting point — a stated, editable
  // default, disclosed next to the fields, not a hidden constant.
  const [frontText, setFrontText] = useState("75");
  const [sideText, setSideText] = useState("65");
  const [speedText, setSpeedText] = useState("");
  const [marginText, setMarginText] = useState("0");
  const [batteryText, setBatteryText] = useState("");
  // −90° = straight down (nadir), the standard mapping geometry; editable.
  const [gimbalText, setGimbalText] = useState("-90");
  const [crossGrid, setCrossGrid] = useState(false);
  const [pilotText, setPilotText] = useState("");
  const [rthText, setRthText] = useState("");
  const [notesText, setNotesText] = useState("");

  // ---- plan/load state ----------------------------------------------------
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedGeneratedWith, setSavedGeneratedWith] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<ParsedFlightSnapshot | null>(null);

  // ---- generation state ---------------------------------------------------
  const [grid, setGrid] = useState<SurveyGridSuccess | null>(null);
  const [gridParamsHash, setGridParamsHash] = useState<string | null>(null);
  const [gridBattery, setGridBattery] = useState<number | null>(null);
  const [gridSpeed, setGridSpeed] = useState<number | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // ---- save state ---------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const cameras = listCameras();
  const camera = getCamera(cameraKey);

  // ---- derived vertical profile, live ------------------------------------
  const gsdValue = parsePositive(gsdText);
  const altitudeValue = parsePositive(altitudeText);
  const derivedAltitude =
    camera && verticalMode === "gsd" && gsdValue !== null
      ? altitudeAglForGsdCmPerPx(camera, gsdValue)
      : null;
  const derivedGsd =
    camera && verticalMode === "altitude" && altitudeValue !== null
      ? gsdCmPerPxAtAltitude(camera, altitudeValue)
      : null;

  const frontValue = parsePositive(frontText);
  const sideValue = parsePositive(sideText);
  const speedValue = parsePositive(speedText);
  const marginValue = parseNonNegative(marginText);
  const batteryValue = parsePositive(batteryText);
  const gimbalValue = gimbalText.trim() === "" ? null : Number(gimbalText);
  const gimbalUsable =
    gimbalValue === null || (Number.isFinite(gimbalValue) && gimbalValue >= -90 && gimbalValue <= 0);

  /**
   * The fingerprint of the CURRENT settings — same function, same input shape
   * the flight-plan route computes server-side, aoiGeojson included. Null
   * while the form does not parse into a hashable parameter set.
   */
  const currentHash = useMemo<string | null>(() => {
    if (!camera || frontValue === null || sideValue === null || !gimbalUsable) return null;
    const authoredGsd = verticalMode === "gsd" ? gsdValue : null;
    const authoredAltitude = verticalMode === "altitude" ? altitudeValue : null;
    if (authoredGsd === null && authoredAltitude === null) return null;
    const input: FlightPlanHashInput = {
      aoiGeojson: aoiGeojson ?? null,
      cameraKey: camera.key,
      targetGsdCmPerPx: authoredGsd,
      altitudeAglM: authoredAltitude,
      frontOverlapPct: frontValue,
      sideOverlapPct: sideValue,
      speedMS: speedValue,
      gimbalPitchDeg: gimbalValue,
      crossGrid,
      boundaryMarginM: marginValue,
      corridorWidthM: null,
    };
    return hashFlightPlanParams(input);
  }, [
    camera,
    verticalMode,
    gsdValue,
    altitudeValue,
    frontValue,
    sideValue,
    speedValue,
    gimbalValue,
    gimbalUsable,
    crossGrid,
    marginValue,
    aoiGeojson,
  ]);

  const savedPlanStale =
    savedGeneratedWith !== null && (currentHash === null || currentHash !== savedGeneratedWith);
  const previewStale = grid !== null && (currentHash === null || currentHash !== gridParamsHash);
  const exportsReady = savedSnapshot !== null && savedGeneratedWith !== null && !savedPlanStale;

  // ---- load the saved plan on mount --------------------------------------
  useEffect(() => {
    if (!hasAoi) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/aerial/missions/${missionId}/flight-plan`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error ?? `Load failed (${response.status})`);
        }
        const body = (await response.json()) as { flightPlan: FlightPlanRow | null };
        if (cancelled) return;
        const row = body.flightPlan;
        if (row) {
          setCameraKey(row.camera_key);
          const storedGsd = asNumber(row.target_gsd_cm_per_px);
          const storedAltitude = asNumber(row.altitude_agl_m);
          if (storedGsd !== null) {
            setVerticalMode("gsd");
            setGsdText(String(storedGsd));
            if (storedAltitude !== null) setAltitudeText(String(storedAltitude));
          } else if (storedAltitude !== null) {
            setVerticalMode("altitude");
            setAltitudeText(String(storedAltitude));
          }
          const front = asNumber(row.front_overlap_pct);
          const side = asNumber(row.side_overlap_pct);
          if (front !== null) setFrontText(String(front));
          if (side !== null) setSideText(String(side));
          const speed = asNumber(row.speed_m_s);
          if (speed !== null) setSpeedText(String(speed));
          const gimbal = asNumber(row.gimbal_pitch_deg);
          setGimbalText(gimbal !== null ? String(gimbal) : "");
          setCrossGrid(row.cross_grid);
          const margin = asNumber(row.boundary_margin_m);
          setMarginText(margin !== null ? String(margin) : "0");
          setPilotText(row.crew_pilot_name ?? "");
          const rth = asNumber(row.rth_altitude_m);
          setRthText(rth !== null ? String(rth) : "");
          setNotesText(row.notes ?? "");
          setSavedGeneratedWith(row.generated_with);
          if (row.generated_plan !== null) {
            const parsed = parseFlightPlanSnapshot(row.generated_plan);
            if (parsed.ok) {
              setSavedSnapshot(parsed.snapshot);
              setBatteryText(String(parsed.snapshot.input.flightMinutesPerBattery));
            }
          }
        }
        setLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setLoadState("failed");
        setLoadError(error instanceof Error ? error.message : "Unknown error while loading the saved flight plan.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId, hasAoi]);

  // ---- map ---------------------------------------------------------------
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapReadyRef = useRef(false);

  const aoiRing = hasAoi ? (aoiGeojson as AoiPolygon).coordinates[0] : null;

  /** What the map and the stats panel describe: the freshly generated grid
   *  wins; otherwise the saved snapshot (labeled as saved). */
  const displayLines = grid?.lines ?? savedSnapshot?.lines ?? null;
  const displaySource: "generated" | "saved" | null = grid ? "generated" : savedSnapshot ? "saved" : null;

  useEffect(() => {
    if (!hasAoi || !mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
    const ring = (aoiGeojson as AoiPolygon).coordinates[0];
    const bounds = ringBounds(ring);
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      // The AOI is required to exist here, so the camera always opens on it —
      // never on a guessed place.
      bounds: bounds ?? undefined,
      fitBoundsOptions: { padding: 48 },
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      // Same visual family as mission-aoi-editor: sky-blue AOI; the flight
      // grid gets amber lines and small amber trigger points over it.
      map.addSource("flight-plan-aoi", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: (aoiGeojson as AoiPolygon).coordinates },
          properties: {},
        },
      });
      map.addLayer({
        id: "flight-plan-aoi-fill",
        type: "fill",
        source: "flight-plan-aoi",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "flight-plan-aoi-outline",
        type: "line",
        source: "flight-plan-aoi",
        paint: { "line-color": "#38bdf8", "line-width": 2 },
      });
      map.addSource("flight-plan-grid", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "flight-plan-grid-lines",
        type: "line",
        source: "flight-plan-grid",
        paint: { "line-color": "#f59e0b", "line-width": 1.5 },
        filter: ["==", ["geometry-type"], "LineString"],
      });
      map.addLayer({
        id: "flight-plan-grid-photos",
        type: "circle",
        source: "flight-plan-grid",
        paint: {
          "circle-radius": 2.5,
          "circle-color": "#f59e0b",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1,
        },
        filter: ["==", ["geometry-type"], "Point"],
      });
      mapReadyRef.current = true;
      const source = map.getSource("flight-plan-grid") as mapboxgl.GeoJSONSource | undefined;
      if (source && displayLinesRef.current) {
        source.setData(gridFeatureCollection(displayLinesRef.current));
      }
    });
    mapRef.current = map;
    return () => {
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // The AOI is immutable on this page (edited elsewhere); mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAoi]);

  // The load handler above may run before the first grid exists; keep the
  // latest lines in a ref so either side (map ready / lines changed) can draw.
  const displayLinesRef = useRef(displayLines);
  useEffect(() => {
    displayLinesRef.current = displayLines;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const source = map.getSource("flight-plan-grid") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(gridFeatureCollection(displayLines ?? []));
  }, [displayLines]);

  // ---- actions ------------------------------------------------------------
  const generate = () => {
    setGenerateError(null);
    setSavedMessage(null);
    if (!camera) {
      setGenerateError("Choose a camera from the list.");
      return;
    }
    if (verticalMode === "gsd" && gsdValue === null) {
      setGenerateError("Enter the target ground resolution in cm per pixel (a positive number).");
      return;
    }
    if (verticalMode === "altitude" && altitudeValue === null) {
      setGenerateError("Enter the flight altitude in meters above ground (a positive number).");
      return;
    }
    if (frontValue === null || sideValue === null) {
      setGenerateError("Enter both overlaps as percentages.");
      return;
    }
    if (speedValue === null) {
      setGenerateError("Enter the ground speed in m/s — this is your aircraft's survey speed, so there is no default.");
      return;
    }
    if (marginValue === null) {
      setGenerateError("Enter the boundary margin in meters (0 is allowed).");
      return;
    }
    if (batteryValue === null) {
      setGenerateError(
        "Enter the usable flight minutes per battery — the realistic figure for your aircraft, not the brochure maximum."
      );
      return;
    }
    if (!gimbalUsable) {
      setGenerateError("Gimbal pitch must be between -90 (straight down) and 0 (horizon), or blank.");
      return;
    }
    if (!aoiRing) return;

    const result = generateSurveyGrid({
      aoiRing: aoiRing.map(([lon, lat]) => [lon, lat] as [number, number]),
      camera: {
        key: camera.key,
        label: camera.label,
        sensorWidthMm: camera.sensorWidthMm,
        sensorHeightMm: camera.sensorHeightMm,
        imageWidthPx: camera.imageWidthPx,
        imageHeightPx: camera.imageHeightPx,
        focalLengthMm: camera.focalLengthMm,
      },
      ...(verticalMode === "gsd" ? { targetGsdCm: gsdValue! } : { altitudeM: altitudeValue! }),
      frontOverlapPct: frontValue,
      sideOverlapPct: sideValue,
      speedMps: speedValue,
      crossGrid,
      boundaryMarginM: marginValue,
      flightMinutesPerBattery: batteryValue,
    });

    if (!result.ok) {
      setGrid(null);
      setGridParamsHash(null);
      setGenerateError(result.message);
      return;
    }
    setGrid(result);
    setGridParamsHash(currentHash);
    setGridBattery(batteryValue);
    setGridSpeed(speedValue);
  };

  const save = async () => {
    setSaveError(null);
    setSavedMessage(null);
    if (!camera) {
      setSaveError("Choose a camera from the list.");
      return;
    }
    const authoredGsd = verticalMode === "gsd" ? gsdValue : null;
    const authoredAltitude = verticalMode === "altitude" ? altitudeValue : null;
    if (authoredGsd === null && authoredAltitude === null) {
      setSaveError("State the vertical profile before saving: target ground resolution or altitude.");
      return;
    }
    if (frontValue === null || sideValue === null) {
      setSaveError("Enter both overlaps as percentages before saving.");
      return;
    }
    const rthValue = parsePositive(rthText);

    // The snapshot rides along only when it was generated from EXACTLY the
    // settings being saved; otherwise the stored snapshot (if any) stays and
    // the stale flag says so honestly.
    const includeSnapshot =
      grid !== null && gridParamsHash !== null && currentHash !== null && gridParamsHash === currentHash;

    const body: Record<string, unknown> = {
      cameraKey: camera.key,
      ...(authoredGsd !== null ? { targetGsdCmPerPx: authoredGsd } : {}),
      ...(authoredAltitude !== null ? { altitudeAglM: authoredAltitude } : {}),
      frontOverlapPct: frontValue,
      sideOverlapPct: sideValue,
      ...(speedValue !== null ? { speedMS: speedValue } : {}),
      ...(gimbalValue !== null && gimbalUsable ? { gimbalPitchDeg: gimbalValue } : {}),
      crossGrid,
      ...(marginValue !== null ? { boundaryMarginM: marginValue } : {}),
      ...(pilotText.trim() !== "" ? { crewPilotName: pilotText.trim() } : {}),
      ...(rthValue !== null ? { rthAltitudeM: rthValue } : {}),
      ...(notesText.trim() !== "" ? { notes: notesText.trim() } : {}),
      ...(includeSnapshot
        ? {
            generatedPlan: buildFlightPlanSnapshot(grid!, {
              speedMps: gridSpeed!,
              flightMinutesPerBattery: gridBattery!,
              turnAllowanceSeconds: DEFAULT_TURN_ALLOWANCE_SECONDS,
            }),
          }
        : {}),
    };

    setSaving(true);
    try {
      const response = await fetch(`/api/aerial/missions/${missionId}/flight-plan`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseBody?.error ?? `Save failed (${response.status})`);
      }
      const row = responseBody.flightPlan as FlightPlanRow | null;
      setSavedGeneratedWith(row?.generated_with ?? null);
      if (row && row.generated_plan !== null) {
        const parsed = parseFlightPlanSnapshot(row.generated_plan);
        setSavedSnapshot(parsed.ok ? parsed.snapshot : null);
      } else {
        setSavedSnapshot(null);
      }
      setSavedMessage(
        includeSnapshot
          ? "Flight plan and generated grid saved."
          : "Flight plan settings saved. No freshly generated grid accompanied them — generate to update the saved snapshot."
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unknown error while saving the flight plan.");
    } finally {
      setSaving(false);
    }
  };

  // ---- render -------------------------------------------------------------
  if (!hasAoi) {
    return (
      <StateBlock
        tone="info"
        title="This mission needs an area of interest first"
        description="A flight plan is a grid that fills a boundary, and this mission does not have one yet. Draw the AOI (the Edit AOI button above), then come back here to plan the flight."
      />
    );
  }

  const stats = grid
    ? {
        source: "generated" as const,
        altitudeM: grid.altitudeM,
        gsdCm: grid.gsdCm,
        lineCount: grid.lineCount,
        photoCount: grid.photoCount,
        distanceM: grid.totalFlightDistanceM,
        durationS: grid.estimatedDurationSeconds,
        batteryLegs: grid.estimatedBatteryLegs,
        actualLineSpacingM: grid.actualLineSpacingM,
        assumptions: grid.assumptions,
      }
    : savedSnapshot
      ? {
          source: "saved" as const,
          altitudeM: savedSnapshot.altitudeM,
          gsdCm: savedSnapshot.gsdCm,
          lineCount: savedSnapshot.lineCount,
          photoCount: savedSnapshot.photoCount,
          distanceM: savedSnapshot.totalFlightDistanceM,
          durationS: savedSnapshot.estimatedDurationSeconds,
          batteryLegs: savedSnapshot.estimatedBatteryLegs,
          actualLineSpacingM: null,
          assumptions: savedSnapshot.assumptions,
        }
      : null;

  const fieldClass = "flex flex-col gap-1 text-xs text-muted-foreground";

  return (
    <div className="space-y-4">
      {loadState === "failed" ? (
        <StateBlock
          tone="danger"
          title="The saved flight plan could not be read"
          description={`${loadError ?? "Unknown error."} The form below starts blank, NOT from your saved plan — saving now would overwrite whatever is stored. Reload the page before editing.`}
        />
      ) : null}

      {canEdit ? (
        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={fieldClass} htmlFor={`${idPrefix}-camera`}>
              Camera
              <select
                id={`${idPrefix}-camera`}
                className="module-select"
                value={cameraKey}
                onChange={(event) => setCameraKey(event.target.value)}
              >
                {cameras.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-vertical-mode`}>
              Plan the height by
              <select
                id={`${idPrefix}-vertical-mode`}
                className="module-select"
                value={verticalMode}
                onChange={(event) => setVerticalMode(event.target.value as "gsd" | "altitude")}
              >
                <option value="gsd">Target ground resolution (cm/px)</option>
                <option value="altitude">Flight altitude (m above ground)</option>
              </select>
            </label>

            {verticalMode === "gsd" ? (
              <label className={fieldClass} htmlFor={`${idPrefix}-gsd`}>
                Target ground resolution (cm/px)
                <Input
                  id={`${idPrefix}-gsd`}
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={gsdText}
                  onChange={(event) => setGsdText(event.target.value)}
                />
                <span data-testid="derived-altitude">
                  {derivedAltitude !== null
                    ? `Derived altitude: ${derivedAltitude.toFixed(2)} m above ground, from this camera's sensor and lens.`
                    : "Derived altitude appears here once a resolution is entered."}
                </span>
              </label>
            ) : (
              <label className={fieldClass} htmlFor={`${idPrefix}-altitude`}>
                Flight altitude (m above ground)
                <Input
                  id={`${idPrefix}-altitude`}
                  type="number"
                  min={1}
                  step={1}
                  value={altitudeText}
                  onChange={(event) => setAltitudeText(event.target.value)}
                />
                <span data-testid="derived-gsd">
                  {derivedGsd !== null
                    ? `Derived ground resolution: ${derivedGsd.toFixed(2)} cm/px, from this camera's sensor and lens.`
                    : "Derived ground resolution appears here once an altitude is entered."}
                </span>
              </label>
            )}

            <label className={fieldClass} htmlFor={`${idPrefix}-front`}>
              Front overlap (%)
              <Input
                id={`${idPrefix}-front`}
                type="number"
                min={40}
                max={95}
                value={frontText}
                onChange={(event) => setFrontText(event.target.value)}
              />
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-side`}>
              Side overlap (%)
              <Input
                id={`${idPrefix}-side`}
                type="number"
                min={40}
                max={95}
                value={sideText}
                onChange={(event) => setSideText(event.target.value)}
              />
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-speed`}>
              Ground speed (m/s)
              <Input
                id={`${idPrefix}-speed`}
                type="number"
                min={0.1}
                step={0.1}
                value={speedText}
                onChange={(event) => setSpeedText(event.target.value)}
              />
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-margin`}>
              Boundary margin (m)
              <Input
                id={`${idPrefix}-margin`}
                type="number"
                min={0}
                value={marginText}
                onChange={(event) => setMarginText(event.target.value)}
              />
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-battery`}>
              Usable flight minutes per battery
              <Input
                id={`${idPrefix}-battery`}
                type="number"
                min={1}
                value={batteryText}
                onChange={(event) => setBatteryText(event.target.value)}
              />
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-gimbal`}>
              Gimbal pitch (°, −90 = straight down)
              <Input
                id={`${idPrefix}-gimbal`}
                type="number"
                min={-90}
                max={0}
                value={gimbalText}
                onChange={(event) => setGimbalText(event.target.value)}
              />
            </label>

            <label className={`${fieldClass} justify-end`} htmlFor={`${idPrefix}-cross`}>
              <span className="flex items-center gap-2">
                <input
                  id={`${idPrefix}-cross`}
                  type="checkbox"
                  checked={crossGrid}
                  onChange={(event) => setCrossGrid(event.target.checked)}
                />
                Cross grid (fly it twice, at 90°)
              </span>
              <span>Better 3D reconstruction, roughly twice the flight time.</span>
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-pilot`}>
              Pilot (optional)
              <Input
                id={`${idPrefix}-pilot`}
                value={pilotText}
                onChange={(event) => setPilotText(event.target.value)}
              />
            </label>

            <label className={fieldClass} htmlFor={`${idPrefix}-rth`}>
              Return-to-home altitude (m, optional)
              <Input
                id={`${idPrefix}-rth`}
                type="number"
                min={1}
                value={rthText}
                onChange={(event) => setRthText(event.target.value)}
              />
            </label>

            <label className={`${fieldClass} sm:col-span-2 lg:col-span-3`} htmlFor={`${idPrefix}-notes`}>
              Notes (optional)
              <Input
                id={`${idPrefix}-notes`}
                value={notesText}
                onChange={(event) => setNotesText(event.target.value)}
              />
            </label>
          </div>

          <p className="text-[0.72rem] text-muted-foreground">
            Overlaps start at 75% front / 65% side — the common photogrammetric starting point; adjust
            for your terrain and processing software. Speed and battery minutes belong to your
            aircraft, so they have no default.
            {camera ? ` Camera numbers: ${camera.specSource}` : ""}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={generate} disabled={saving || loadState === "loading"}>
              Generate flight lines
            </Button>
            <Button type="button" variant="outline" onClick={save} disabled={saving || loadState === "loading"}>
              {saving ? "Saving…" : "Save flight plan"}
            </Button>
          </div>
        </div>
      ) : (
        <StateBlock
          tone="info"
          title="Read-only access"
          description="Your workspace role can view and export this mission's saved flight plan, but not change it."
          compact
        />
      )}

      {generateError ? (
        <StateBlock title="No grid was generated" description={generateError} tone="warning" compact />
      ) : null}
      {saveError ? <StateBlock title="Save failed" description={saveError} tone="danger" compact /> : null}
      {savedMessage ? <StateBlock title="Saved" description={savedMessage} tone="info" compact /> : null}

      {savedPlanStale ? (
        <StateBlock
          tone="warning"
          title="The saved plan predates these settings — regenerate"
          description="The settings above no longer match the ones the saved flight lines were generated from (the mission AOI counts too). Generate again and save, or exports will stay locked — a crew must never fly lines nobody reviewed under the current settings."
          compact
        />
      ) : null}

      {MAPBOX_ACCESS_TOKEN ? (
        <div className="relative overflow-hidden rounded-xl border border-border">
          <div
            ref={mapContainerRef}
            aria-label="Flight plan preview map"
            className="h-[380px] w-full bg-muted/10"
          />
          {displaySource ? (
            <div className="absolute bottom-3 left-3 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
              {displaySource === "generated"
                ? previewStale
                  ? "Showing the last generated grid — it predates the current settings. Generate again."
                  : "Showing the grid generated from the current settings."
                : "Showing the SAVED flight plan's lines."}
            </div>
          ) : null}
        </div>
      ) : (
        <StateBlock
          title="Map preview unavailable"
          description="NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is not set, so the flight lines cannot be drawn here. Generation, statistics, saving and exports still work."
          tone="warning"
          compact
        />
      )}

      {stats ? (
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-4 text-sm">
          <p className="font-medium text-foreground">
            {stats.source === "generated" ? "Generated grid" : "Saved plan"} — {stats.photoCount} photos
            across {stats.lineCount} lines
          </p>
          <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex justify-between gap-2">
              <dt>Ground resolution</dt>
              <dd>{stats.gsdCm.toFixed(2)} cm/px</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Altitude above ground</dt>
              <dd>{stats.altitudeM.toFixed(1)} m</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Flight distance</dt>
              <dd>{formatKm(stats.distanceM)} km</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Estimated duration</dt>
              <dd>{formatMinutes(stats.durationS)} min</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Battery legs</dt>
              <dd>{stats.batteryLegs}</dd>
            </div>
            {stats.actualLineSpacingM !== null ? (
              <div className="flex justify-between gap-2">
                <dt>Line spacing used</dt>
                <dd>{stats.actualLineSpacingM.toFixed(1)} m</dd>
              </div>
            ) : null}
          </dl>
          <div className="rounded-md border border-[color:var(--line)] bg-background/60 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Every assumption these numbers rest on</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {stats.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Export for the flight crew</p>
        {exportsReady ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <a href={`/api/aerial/missions/${missionId}/flight-plan/export?format=wpml`}>
                  DJI Pilot 2 (.kmz, WPML)
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`/api/aerial/missions/${missionId}/flight-plan/export?format=litchi`}>
                  Litchi (.csv)
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`/api/aerial/missions/${missionId}/flight-plan/export?format=kml`}>
                  Any GIS (.kml)
                </a>
              </Button>
            </div>
            {savedSnapshot && savedSnapshot.photoCount > LITCHI_WAYPOINT_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                Litchi caps a mission at {LITCHI_WAYPOINT_LIMIT} waypoints; this plan has{" "}
                {savedSnapshot.photoCount} photo points, so the CSV will need splitting in Litchi
                before it can fly.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {savedSnapshot === null
              ? "Exports unlock once a generated flight plan is saved. Generate the lines, review them, then save."
              : "Exports are locked while the saved plan predates the current settings — regenerate and save first."}
          </p>
        )}
      </div>
    </div>
  );
}

function ringBounds(ring: [number, number][]): [[number, number], [number, number]] | null {
  if (ring.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function gridFeatureCollection(
  lines: readonly {
    index: number;
    start: [number, number];
    end: [number, number];
    photoPoints: [number, number][];
  }[]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const line of lines) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [line.start, line.end] },
      properties: { index: line.index },
    });
    for (const point of line.photoPoints) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: point },
        properties: {},
      });
    }
  }
  return { type: "FeatureCollection", features };
}
