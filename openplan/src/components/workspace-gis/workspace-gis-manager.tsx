"use client";

/**
 * The workspace's map layers, where a planner manages them.
 *
 * Upload lives here, and so does everything that happens to a layer afterwards:
 * how it draws, which upload the maps are using, and what would break if it were
 * deleted.
 *
 * ═══ FOUR STYLE CONTROLS, AND NO STYLE JSON ═══
 *
 * Colour, opacity, width, and an optional label field. That is the whole
 * vocabulary, and it is deliberately smaller than Mapbox's: a planner is not a
 * cartographer with a style spec open, and a raw JSON box would be a support
 * burden that produces layers nobody else can read. Fill-versus-line is not
 * asked at all — it is DERIVED from the geometry, because a polygon layer needs
 * a fill and a line layer cannot have one, and asking is asking a question with
 * only one right answer.
 *
 * ═══ WHY DELETION IS A CONVERSATION ═══
 *
 * A layer an engagement campaign adopted, or a report cited, cannot simply
 * vanish — an adopted plan that cites a layer has to keep resolving. So delete
 * asks the server what refers to it, LISTS those things by name, and offers
 * archiving instead. The database enforces the same rule with an ON DELETE
 * RESTRICT, so a planner who gets past this dialog still cannot break a record.
 */

import { useCallback, useEffect, useState } from "react";

import {
  deleteWorkspaceGisLayer,
  fetchWorkspaceGisLayer,
  fetchWorkspaceGisLayerReferences,
  fetchWorkspaceGisLayers,
  updateWorkspaceGisLayer,
  WorkspaceGisRequestError,
} from "@/lib/workspace-gis/client";
import type {
  WorkspaceGisLayer,
  WorkspaceGisLayerListing,
  WorkspaceGisLayerReferencesResponse,
  WorkspaceGisVersion,
} from "@/lib/workspace-gis/types";

import { WorkspaceGisUploadWizard } from "./workspace-gis-upload-wizard";

export function WorkspaceGisManager({
  homeGeography = null,
  homeGeographyUnreadable = false,
  readOnly = false,
}: {
  homeGeography?: [number, number, number, number] | null;
  /**
   * True when the workspace's geography could not be READ — a different fact
   * from "none is stated", and one the picker must not present as the other.
   */
  homeGeographyUnreadable?: boolean;
  readOnly?: boolean;
}) {
  const [listings, setListings] = useState<WorkspaceGisLayerListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLayerId, setOpenLayerId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setListings(await fetchWorkspaceGisLayers());
      setError(null);
    } catch (cause) {
      // A failed list and an empty workspace look identical on screen, and only
      // one is a fact about the workspace.
      setError(
        cause instanceof Error ? cause.message : "Your map layers could not be loaded."
      );
    }
  }, []);

  useEffect(() => {
    // The initial catalog read. It sets state when it resolves, which is what
    // this rule is about — but the alternative is rendering a layer list from
    // nothing, and this is a fetch on mount rather than derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return (
    <section className="op-gis-manager" aria-label="Map layers">
      {!readOnly ? (
        <WorkspaceGisUploadWizard
          homeGeography={homeGeography}
          homeGeographyUnreadable={homeGeographyUnreadable}
          onUploaded={() => void reload()}
        />
      ) : (
        <p className="op-gis-manager__readonly">
          Your role in this workspace can see map layers but not upload or change them.
        </p>
      )}

      {error ? (
        <p className="op-gis-manager__error" role="alert">
          {error}
        </p>
      ) : null}

      {listings === null && !error ? <p role="status">Loading map layers…</p> : null}

      {listings !== null && listings.length === 0 && !error ? (
        <p className="op-gis-manager__empty">
          No map layers yet. Upload your agency&rsquo;s own GIS files — a bike network, city limits,
          zoning, parcels — and they become toggles on the Layers panel on Safety and Aerial.
        </p>
      ) : null}

      {listings !== null && listings.length > 0 ? (
        <ul className="op-gis-manager__list" role="list">
          {listings.map((listing) => (
            <LayerRow
              key={listing.layer.id}
              listing={listing}
              readOnly={readOnly}
              expanded={openLayerId === listing.layer.id}
              onToggleExpanded={() =>
                setOpenLayerId((current) =>
                  current === listing.layer.id ? null : listing.layer.id
                )
              }
              onChanged={() => void reload()}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LayerRow({
  listing,
  readOnly,
  expanded,
  onToggleExpanded,
  onChanged,
}: {
  listing: WorkspaceGisLayerListing;
  readOnly: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChanged: () => void;
}) {
  const layer = listing.layer;
  const version = layer.currentVersion;

  return (
    <li className="op-gis-layer">
      <div className="op-gis-layer__hd">
        <span
          className="op-gis-layer__swatch"
          style={{ backgroundColor: layer.style.color }}
          aria-hidden
        />
        <div className="op-gis-layer__ident">
          <strong>{layer.name}</strong>
          <span className="op-gis-layer__sub">
            {version
              ? `${version.featureCount.toLocaleString()} shapes · version ${version.versionNumber} · ${version.srs.name}`
              : "No finished upload — nothing is drawn for this layer"}
          </span>
        </div>
        <button type="button" className="op-cart-btn" onClick={onToggleExpanded}>
          {expanded ? "Close" : "Manage"}
        </button>
      </div>

      {/*
        THE CAVEATS RIDE WITH THE LAYER EVERYWHERE, including here — an asserted
        coordinate system, a datum note, a truncated upload. `notes` is a list
        rather than a joined string precisely so a layer carrying three of them
        shows three.
      */}
      {listing.notes.length > 0 ? (
        <ul className="op-gis-layer__notes" role="note">
          {listing.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {expanded ? (
        <div className="op-gis-layer__panel">
          <LayerStyleControls layer={layer} readOnly={readOnly} onChanged={onChanged} />
          <LayerVersionHistory layer={layer} readOnly={readOnly} onChanged={onChanged} />
          {!readOnly ? <LayerDeleteControl layer={layer} onChanged={onChanged} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function LayerStyleControls({
  layer,
  readOnly,
  onChanged,
}: {
  layer: WorkspaceGisLayer;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [style, setStyle] = useState(layer.style);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attributeNames = layer.currentVersion?.attributeFields.map((field) => field.name) ?? [];

  const save = async (next: typeof style) => {
    setStyle(next);
    setSaving(true);
    setError(null);
    try {
      await updateWorkspaceGisLayer(layer.id, next);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That change was not saved.");
      setStyle(layer.style);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="op-gis-style" disabled={readOnly || saving}>
      <legend>How this layer draws</legend>

      <label>
        <span>Colour</span>
        <input
          type="color"
          value={style.color}
          onChange={(event) => void save({ ...style, color: event.target.value })}
        />
      </label>

      <label>
        <span>Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={style.opacity}
          onChange={(event) => void save({ ...style, opacity: Number(event.target.value) })}
        />
      </label>

      <label>
        <span>Line width</span>
        <input
          type="range"
          min={0.5}
          max={8}
          step={0.5}
          value={style.lineWidth}
          onChange={(event) => void save({ ...style, lineWidth: Number(event.target.value) })}
        />
      </label>

      <label>
        <span>Label shapes by</span>
        <select
          value={style.labelField ?? ""}
          onChange={(event) =>
            void save({ ...style, labelField: event.target.value || null })
          }
        >
          {/*
            "No labels" is the DEFAULT and the first option, not an afterthought:
            a parcels layer labelled by default is a solid block of text over the
            map. The list is the file's own columns — there is no free-text box,
            because a label field that names no real column silently draws
            nothing.
          */}
          <option value="">No labels</option>
          {attributeNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      {attributeNames.length === 0 ? (
        <p className="op-gis-style__note">
          This upload carried no attribute table, so there is nothing to label shapes by.
        </p>
      ) : null}

      {error ? (
        <p className="op-gis-style__error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Every upload of this layer, and which one the maps are drawing.
 *
 * VERSIONS ARE KEPT, NOT REPLACED. "2025 parcels versus 2026 parcels" is a real
 * planning question, and an agency that re-uploads next year's file should not
 * lose the ability to ask it. Switching the current version changes what every
 * map in the product draws, which is why it is an explicit button per row and
 * never a side effect of uploading.
 */
function LayerVersionHistory({
  layer,
  readOnly,
  onChanged,
}: {
  layer: WorkspaceGisLayer;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [versions, setVersions] = useState<WorkspaceGisVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceGisLayer(layer.id)
      .then((detail) => {
        if (!cancelled) setVersions(detail.versions ?? []);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "This layer's upload history could not be read."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [layer.id]);

  const promote = async (versionId: string) => {
    try {
      await updateWorkspaceGisLayer(layer.id, { currentVersionId: versionId });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That version was not made current.");
    }
  };

  return (
    <div className="op-gis-versions">
      <h5>Uploads</h5>
      {error ? (
        <p className="op-gis-versions__error" role="alert">
          {error}
        </p>
      ) : null}
      {versions === null && !error ? <p role="status">Loading uploads…</p> : null}
      {versions !== null ? (
        <ul role="list">
          {versions.map((version) => {
            const isCurrent = layer.currentVersion?.id === version.id;
            return (
              <li key={version.id}>
                <span>
                  Version {version.versionNumber} · {version.sourceFilename} ·{" "}
                  {version.featureCount.toLocaleString()} shapes
                  {version.ingestStatus !== "ready" ? ` · ${version.ingestStatus}` : ""}
                </span>
                {isCurrent ? (
                  <strong> — drawn on maps now</strong>
                ) : !readOnly && version.ingestStatus === "ready" ? (
                  <button
                    type="button"
                    className="op-cart-btn"
                    onClick={() => void promote(version.id)}
                  >
                    Draw this one instead
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function LayerDeleteControl({
  layer,
  onChanged,
}: {
  layer: WorkspaceGisLayer;
  onChanged: () => void;
}) {
  const [references, setReferences] = useState<WorkspaceGisLayerReferencesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      setReferences(await fetchWorkspaceGisLayerReferences(layer.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "OpenPlan could not check what uses this layer."
      );
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteWorkspaceGisLayer(layer.id);
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof WorkspaceGisRequestError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "This layer was not deleted."
      );
    }
  };

  const archive = async () => {
    try {
      await updateWorkspaceGisLayer(layer.id, { archived: true });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This layer was not archived.");
    }
  };

  return (
    <div className="op-gis-delete">
      {!asking ? (
        <button type="button" className="op-cart-btn" onClick={() => void ask()}>
          Delete this layer…
        </button>
      ) : null}

      {error ? (
        <p className="op-gis-delete__error" role="alert">
          {error}
        </p>
      ) : null}

      {references ? (
        <div className="op-gis-delete__dialog" role="dialog" aria-label="Delete this layer?">
          {references.deletable ? (
            <>
              <p>
                Nothing else in this workspace refers to <strong>{layer.name}</strong>. Deleting it
                removes the layer and every upload of it. This cannot be undone.
              </p>
              <button type="button" className="op-cart-btn" onClick={() => void confirmDelete()}>
                Delete permanently
              </button>
            </>
          ) : (
            <>
              {/*
                NAMED, AND LINKED. "This layer is in use" tells a planner nothing
                they can act on; a list of the campaigns and reports that adopted
                it tells them exactly what to go and change, or that they should
                archive instead.
              */}
              <p>{references.refusal}</p>
              <ul role="list">
                {references.references.map((reference) => (
                  <li key={reference.id}>
                    {reference.href ? (
                      <a href={reference.href}>{reference.label}</a>
                    ) : (
                      reference.label
                    )}
                  </li>
                ))}
              </ul>
              <p>
                Archiving takes it off the maps and keeps those references resolving.
              </p>
              <button type="button" className="op-cart-btn" onClick={() => void archive()}>
                Archive instead
              </button>
            </>
          )}
          <button type="button" className="op-cart-btn" onClick={() => setAsking(false)}>
            Keep this layer
          </button>
        </div>
      ) : null}
    </div>
  );
}
