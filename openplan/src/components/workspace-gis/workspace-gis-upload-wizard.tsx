"use client";

/**
 * Uploading an agency's own GIS file, from picking it to drawing it.
 *
 * ═══ THE ONE RULE THIS SCREEN EXISTS TO ENFORCE ═══
 *
 * A layer that lands in the wrong place is worse than a layer that refuses to
 * load, because the planner will believe it. Everything below follows from that:
 * the coordinate system is never guessed, a file with no `.prj` produces a
 * QUESTION rather than an assumption, and nothing is stored until the planner
 * has seen where the file actually lands and said yes.
 *
 * ═══ THE SHAPE OF THE FLOW ═══
 *
 *   pick a file
 *     → read it in the browser (a county parcels shapefile is 50–200 MB and
 *       never travels in a request body)
 *     → the file's `.prj` goes to the server, which says what it names
 *     → OR, with no `.prj`, the planner is ASKED, from a list narrowed to
 *       systems that actually cover their region
 *     → reproject locally, then CHECK where it landed
 *     → show them, and only then upload the features in batches
 *
 * The check is the part that cannot be skipped. A State Plane zone will happily
 * accept coordinates from the wrong state and return a longitude and latitude
 * that are properly formatted and completely wrong; the area-of-use test is what
 * notices, and it refuses rather than warns.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  checkCrsPlacement,
  type Bbox,
  type CrsPlacementWarning,
} from "@/lib/geo/crs/area-of-use";
import { forwardProject, inverseProject } from "@/lib/geo/crs/projections";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";
import {
  detectConvertibleFormat,
  describeConvertibleFormatRefusal,
  importSpatialFileAsync,
  type SpatialFileCrsDecision,
  type SpatialFileImport,
} from "@/lib/geo/spatial-file-import";
import {
  nextWorkspaceGisColor,
  WORKSPACE_GIS_DEFAULT_STYLE,
} from "@/lib/cartographic/workspace-gis-default-style";
import {
  createWorkspaceGisLayer,
  runWorkspaceGisIngest,
  WorkspaceGisRequestError,
} from "@/lib/workspace-gis/client";
import type {
  WorkspaceGisAttributeField,
  WorkspaceGisSourceFormat,
} from "@/lib/workspace-gis/types";

import { crsFor, identifyCrsFromPrjText } from "./crs-client";
import { CrsPicker } from "./crs-picker";
import { LayerPlacementPreview } from "./layer-placement-preview";

type WizardStage =
  | { kind: "idle" }
  | { kind: "reading"; filename: string }
  /** Parsing is PAUSED here, waiting on the planner. See `askForCrs`. */
  | { kind: "asking_crs"; filename: string }
  | { kind: "refused"; title: string; message: string; exportPath?: string | null }
  | {
      kind: "confirming";
      filename: string;
      imported: SpatialFileImport;
      entry: CrsRegistryEntry | null;
      basis: "prj_file" | "planner_asserted" | "specification";
      /**
       * The `.prj`'s VERBATIM TEXT, carried through to the ingest request.
       *
       * The import result does not keep it — `SpatialFileSrs` records what the
       * system was resolved to, which is a conclusion. What the ingest route
       * needs is the evidence, because it resolves the system again itself and
       * must not be handed this browser's answer.
       */
      prjText: string | null;
      warnings: CrsPlacementWarning[];
      bbox: Bbox | null;
    }
  | { kind: "uploading"; filename: string; sent: number; total: number }
  | { kind: "done"; layerName: string; featureCount: number };

/** GeoJSON/KML/KMZ fix their coordinate system by specification; shapefiles do not. */
function sourceFormatFor(filename: string): WorkspaceGisSourceFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) return "geojson";
  if (lower.endsWith(".kml")) return "kml";
  if (lower.endsWith(".kmz")) return "kmz";
  if (lower.endsWith(".zip")) return "shapefile_zip";
  return null;
}

function attributeFieldsFor(imported: SpatialFileImport): WorkspaceGisAttributeField[] {
  return imported.attributeFields.map((field) => ({ name: field.name, type: field.type }));
}

export function WorkspaceGisUploadWizard({
  /**
   * The workspace's own geography, as [west, south, east, north] in degrees.
   * `null` when the workspace has never stated one — the picker then says its
   * list is not narrowed to anywhere, rather than narrowing to a substituted
   * place.
   */
  homeGeography = null,
  homeGeographyUnreadable = false,
  /**
   * The colours this workspace's existing layers already draw in.
   *
   * Passed down rather than fetched here: the manager holds the catalog and
   * this screen holds the upload, and a second catalog read would be a second
   * answer to the same question. An empty list simply starts at the top of the
   * cycle, which is correct for the first upload a workspace ever makes.
   */
  existingColors = [],
  onUploaded,
}: {
  homeGeography?: [number, number, number, number] | null;
  /** The geography could not be read. NOT the same as none being stated. */
  homeGeographyUnreadable?: boolean;
  existingColors?: string[];
  onUploaded?: () => void;
}) {
  const [stage, setStage] = useState<WizardStage>({ kind: "idle" });
  const [layerName, setLayerName] = useState("");
  const [datumAcknowledged, setDatumAcknowledged] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * How the parse asks the planner a question and waits for the answer.
   *
   * The shared importer takes an ASYNC coordinate-system resolver, and this is
   * why: with no `.prj` there is nothing to resolve from, and the only honest
   * source of the answer is the person who has the file. So the resolver returns
   * a promise, the parse suspends inside it, this screen renders the picker, and
   * the promise settles when they choose. One parse, one question, no guess.
   */
  const crsAnswerRef = useRef<
    ((choice: { entry: CrsRegistryEntry; siblings: CrsRegistryEntry[] } | null) => void) | null
  >(null);
  const chosenEntryRef = useRef<CrsRegistryEntry | null>(null);
  /**
   * The same zone in its other units, kept for the area-of-use check.
   *
   * Without these the feet-for-metres test cannot run at all: it works by
   * reprojecting the file's own corners under each sibling and seeing which
   * reading lands inside the zone. An empty list turns the sharpest refusal in
   * this lane into a generic "outside the area of use", which is the difference
   * between telling a planner what is wrong and telling them that something is.
   */
  const chosenSiblingsRef = useRef<CrsRegistryEntry[]>([]);
  /** The verbatim `.prj` text the file carried, or null when it carried none. */
  const prjTextRef = useRef<string | null>(null);

  /*
    READ THROUGH FUNCTIONS, not directly.

    Every one of these refs is written inside the coordinate-system resolver — a
    closure TypeScript's flow analysis cannot follow. Read as `ref.current` right
    after the `= null` reset, the compiler narrows each to `null` and every
    branch below it becomes dead code that type-checks as `never`. A call
    boundary is what stops that, and it is a real bug-catcher rather than a
    formality: with the narrowing in place, `entry.kind === "projected"` was a
    branch the compiler believed could never run — which is exactly the
    area-of-use check that keeps a layer off the wrong continent.
  */

  const homeBbox = useMemo<Bbox | null>(
    () =>
      homeGeography
        ? {
            west: homeGeography[0],
            south: homeGeography[1],
            east: homeGeography[2],
            north: homeGeography[3],
          }
        : null,
    [homeGeography]
  );

  const answerCrs = useCallback(
    (choice: { entry: CrsRegistryEntry; siblings: CrsRegistryEntry[] } | null) => {
      const answer = crsAnswerRef.current;
      crsAnswerRef.current = null;
      if (answer) answer(choice);
    },
    []
  );

  const readChosenEntry = useCallback((): CrsRegistryEntry | null => chosenEntryRef.current, []);
  const readPrjText = useCallback((): string | null => prjTextRef.current, []);

  const handleFile = useCallback(
    async (file: File) => {
      setDatumAcknowledged(false);
      chosenEntryRef.current = null;
      chosenSiblingsRef.current = [];
      prjTextRef.current = null;
      setStage({ kind: "reading", filename: file.name });

      const bytes = new Uint8Array(await file.arrayBuffer());

      // A .gdb or .mdb is a REAL GIS format, not a broken file, and it gets a
      // refusal that says so and shows the four clicks that produce something
      // OpenPlan can read. Generic "unsupported format" copy teaches a planner
      // nothing and is how a legitimate file looks like a corrupt one.
      const convertible = detectConvertibleFormat(file.name, bytes);
      if (convertible) {
        setStage({
          kind: "refused",
          title: "This is a file geodatabase",
          message: describeConvertibleFormatRefusal(convertible),
        });
        return;
      }

      const sourceFormat = sourceFormatFor(file.name);
      if (!sourceFormat) {
        setStage({
          kind: "refused",
          title: "OpenPlan cannot read this file",
          message:
            "Upload a GeoJSON (.geojson), a KML or KMZ, or a shapefile zipped up with its .shp, .shx, .dbf and " +
            ".prj files together. A .shp on its own carries no attributes and no coordinate system.",
        });
        return;
      }

      const resolveCrs = async (evidence: {
        prjText: string | null;
        filename: string;
      }): Promise<SpatialFileCrsDecision> => {
        prjTextRef.current = evidence.prjText;

        if (evidence.prjText) {
          const identified = await identifyCrsFromPrjText(evidence.prjText);
          if (!identified.ok) {
            // The registry does not carry it. NOT approximated by a nearby zone
            // — that is the failure mode the whole registry exists to prevent.
            return { ok: false, reason: "srs_unsupported", message: identified.message };
          }
          chosenEntryRef.current = identified.entry;
          chosenSiblingsRef.current = identified.siblings ?? [];
          return { ok: true, crs: crsFor(identified.entry), basis: "prj_file" };
        }

        // No .prj. Ask, and wait.
        setStage({ kind: "asking_crs", filename: evidence.filename });
        const chosen = await new Promise<{
          entry: CrsRegistryEntry;
          siblings: CrsRegistryEntry[];
        } | null>((resolve) => {
          crsAnswerRef.current = resolve;
        });
        if (!chosen) {
          return {
            ok: false,
            reason: "srs_undetermined",
            message:
              "This shapefile has no .prj file, so nothing in it says which coordinate system its numbers are " +
              "in, and no system was chosen. OpenPlan will not guess: a wrong guess puts the layer tens of " +
              "kilometres from where it belongs and looks exactly like a right one.",
          };
        }
        chosenEntryRef.current = chosen.entry;
        chosenSiblingsRef.current = chosen.siblings;
        return { ok: true, crs: crsFor(chosen.entry), basis: "planner_asserted" };
      };

      const imported = await importSpatialFileAsync(
        { filename: file.name, bytes, featureCap: null },
        undefined,
        resolveCrs
      );

      if (!imported.ok) {
        setStage({
          kind: "refused",
          title: "This file was not stored",
          message: imported.message,
        });
        return;
      }

      const entry = readChosenEntry();
      const prjTextSeen = readPrjText();
      const bbox: Bbox | null = imported.bbox
        ? {
            west: imported.bbox[0],
            south: imported.bbox[1],
            east: imported.bbox[2],
            north: imported.bbox[3],
          }
        : null;

      // ── WHERE DID IT LAND? ────────────────────────────────────────────────
      //
      // Only meaningful for a PROJECTED file: a GeoJSON is already in longitude
      // and latitude, so there is no reading of it that could put it in the
      // wrong hemisphere.
      let warnings: CrsPlacementWarning[] = [];
      if (entry && bbox && entry.kind === "projected") {
        const placement = checkCrsPlacement({
          entry,
          bbox,
          homeGeography: homeBbox,
          /*
            THE FEET-FOR-METRES CHECK, made real rather than decorative.

            Both siblings are the same projection on the same datum with the same
            false origin — they differ only in the unit the FILE's numbers are in.
            So the same stored coordinate read the other way is the projected
            metre value scaled by the ratio of the two units, and inverse-
            projecting that says where the file would land under the other
            reading. When the declared unit fails the area test and the sibling
            passes, the planner gets the commonest legacy mistake named outright
            instead of a generic "outside the area of use".
          */
          siblings: chosenSiblingsRef.current,
          reprojectAs: (sibling) => reprojectBboxAsSibling(entry, sibling, bbox),
        });

        if (!placement.ok) {
          setStage({
            kind: "refused",
            title: "This layer does not land where that coordinate system covers",
            message: placement.message,
          });
          return;
        }
        warnings = placement.warnings;
      }

      setStage({
        kind: "confirming",
        filename: file.name,
        imported,
        entry,
        basis: entry ? (prjTextSeen ? "prj_file" : "planner_asserted") : "specification",
        prjText: prjTextSeen,
        warnings,
        bbox,
      });
      setLayerName((current) =>
        current.trim().length > 0 ? current : defaultLayerName(file.name)
      );
    },
    [homeBbox, readChosenEntry, readPrjText]
  );

  const confirmUpload = useCallback(
    async (stageAt: Extract<WizardStage, { kind: "confirming" }>) => {
      const name = layerName.trim();
      if (name.length === 0) return;

      const sourceFormat = sourceFormatFor(stageAt.filename);
      if (!sourceFormat) return;

      const features = stageAt.imported.featureCollection.features;
      setStage({ kind: "uploading", filename: stageAt.filename, sent: 0, total: features.length });

      try {
        /*
          A LAYER SOMEBODY JUST UPLOADED IS ON, AND IS DRAWN IN A COLOUR THEY
          CAN FIND.

          `createWorkspaceGisLayer({ name })` sent nothing else, so every layer
          took the column defaults: `default_visible = FALSE` and `#94a3b8` at
          1.5px. A planner's first upload therefore arrived switched off, and
          switching it on drew a slate-grey hairline over a grey basemap. Both
          defaults are right for the COLUMN — a row nobody chose for should not
          switch itself on — and wrong here, where a person has just answered
          "does this look right?" with yes. Stating the intent explicitly is
          what makes the schema's caution and this screen's meaning coexist.

          See `lib/cartographic/workspace-gis-default-style` for the palette and
          why the width moved.
        */
        const layer = await createWorkspaceGisLayer({
          name,
          color: nextWorkspaceGisColor(existingColors),
          lineWidth: WORKSPACE_GIS_DEFAULT_STYLE.lineWidth,
          defaultVisible: WORKSPACE_GIS_DEFAULT_STYLE.defaultVisible,
        });

        await runWorkspaceGisIngest({
          open: {
            layerId: layer.id,
            sourceFormat,
            sourceFilename: stageAt.filename,
            sourceByteSize: 0,
            // THE EVIDENCE, NOT THE CONCLUSION. The server resolves the system
            // again from this, independently. The browser never sends "this file
            // is EPSG:2226" and have that believed.
            prjText: stageAt.prjText,
            assertedSrsCode:
              stageAt.basis === "planner_asserted" && stageAt.entry
                ? `${stageAt.entry.authority}:${stageAt.entry.code}`
                : null,
            datumAcknowledged,
            declaredFeatureCount: features.length,
            sourceFeatureCount: stageAt.imported.sourceFeatureCount,
            droppedFeatureCount: stageAt.imported.droppedFeatureCount,
            geometryKinds: stageAt.imported.geometryKinds,
            attributeFields: attributeFieldsFor(stageAt.imported),
            attributeEncoding: stageAt.imported.attributeEncoding?.label ?? null,
            attributeEncodingIsFallback:
              stageAt.imported.attributeEncoding?.basis === "fallback",
            bbox: stageAt.imported.bbox,
            reprojectionEngine: stageAt.entry && stageAt.entry.kind === "projected" ? "openplan" : "none",
          },
          features,
          onProgress: (progress) => {
            setStage({
              kind: "uploading",
              filename: stageAt.filename,
              sent: progress.featureCount,
              total: progress.declaredFeatureCount,
            });
          },
        });

        setStage({ kind: "done", layerName: name, featureCount: features.length });
        setLayerName("");
        onUploaded?.();
      } catch (error) {
        // The route's own sentence, never a generic one: a 501 for a geodatabase
        // names the two env vars and the export path, and replacing that with
        // "Upload failed" throws away the only actionable thing in it.
        const message =
          error instanceof WorkspaceGisRequestError
            ? error.message
            : error instanceof Error
              ? error.message
              : "The upload did not finish.";
        const exportPath =
          error instanceof WorkspaceGisRequestError &&
          typeof error.payload.exportPath === "string"
            ? error.payload.exportPath
            : null;
        setStage({ kind: "refused", title: "This file was not stored", message, exportPath });
      }
    },
    [layerName, datumAcknowledged, existingColors, onUploaded]
  );

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <div className="op-gis-wizard" data-stage={stage.kind}>
      {stage.kind === "idle" ? (
        <label className="op-gis-wizard__drop">
          <span className="op-gis-wizard__drop-title">Add a map layer</span>
          <span className="op-gis-wizard__drop-hint">
            GeoJSON, KML, KMZ, or a shapefile zipped with its .shp, .shx, .dbf and .prj together.
            A shapefile with no .prj still works — OpenPlan will ask you which coordinate system it
            is in rather than guessing.
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,.kml,.kmz,.zip,.gdb,.mdb"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
      ) : null}

      {stage.kind === "reading" ? (
        <p className="op-gis-wizard__status" role="status">
          Reading {stage.filename}…
        </p>
      ) : null}

      {stage.kind === "asking_crs" ? (
        <div className="op-gis-wizard__ask">
          <h4>Which coordinate system is {stage.filename} in?</h4>
          <p>
            This shapefile has no .prj file, so nothing in it says what its numbers mean. OpenPlan
            will record whichever system you choose as <strong>your statement</strong>, not as
            something read from the file — and it will show you where the layer lands before storing
            anything.
          </p>
          <CrsPicker
            region={homeGeography}
            regionUnreadable={homeGeographyUnreadable}
            onChoose={(entry, siblings) => answerCrs({ entry, siblings })}
            onCancel={() => {
              answerCrs(null);
              reset();
            }}
          />
        </div>
      ) : null}

      {stage.kind === "refused" ? (
        <div className="op-gis-wizard__refusal" role="alert">
          <h4>{stage.title}</h4>
          <p>{stage.message}</p>
          {stage.exportPath ? <p className="op-gis-wizard__export">{stage.exportPath}</p> : null}
          <button type="button" className="op-cart-btn" onClick={reset}>
            Try another file
          </button>
        </div>
      ) : null}

      {stage.kind === "confirming" ? (
        <div className="op-gis-wizard__confirm">
          <h4>Does this look right?</h4>
          <LayerPlacementPreview
            imported={stage.imported}
            entry={stage.entry}
            basis={stage.basis}
            warnings={stage.warnings}
            bbox={stage.bbox}
            homeGeography={homeGeography}
          />

          <label className="op-gis-wizard__field">
            <span>Layer name</span>
            <input
              type="text"
              value={layerName}
              onChange={(event) => setLayerName(event.target.value)}
              placeholder="Bike network"
            />
          </label>

          {stage.entry?.requiresDatumAcknowledgement ? (
            /*
              THE ONE PLACE THIS PRODUCT ACCEPTS KNOWN POSITIONAL ERROR.

              OpenPlan ships no datum-shift grids, so a NAD27 layer can sit
              roughly a hundred metres from truth in the western US. Refusing
              outright would strand exactly the "super old shapefiles" a planning
              department actually holds, which is who this feature is for. So it
              is accepted, the magnitude is stated in the registry's own words,
              the planner acknowledges it here, and the note then rides with the
              layer permanently — panel, legend and inspector — because a caveat
              seen once at upload has stopped existing by the time a colleague
              opens the map.
            */
            <label className="op-gis-wizard__ack">
              <input
                type="checkbox"
                checked={datumAcknowledged}
                onChange={(event) => setDatumAcknowledged(event.target.checked)}
              />
              <span>{stage.entry.datumShiftNote}</span>
            </label>
          ) : null}

          <div className="op-gis-wizard__actions">
            <button type="button" className="op-cart-btn" onClick={reset}>
              Cancel
            </button>
            <button
              type="button"
              className="op-cart-btn op-cart-btn--primary"
              disabled={
                layerName.trim().length === 0 ||
                (stage.entry?.requiresDatumAcknowledgement === true && !datumAcknowledged)
              }
              onClick={() => void confirmUpload(stage)}
            >
              Yes — add this layer
            </button>
          </div>
        </div>
      ) : null}

      {stage.kind === "uploading" ? (
        <div className="op-gis-wizard__progress" role="status">
          <p>
            Uploading {stage.filename} — {stage.sent.toLocaleString()} of{" "}
            {stage.total.toLocaleString()} shapes.
          </p>
          <progress value={stage.sent} max={Math.max(stage.total, 1)} />
          <p className="op-gis-wizard__hint">
            Keep this tab open until it finishes. An upload that stops partway is recorded as
            unfinished and nothing from it is drawn.
          </p>
        </div>
      ) : null}

      {stage.kind === "done" ? (
        <div className="op-gis-wizard__done" role="status">
          {/*
            "Switch it on from the Layers panel on any map" was the old sentence
            and it stopped being true the moment a new layer started visible. A
            planner told to go and switch on something already on will look for
            a control that is not there and conclude the upload failed. The
            layer's own row below carries the "Show on the map" link.
          */}
          <p>
            <strong>{stage.layerName}</strong> is stored and switched on —{" "}
            {stage.featureCount.toLocaleString()} shapes. Use{" "}
            <strong>Show on the map</strong> on its row below to go and look at it.
          </p>
          <button type="button" className="op-cart-btn" onClick={reset}>
            Add another layer
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** "sacramento_bike_network_2024.zip" → "Sacramento bike network 2024". */
function defaultLayerName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (base.length === 0) return "";
  return base[0].toUpperCase() + base.slice(1);
}

/**
 * Where the same file would land read as the OTHER unit of the same zone.
 *
 * Forward-project the corners back into the entry's own projected metres,
 * rescale by the ratio of the two units — which is exactly what reading the same
 * stored number as feet instead of metres does — then inverse-project under the
 * sibling. Returns null if any corner is unprojectable, because a partial answer
 * to "where would this land?" is worse than none.
 */
function reprojectBboxAsSibling(
  entry: CrsRegistryEntry,
  sibling: CrsRegistryEntry,
  bbox: Bbox
): Bbox | null {
  const ratio = sibling.unitToMetres / entry.unitToMetres;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const corners: Array<[number, number]> = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
  ];
  const moved: Array<[number, number]> = [];
  for (const [longitude, latitude] of corners) {
    const projected = forwardProject(entry.method, longitude, latitude, entry.params);
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return null;
    const asSibling = inverseProject(
      sibling.method,
      projected[0] * ratio,
      projected[1] * ratio,
      sibling.params
    );
    if (!asSibling || !Number.isFinite(asSibling[0]) || !Number.isFinite(asSibling[1])) return null;
    moved.push([asSibling[0], asSibling[1]]);
  }

  return {
    west: Math.min(moved[0][0], moved[1][0]),
    south: Math.min(moved[0][1], moved[1][1]),
    east: Math.max(moved[0][0], moved[1][0]),
    north: Math.max(moved[0][1], moved[1][1]),
  };
}
