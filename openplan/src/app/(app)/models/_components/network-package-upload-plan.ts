/**
 * TURNING GEOJSON FILES A PLANNER HAS INTO THE REQUESTS THE NETWORK-PACKAGE API
 * ACCEPTS — with every refusal decided BEFORE anything is written.
 *
 * Six network-package routes shipped with no caller in the product. The panel
 * beside this file told a planner, in as many words, to drive them with curl.
 * This module is the half of the upload form that has no React in it: parse the
 * files, validate every row against the vocabularies the database will enforce,
 * and hand back either a complete plan or a list of problems in words a planner
 * can act on.
 *
 * WHY VALIDATION HAPPENS ALL AT ONCE, UP FRONT. The upload is four to six HTTP
 * calls that each write something (`network_packages` -> `..._versions` ->
 * `ingest` -> zones -> corridors -> connectors). A `zone_type` the CHECK
 * constraint rejects, discovered on the 800th zone, leaves a half-populated
 * version behind and a planner with no way to tell what landed. So nothing is
 * sent until every feature in every file has been checked, and a rejected value
 * is REPORTED rather than quietly rewritten to the default — an upload that
 * silently changes what the planner's file said is worse than one that refuses.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not touch the nodes/links
 * GeoJSON beyond parsing it: the ingest route runs its own QA checks, and a
 * second implementation of those checks here would be a second answer that can
 * disagree with the one recorded on the version. It also never invents a
 * centroid. A polygon's vertex average is not its centroid, and a fabricated
 * coordinate on a zone is the kind of number that ends up in a model run.
 */

/**
 * The database's own vocabularies, restated here because a `<select>` cannot
 * read a CHECK constraint. `network-package-upload-form.test.tsx` parses
 * `20260318000028_network_zones_corridors_connectors.sql` and fails if these
 * lists and the constraints ever disagree, so the duplication cannot drift
 * without the build saying so.
 */
export const ZONE_TYPES = ["taz", "census_tract", "custom"] as const;
export const CORRIDOR_TYPES = ["highway", "arterial", "transit", "bike", "custom"] as const;
export const CORRIDOR_DIRECTIONS = [
  "both",
  "northbound",
  "southbound",
  "eastbound",
  "westbound",
  "inbound",
  "outbound",
] as const;
export const CONNECTOR_TYPES = ["auto", "transit", "walk", "bike"] as const;

export type ZoneType = (typeof ZONE_TYPES)[number];
export type CorridorType = (typeof CORRIDOR_TYPES)[number];
export type CorridorDirection = (typeof CORRIDOR_DIRECTIONS)[number];
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export type GeoJsonFeature = {
  geometry: unknown;
  properties: Record<string, unknown>;
};

export type FeatureParse =
  | { ok: true; features: GeoJsonFeature[] }
  | { ok: false; reason: string };

/**
 * Accepts a FeatureCollection or a single Feature. A bare geometry is refused
 * on purpose: a zone or corridor without properties has no id and no name, so
 * accepting one would create a row nothing can be joined back to.
 */
export function parseFeatureFile(fileLabel: string, text: string): FeatureParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${fileLabel} is not valid JSON.` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: `${fileLabel} does not contain a GeoJSON object.` };
  }

  const root = parsed as Record<string, unknown>;

  const collect = (raw: unknown[]): GeoJsonFeature[] =>
    raw.map((entry) => {
      const feature = (entry ?? {}) as Record<string, unknown>;
      const properties = feature.properties;
      return {
        geometry: feature.geometry ?? null,
        properties:
          properties && typeof properties === "object" ? (properties as Record<string, unknown>) : {},
      };
    });

  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) {
      return { ok: false, reason: `${fileLabel} is a FeatureCollection with no features array.` };
    }
    if (root.features.length === 0) {
      return { ok: false, reason: `${fileLabel} contains zero features.` };
    }
    return { ok: true, features: collect(root.features) };
  }

  if (root.type === "Feature") {
    return { ok: true, features: collect([root]) };
  }

  return {
    ok: false,
    reason: `${fileLabel} must be a GeoJSON Feature or FeatureCollection (its type is ${
      typeof root.type === "string" ? `"${root.type}"` : "not stated"
    }).`,
  };
}

/** The first property name present, so a planner's own column naming survives. */
function firstString(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(properties: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function enumValue<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T
): { ok: true; value: T } | { ok: false; rejected: string } {
  if (raw === null) return { ok: true, value: fallback };
  if ((allowed as readonly string[]).includes(raw)) return { ok: true, value: raw as T };
  return { ok: false, rejected: raw };
}

export type ZoneInsert = {
  zone_id_external: string | null;
  zone_type: ZoneType;
  name: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  geometry_geojson: unknown;
  properties: Record<string, unknown>;
};

export type CorridorInsert = {
  corridor_name: string;
  corridor_type: CorridorType;
  direction: CorridorDirection;
  geometry_geojson: unknown;
  properties: Record<string, unknown>;
};

/**
 * `network_connectors.zone_id` is a NOT NULL foreign key to `network_zones.id`
 * — a uuid the database assigns. A planner's file can only name the zone the
 * way their own data names it, so the external id is carried here and resolved
 * against the zones this same upload created.
 */
export type ConnectorInsert = {
  zoneExternalId: string;
  target_node_id: string | null;
  connector_type: ConnectorType;
  impedance_minutes: number;
  geometry_geojson: unknown;
};

export type UploadPlan = {
  zones: ZoneInsert[];
  corridors: CorridorInsert[];
  connectors: ConnectorInsert[];
  problems: string[];
};

export type ComponentFiles = {
  zones?: { label: string; text: string } | null;
  corridors?: { label: string; text: string } | null;
  connectors?: { label: string; text: string } | null;
};

const ZONE_ID_KEYS = ["zone_id_external", "zone_id", "taz", "taz_id", "id"];
const NAME_KEYS = ["name", "zone_name", "label"];

/**
 * Build every row the component endpoints will be asked to create, or the list
 * of reasons the files cannot be used. Problems are capped per file so a
 * thousand identically-broken features produce a sentence, not a wall.
 */
export function buildComponentPlan(files: ComponentFiles): UploadPlan {
  const problems: string[] = [];
  const zones: ZoneInsert[] = [];
  const corridors: CorridorInsert[] = [];
  const connectors: ConnectorInsert[] = [];

  const zoneFile = files.zones ?? null;
  const corridorFile = files.corridors ?? null;
  const connectorFile = files.connectors ?? null;

  if (zoneFile) {
    const parsed = parseFeatureFile(zoneFile.label, zoneFile.text);
    if (!parsed.ok) {
      problems.push(parsed.reason);
    } else {
      const rejectedTypes = new Set<string>();
      parsed.features.forEach((feature) => {
        const type = enumValue(
          firstString(feature.properties, ["zone_type", "type"]),
          ZONE_TYPES,
          "taz"
        );
        if (!type.ok) {
          rejectedTypes.add(type.rejected);
          return;
        }
        zones.push({
          zone_id_external: firstString(feature.properties, ZONE_ID_KEYS),
          zone_type: type.value,
          name: firstString(feature.properties, NAME_KEYS),
          centroid_lat: firstNumber(feature.properties, ["centroid_lat", "lat", "latitude"]),
          centroid_lng: firstNumber(feature.properties, ["centroid_lng", "lng", "lon", "longitude"]),
          geometry_geojson: feature.geometry,
          properties: feature.properties,
        });
      });
      if (rejectedTypes.size > 0) {
        problems.push(
          `${zoneFile.label}: zone_type must be one of ${ZONE_TYPES.join(", ")}. Found ${[
            ...rejectedTypes,
          ]
            .map((value) => `"${value}"`)
            .join(", ")}.`
        );
      }

      /**
       * A REPEATED ZONE ID IS ONLY A PROBLEM WHEN CONNECTORS ARE BEING LOADED,
       * AND THEN IT IS A SILENT ONE. `network_connectors.zone_id` is resolved
       * by looking the planner's own id up in the zones this upload created,
       * so two zones both calling themselves "TAZ-7" leave every connector for
       * "TAZ-7" attached to whichever row was created last — with no error from
       * the database, which permits the duplicate, and no sign in the step
       * ledger, which counts both zones as created. The result is a network
       * basis that is wrong in a way nobody can see.
       *
       * It is NOT refused when no connectors file is present: duplicate ids in
       * a planner's own zone data are their business, nothing resolves against
       * them, and refusing there would deny a planner their own data to avoid
       * a problem that does not arise.
       */
      if (connectorFile) {
        const seen = new Set<string>();
        const duplicated = new Set<string>();
        for (const zone of zones) {
          if (!zone.zone_id_external) continue;
          if (seen.has(zone.zone_id_external)) duplicated.add(zone.zone_id_external);
          seen.add(zone.zone_id_external);
        }
        if (duplicated.size > 0) {
          const shown = [...duplicated].slice(0, 5).map((value) => `"${value}"`).join(", ");
          problems.push(
            `${zoneFile.label}: ${duplicated.size} zone id${
              duplicated.size === 1 ? " is" : "s are"
            } used by more than one feature (${shown}${duplicated.size > 5 ? ", …" : ""}). Connectors attach to a zone by this id, so a repeated id would silently attach them all to one of the duplicates. Give each zone a distinct id, or upload the zones without the connectors file.`
          );
        }
      }
    }
  }

  if (corridorFile) {
    const parsed = parseFeatureFile(corridorFile.label, corridorFile.text);
    if (!parsed.ok) {
      problems.push(parsed.reason);
    } else {
      const rejectedTypes = new Set<string>();
      const rejectedDirections = new Set<string>();
      let unnamed = 0;
      parsed.features.forEach((feature) => {
        const name = firstString(feature.properties, ["corridor_name", ...NAME_KEYS]);
        const type = enumValue(
          firstString(feature.properties, ["corridor_type", "type"]),
          CORRIDOR_TYPES,
          "highway"
        );
        const direction = enumValue(
          firstString(feature.properties, ["direction"]),
          CORRIDOR_DIRECTIONS,
          "both"
        );
        if (!name) unnamed += 1;
        if (!type.ok) rejectedTypes.add(type.rejected);
        if (!direction.ok) rejectedDirections.add(direction.rejected);
        if (!name || !type.ok || !direction.ok) return;
        corridors.push({
          corridor_name: name,
          corridor_type: type.value,
          direction: direction.value,
          geometry_geojson: feature.geometry,
          properties: feature.properties,
        });
      });
      if (unnamed > 0) {
        problems.push(
          `${corridorFile.label}: ${unnamed} feature${
            unnamed === 1 ? "" : "s"
          } have no corridor_name or name property. A corridor is stored under its name, so it cannot be left blank.`
        );
      }
      if (rejectedTypes.size > 0) {
        problems.push(
          `${corridorFile.label}: corridor_type must be one of ${CORRIDOR_TYPES.join(
            ", "
          )}. Found ${[...rejectedTypes].map((value) => `"${value}"`).join(", ")}.`
        );
      }
      if (rejectedDirections.size > 0) {
        problems.push(
          `${corridorFile.label}: direction must be one of ${CORRIDOR_DIRECTIONS.join(
            ", "
          )}. Found ${[...rejectedDirections].map((value) => `"${value}"`).join(", ")}.`
        );
      }
    }
  }

  if (connectorFile) {
    const parsed = parseFeatureFile(connectorFile.label, connectorFile.text);
    if (!parsed.ok) {
      problems.push(parsed.reason);
    } else if (!zoneFile) {
      problems.push(
        `${connectorFile.label}: a connector attaches to a zone created by this same upload, so a zones file is required alongside it.`
      );
    } else {
      const zoneIds = new Set(
        zones.map((zone) => zone.zone_id_external).filter((value): value is string => Boolean(value))
      );
      const rejectedTypes = new Set<string>();
      const unknownZones = new Set<string>();
      let unreferenced = 0;
      parsed.features.forEach((feature) => {
        const zoneExternalId = firstString(feature.properties, ZONE_ID_KEYS);
        const type = enumValue(
          firstString(feature.properties, ["connector_type", "type"]),
          CONNECTOR_TYPES,
          "auto"
        );
        if (!type.ok) rejectedTypes.add(type.rejected);
        if (!zoneExternalId) {
          unreferenced += 1;
          return;
        }
        if (!zoneIds.has(zoneExternalId)) {
          unknownZones.add(zoneExternalId);
          return;
        }
        if (!type.ok) return;
        connectors.push({
          zoneExternalId,
          target_node_id: firstString(feature.properties, ["target_node_id", "node_id", "node"]),
          connector_type: type.value,
          impedance_minutes: firstNumber(feature.properties, ["impedance_minutes", "impedance"]) ?? 0,
          geometry_geojson: feature.geometry,
        });
      });
      if (unreferenced > 0) {
        problems.push(
          `${connectorFile.label}: ${unreferenced} feature${
            unreferenced === 1 ? "" : "s"
          } name no zone. Each connector needs a zone_id (or taz/id) property matching a zone in the zones file.`
        );
      }
      if (unknownZones.size > 0) {
        const shown = [...unknownZones].slice(0, 5).map((value) => `"${value}"`).join(", ");
        problems.push(
          `${connectorFile.label}: ${unknownZones.size} zone id${
            unknownZones.size === 1 ? "" : "s"
          } referenced by connectors are not in the zones file (${shown}${
            unknownZones.size > 5 ? ", …" : ""
          }).`
        );
      }
      if (rejectedTypes.size > 0) {
        problems.push(
          `${connectorFile.label}: connector_type must be one of ${CONNECTOR_TYPES.join(
            ", "
          )}. Found ${[...rejectedTypes].map((value) => `"${value}"`).join(", ")}.`
        );
      }
    }
  }

  return { zones, corridors, connectors, problems };
}

/**
 * WHAT A REQUEST WILL WEIGH, MEASURED BEFORE IT IS SENT.
 *
 * Every one of these routes reads its body through `readJsonWithLimit` and
 * answers 413 above `BODY_LIMITS.networkGeoJson`, which is 2 MiB. A real
 * transportation network's nodes and links are routinely far larger than that,
 * so the ingest request is the single most likely thing here to be refused —
 * and it is the THIRD request, which means a planner learns their network is
 * too big only after a package and an empty version have been created in their
 * workspace.
 *
 * Measuring the exact bytes `fetch` would send costs nothing and moves that
 * refusal to before the first write, where the honest answer is "nothing was
 * sent" rather than "two records exist, go and find them".
 */
export function serializedByteLength(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The problems a deployment's body limit creates for THIS upload, named with
 * both the measured size and the ceiling, so a planner can tell whether they
 * are slightly over or ten times over. It never suggests splitting the network:
 * this form creates one version per upload, so two half-networks would be two
 * versions neither of which is the network — advice a planner cannot act on is
 * worse than none.
 */
export function requestSizeProblems(
  requests: { label: string; body: unknown }[],
  maxBytes: number
): string[] {
  const problems: string[] = [];
  for (const request of requests) {
    const size = serializedByteLength(request.body);
    if (size > maxBytes) {
      problems.push(
        `${request.label} would be ${formatMebibytes(size)}, and this deployment accepts at most ${formatMebibytes(
          maxBytes
        )} per request. Nothing was sent. Either reduce the network — fewer attributes per feature, or coordinates rounded to the precision the model needs — or ask whoever operates this deployment to raise the limit.`
      );
    }
  }
  return problems;
}

/**
 * `[minX, minY, maxX, maxY]`, the shape `network_packages.bbox` documents.
 * Derived from the network the planner is actually uploading rather than asked
 * for as four numbers nobody has to hand — and null when the files carry no
 * finite coordinate, because an invented extent is worse than a blank one.
 */
export function deriveBbox(sources: unknown[]): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;

  const walk = (value: unknown, depth: number) => {
    if (depth > 8 || !Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number" &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      const [x, y] = value as [number, number];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      seen = true;
      return;
    }
    for (const entry of value) walk(entry, depth + 1);
  };

  const visitGeometry = (geometry: unknown) => {
    if (!geometry || typeof geometry !== "object") return;
    walk((geometry as Record<string, unknown>).coordinates, 0);
    const geometries = (geometry as Record<string, unknown>).geometries;
    if (Array.isArray(geometries)) geometries.forEach(visitGeometry);
  };

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const root = source as Record<string, unknown>;
    if (Array.isArray(root.features)) {
      for (const feature of root.features) {
        visitGeometry((feature as Record<string, unknown> | null)?.geometry);
      }
    } else {
      visitGeometry(root.geometry ?? root);
    }
  }

  return seen ? [minX, minY, maxX, maxY] : null;
}
