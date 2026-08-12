"use client";

/**
 * "Read this way, your file lands HERE. Is that right?"
 *
 * ═══ WHY A PREVIEW AND NOT JUST A CHECK ═══
 *
 * The area-of-use test catches a file that lands in the wrong STATE. It cannot
 * catch a file that lands in the right state and the wrong county, and it cannot
 * catch a file that is simply not what the planner thought they were uploading.
 * Only the person who knows the data can catch those, and they can only catch
 * them if they are shown where it went before it is stored.
 *
 * So this is the last thing between a file and the map, and it says three
 * things: what coordinate system the file was read as and on whose authority,
 * where the shapes landed, and what OpenPlan noticed that it did not consider
 * bad enough to refuse.
 *
 * ═══ WHY IT REPORTS RATHER THAN REASSURES ═══
 *
 * There is no "looks good!" state. The absence of a warning is not evidence that
 * the layer is right — it is evidence that nothing OpenPlan can test found a
 * problem, and the two are different claims. The heading asks a question and the
 * planner answers it.
 */

import { useMemo } from "react";

import { describeSpatialFileSrs } from "@/lib/geo/crs/describe";
import type { Bbox, CrsPlacementWarning } from "@/lib/geo/crs/area-of-use";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";
import type { SpatialFileImport } from "@/lib/geo/spatial-file-import";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";

const MAPBOX_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

function formatDegrees(value: number): string {
  return `${Math.abs(value).toFixed(4)}°${value < 0 ? "W" : "E"}`;
}

function formatLatitude(value: number): string {
  return `${Math.abs(value).toFixed(4)}°${value < 0 ? "S" : "N"}`;
}

/**
 * A static Mapbox image of the file's extent, when a token is configured.
 *
 * A STATIC IMAGE RATHER THAN A LIVE MAP, deliberately: this is one glance at one
 * question, the wizard is already holding a parsed 200 MB file in memory, and
 * standing up a second interactive GL context beside the workspace's own map is
 * a lot of machinery for a picture nobody pans. Without a token there is no
 * image and the extent is stated in words — which is degraded, and said so,
 * rather than a blank box.
 */
function staticMapUrl(bbox: Bbox): string | null {
  if (!MAPBOX_TOKEN) return null;
  const overlay = encodeURIComponent(
    JSON.stringify({
      type: "Feature",
      properties: { stroke: "#c1440e", "stroke-width": 3, fill: "#c1440e", "fill-opacity": 0.25 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [bbox.west, bbox.south],
            [bbox.east, bbox.south],
            [bbox.east, bbox.north],
            [bbox.west, bbox.north],
            [bbox.west, bbox.south],
          ],
        ],
      },
    }),
  );
  // `auto` frames the overlay, so the picture is always of the data rather than
  // of a camera somebody chose.
  return (
    `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/geojson(${overlay})/auto/480x300` +
    `?padding=40&access_token=${MAPBOX_TOKEN}`
  );
}

export function LayerPlacementPreview({
  imported,
  entry,
  basis,
  warnings,
  bbox,
  homeGeography,
}: {
  imported: SpatialFileImport;
  entry: CrsRegistryEntry | null;
  basis: "prj_file" | "planner_asserted" | "specification";
  warnings: CrsPlacementWarning[];
  bbox: Bbox | null;
  homeGeography: [number, number, number, number] | null;
}) {
  const imageUrl = useMemo(() => (bbox ? staticMapUrl(bbox) : null), [bbox]);

  const srsSentence = describeSpatialFileSrs(imported.srs);

  return (
    <div className="op-gis-preview">
      <div className="op-gis-preview__map">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={
              bbox
                ? `The extent of this file, from ${formatLatitude(bbox.south)} ${formatDegrees(bbox.west)} ` +
                  `to ${formatLatitude(bbox.north)} ${formatDegrees(bbox.east)}`
                : "The extent of this file"
            }
            width={480}
            height={300}
          />
        ) : (
          <p className="op-gis-preview__no-map">
            {bbox
              ? "No basemap is configured on this deployment, so the extent is given in coordinates rather " +
                "than drawn. Check them against where you expect this data to be."
              : "This file carries no usable extent, so there is nothing to show."}
          </p>
        )}
      </div>

      <dl className="op-gis-preview__facts">
        <div>
          <dt>Read as</dt>
          <dd>
            {srsSentence}
            {basis === "planner_asserted" ? (
              /*
                THE CLAIM TIER, ON SCREEN, AT THE MOMENT IT IS MADE.

                This is the sentence that keeps `planner_asserted` honest. The
                file said nothing; a person said this. It is recorded with their
                name on it, it is shown everywhere the layer appears, and it can
                never be rewritten as something the file testified to.
              */
              <strong className="op-gis-preview__asserted">
                {" "}
                This is your statement, not something read from the file — nothing in this file says
                what coordinate system it is in.
              </strong>
            ) : null}
          </dd>
        </div>

        {bbox ? (
          <div>
            <dt>Lands between</dt>
            <dd>
              {formatLatitude(bbox.south)} {formatDegrees(bbox.west)} and{" "}
              {formatLatitude(bbox.north)} {formatDegrees(bbox.east)}
              {homeGeography ? null : (
                <span className="op-gis-preview__aside">
                  {" "}
                  — this workspace has stated no geography, so OpenPlan cannot tell you whether that
                  is near your work.
                </span>
              )}
            </dd>
          </div>
        ) : null}

        <div>
          <dt>Shapes</dt>
          <dd>
            {imported.featureCount.toLocaleString()} to store
            {imported.droppedFeatureCount > 0
              ? `, ${imported.droppedFeatureCount.toLocaleString()} that could not be placed and will not be`
              : ""}
            {imported.truncated
              ? ` — of ${imported.sourceFeatureCount.toLocaleString()} in the file. The rest are beyond this deployment's per-layer limit.`
              : "."}
          </dd>
        </div>

        <div>
          <dt>Attributes</dt>
          <dd>
            {imported.attributeFields.length > 0
              ? imported.attributeFields.map((field) => field.name).join(", ")
              : /*
                  An empty attribute table is a real finding worth stating: a
                  layer with no attributes clicks through to an empty inspector
                  and cannot be labelled, and a planner who expected columns
                  should learn that here rather than after uploading.
                */
                (imported.attributesUnavailableReason ??
                  "This file carries no attribute table, so its shapes cannot be labelled or clicked through to.")}
            {imported.attributeEncoding?.basis === "fallback" ? (
              <span className="op-gis-preview__aside">
                {" "}
                — the file did not say how its text is encoded, so it was read as{" "}
                {imported.attributeEncoding.label}. Accented names may be wrong; the geometry is
                unaffected.
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {warnings.length > 0 ? (
        <ul className="op-gis-preview__warnings" role="note">
          {/*
            WARNINGS, NOT REFUSALS, and the distinction is the product decision:
            a statewide layer or a neighbouring county's parcels are legitimate
            uploads, so "this is far from your work" cannot block anything. What
            lands outside the coordinate system's own area of use is a different
            claim entirely and never reaches here — that refuses.
          */}
          {warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      {entry?.datumShiftMetres != null && entry.datumShiftMetres > 0 ? (
        <p className="op-gis-preview__datum">
          Measured datum difference for this system: about{" "}
          {Math.round(entry.datumShiftMetres).toLocaleString()} m.
        </p>
      ) : null}
    </div>
  );
}
