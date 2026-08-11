/**
 * Aerial camera registry — sensor descriptors AS DATA, plus the pure
 * GSD ↔ altitude relation every flight plan derives its vertical profile from.
 *
 * WHY A REGISTRY. A flight plan stores `camera_key`, never a free-typed sensor
 * spec: a plan that carried its own sensor numbers could silently disagree with
 * the camera that actually flies, and nothing could ever correct it. The
 * database deliberately does NOT validate the key (the registry is code, the
 * table is data); the flight-plan route refuses unknown keys at write time and
 * names the keys it does know, so a planner is told plainly rather than saved
 * silently.
 *
 * NOTHING HERE IS A RECOMMENDATION OF A VENDOR. The named entries exist because
 * a planner with one of these common mapping cameras should not have to type
 * sensor geometry from a spec sheet; the generic entry is the default precisely
 * so no vendor is baked in anywhere else in the product. Adding a camera means
 * adding a descriptor here — no call site changes.
 *
 * EVERY NUMBER CARRIES ITS SOURCE (`specSource`), and the UI is expected to
 * show it: a descriptor is a published spec, not a calibration of the
 * planner's own aircraft, and the difference matters when imagery underpins
 * an exhibit.
 */

export type CameraDescriptor = {
  /** Stable registry key stored in aerial_flight_plans.camera_key. */
  key: string;
  /** Planner-facing label. */
  label: string;
  /** Physical sensor width, millimetres (the along-image-width dimension). */
  sensorWidthMm: number;
  /** Physical sensor height, millimetres. */
  sensorHeightMm: number;
  /** Image width, pixels, matching sensorWidthMm's axis. */
  imageWidthPx: number;
  /** Image height, pixels. */
  imageHeightPx: number;
  /** True focal length, millimetres (NOT 35mm-equivalent). */
  focalLengthMm: number;
  /** Where these numbers came from, so a mismatch with the real camera is checkable. */
  specSource: string;
};

/**
 * The clearly-labelled generic default. A 1-inch-class 20 MP mapping sensor is
 * the most common shape in small-drone survey work; a planner whose exact
 * camera is not listed gets honest, typical numbers and a label that says so.
 */
export const DEFAULT_CAMERA_KEY = "generic-1-inch-20mp";

const CAMERA_LIST: readonly CameraDescriptor[] = [
  {
    key: "generic-1-inch-20mp",
    label: "Generic 1-inch sensor (20 MP) — verify against your camera's spec sheet",
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
    focalLengthMm: 8.8,
    specSource:
      "Typical 1-inch-class 20 MP mapping sensor (13.2 x 8.8 mm, 5472 x 3648 px, 8.8 mm lens). Generic values — not any specific aircraft.",
  },
  {
    key: "dji-phantom-4-pro",
    label: "DJI Phantom 4 Pro / P4P RTK (1-inch, 20 MP)",
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
    focalLengthMm: 8.8,
    specSource: "DJI published specifications (1-inch CMOS, 5472 x 3648, 8.8 mm / 24 mm equiv).",
  },
  {
    key: "dji-mavic-3-enterprise-wide",
    label: "DJI Mavic 3 Enterprise — wide camera (4/3, 20 MP)",
    sensorWidthMm: 17.3,
    sensorHeightMm: 13.0,
    imageWidthPx: 5280,
    imageHeightPx: 3956,
    focalLengthMm: 12.29,
    specSource: "DJI published specifications (4/3 CMOS, 5280 x 3956, 12.29 mm / 24 mm equiv).",
  },
  {
    key: "sony-rx1r-ii-full-frame",
    label: "Sony RX1R II payload (full-frame, 42 MP, 35 mm) — e.g. fixed-wing mappers",
    sensorWidthMm: 35.9,
    sensorHeightMm: 24.0,
    imageWidthPx: 7952,
    imageHeightPx: 5304,
    focalLengthMm: 35.0,
    specSource: "Sony published specifications (35.9 x 24.0 mm, 7952 x 5304, fixed 35 mm lens).",
  },
];

const CAMERAS_BY_KEY: ReadonlyMap<string, CameraDescriptor> = new Map(
  CAMERA_LIST.map((camera) => [camera.key, camera])
);

export function listCameras(): readonly CameraDescriptor[] {
  return CAMERA_LIST;
}

export function getCamera(key: string): CameraDescriptor | null {
  return CAMERAS_BY_KEY.get(key) ?? null;
}

export function isKnownCameraKey(key: string): boolean {
  return CAMERAS_BY_KEY.has(key);
}

/**
 * Ground sample distance at a given flight altitude.
 *
 *   gsd_cm_per_px = (sensorWidthMm * altitudeAglM * 100) / (focalLengthMm * imageWidthPx)
 *
 * Verified against two independent derivations:
 *
 *   1. FOOTPRINT. By similar triangles through the lens, the ground footprint
 *      width is W_m = altitude_m * (sensorWidth_mm / focal_mm) — the mm cancel.
 *      One pixel covers W_m / imageWidth_px metres; * 100 converts to cm.
 *      => gsd = (sensorWidth * altitude / (focal * imageWidth)) * 100.
 *
 *   2. PIXEL PITCH. One pixel is sensorWidth_mm / imageWidth_px on the sensor.
 *      The optical magnification of ground onto sensor is focal / altitude, so
 *      a pixel sees (sensorWidth_mm / imageWidth_px) * (altitude / focal) of
 *      ground, in the same length unit as altitude; metres * 100 = cm. Same
 *      expression.
 *
 * External anchor: the widely used field rule for the 1-inch/8.8 mm class,
 * "GSD ≈ H / 36.5 cm at H metres", is this formula with the divisor rounded —
 * exact: focal * imageWidth / (sensorWidth * 100) = 8.8 * 5472 / 1320 = 36.48.
 */
export function gsdCmPerPxAtAltitude(camera: CameraDescriptor, altitudeAglM: number): number {
  if (!(altitudeAglM > 0)) throw new Error("altitudeAglM must be > 0");
  return (camera.sensorWidthMm * altitudeAglM * 100) / (camera.focalLengthMm * camera.imageWidthPx);
}

/** The exact inverse of gsdCmPerPxAtAltitude. */
export function altitudeAglForGsdCmPerPx(camera: CameraDescriptor, gsdCmPerPx: number): number {
  if (!(gsdCmPerPx > 0)) throw new Error("gsdCmPerPx must be > 0");
  return (gsdCmPerPx * camera.focalLengthMm * camera.imageWidthPx) / (camera.sensorWidthMm * 100);
}

export type VerticalProfile = {
  gsdCmPerPx: number;
  altitudeAglM: number;
  /**
   * Which number the planner authored:
   *   authored_gsd      — altitude derived from the target GSD.
   *   authored_altitude — GSD derived from the altitude.
   *   authored_both     — both authored; gsdCmPerPx is recomputed FROM the
   *                       authored altitude so the UI can disclose any
   *                       disagreement with the authored target instead of
   *                       hiding it.
   */
  basis: "authored_gsd" | "authored_altitude" | "authored_both";
};

export function resolveVerticalProfile(
  camera: CameraDescriptor,
  input: { targetGsdCmPerPx: number | null; altitudeAglM: number | null }
): VerticalProfile | null {
  const { targetGsdCmPerPx, altitudeAglM } = input;
  if (targetGsdCmPerPx !== null && altitudeAglM !== null) {
    return { gsdCmPerPx: gsdCmPerPxAtAltitude(camera, altitudeAglM), altitudeAglM, basis: "authored_both" };
  }
  if (targetGsdCmPerPx !== null) {
    return {
      gsdCmPerPx: targetGsdCmPerPx,
      altitudeAglM: altitudeAglForGsdCmPerPx(camera, targetGsdCmPerPx),
      basis: "authored_gsd",
    };
  }
  if (altitudeAglM !== null) {
    return { gsdCmPerPx: gsdCmPerPxAtAltitude(camera, altitudeAglM), altitudeAglM, basis: "authored_altitude" };
  }
  return null;
}

/**
 * The parameters whose change makes a generated grid snapshot STALE — exactly
 * the inputs a grid generator would consume. The mission's AOI is included on
 * purpose: redrawing the survey boundary invalidates the flight lines just as
 * surely as changing the overlap does. Operational fields (pilot name, notes,
 * RTH altitude) are deliberately absent — they change no geometry.
 */
export type FlightPlanHashInput = {
  aoiGeojson: unknown;
  cameraKey: string;
  targetGsdCmPerPx: number | null;
  altitudeAglM: number | null;
  frontOverlapPct: number;
  sideOverlapPct: number;
  speedMS: number | null;
  gimbalPitchDeg: number | null;
  crossGrid: boolean;
  boundaryMarginM: number | null;
  corridorWidthM: number | null;
};

/**
 * Deterministic fingerprint of the geometry-bearing plan parameters, stored in
 * aerial_flight_plans.generated_with beside a snapshot. A snapshot whose stored
 * fingerprint no longer matches the fingerprint of the CURRENT parameters was
 * generated from something else, and every reader can see that without
 * trusting anyone's bookkeeping.
 *
 * FNV-1a 64-bit over a canonical (recursively key-sorted) JSON serialisation.
 * This is a STALENESS fingerprint, not a security hash — collisions are
 * astronomically unlikely for this input space and nothing here is
 * adversarial; keeping it dependency-free and runnable in both Node and the
 * browser is worth more than cryptographic strength.
 */
export function hashFlightPlanParams(input: FlightPlanHashInput): string {
  const canonical = canonicalJson({
    aoiGeojson: input.aoiGeojson ?? null,
    cameraKey: input.cameraKey,
    targetGsdCmPerPx: input.targetGsdCmPerPx,
    altitudeAglM: input.altitudeAglM,
    frontOverlapPct: input.frontOverlapPct,
    sideOverlapPct: input.sideOverlapPct,
    speedMS: input.speedMS,
    gimbalPitchDeg: input.gimbalPitchDeg,
    crossGrid: input.crossGrid,
    boundaryMarginM: input.boundaryMarginM,
    corridorWidthM: input.corridorWidthM,
  });
  return `fnv1a64:${fnv1a64Hex(canonical)}`;
}

/** JSON with every object's keys sorted, so serialisation order cannot change the hash. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

function fnv1a64Hex(text: string): string {
  // BigInt() constructor calls rather than 0x…n literals: the repo's TS target
  // predates ES2020 literal syntax, though the BigInt runtime is present.
  const FNV_OFFSET = BigInt("0xcbf29ce484222325");
  const FNV_PRIME = BigInt("0x100000001b3");
  const MASK = BigInt("0xffffffffffffffff");
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}
