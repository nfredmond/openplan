"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Layers, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Form, FormActions, FormError, FormField, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  contextLayerPublicationWarning,
  describeContextLayerCoverage,
  describeContextLayerSrs,
  contextLayerDisclosure,
  type ContextLayerSummary,
} from "@/lib/engagement/context-layers";

/**
 * The operator's control over what GIS context a campaign puts on its maps.
 *
 * THREE THINGS THIS SCREEN HAS TO GET RIGHT.
 *
 * 1. IT MUST NOT ASK FOR THE PROJECTION. The upload carries its own coordinate
 *    system — from a shapefile's .prj, or from the specification that fixes it —
 *    and the panel reports back what was READ rather than offering a dropdown.
 *    A planner who does not know their SRS (most of them, because their GIS has
 *    always handled it) cannot answer that question wrongly if it is not asked.
 *
 * 2. PUBLISHING MUST BE A DECISION, NOT A SIDE EFFECT. A layer arrives hidden.
 *    Turning it on puts the geometry in front of everyone holding the campaign
 *    link — no sign-in, no invitation — and the confirmation says exactly that,
 *    in the words a planner would use, before the write happens.
 *
 * 3. IT MUST DISCLOSE ITS OWN GAPS. A truncated layer says how many features it
 *    is short of, and a layer list that failed to load says so instead of
 *    rendering as "no layers yet".
 */

const LAYER_COLORS = [
  "#94a3b8", // slate — the quiet default for base context
  "#38bdf8", // sky
  "#f97316", // orange
  "#22c55e", // green
  "#a855f7", // purple
  "#eab308", // amber
] as const;

const ACCEPTED_EXTENSIONS = ".geojson,.json,.kml,.kmz,.zip";

function filenameStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim();
}

function formatLabel(format: ContextLayerSummary["source_format"]): string {
  switch (format) {
    case "geojson":
      return "GeoJSON";
    case "kml":
      return "KML";
    case "kmz":
      return "KMZ";
    case "shapefile_zip":
      return "Shapefile";
  }
}

export function EngagementContextLayersPanel({
  campaignId,
  layers,
  readFailure = null,
  canWrite,
}: {
  campaignId: string;
  layers: ContextLayerSummary[];
  /** Set when the layer list could not be read — never rendered as "none". */
  readFailure?: string | null;
  /** engagement.write in the workspace role matrix. Viewers read only. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(LAYER_COLORS[0]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [srsSummary, setSrsSummary] = useState<string | null>(null);
  const [busyLayerId, setBusyLayerId] = useState<string | null>(null);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a GeoJSON, KML, KMZ, or zipped shapefile to upload.");
      return;
    }

    setError(null);
    setSrsSummary(null);
    setIsUploading(true);

    try {
      const query = new URLSearchParams({ filename: file.name, color });
      const layerName = name.trim() || filenameStem(file.name);
      if (layerName) query.set("name", layerName);
      if (description.trim()) query.set("description", description.trim());

      const response = await fetch(
        `/api/engagement/campaigns/${campaignId}/context-layers?${query.toString()}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: await file.arrayBuffer(),
        }
      );

      const payload = (await response.json()) as { error?: string; srsSummary?: string };
      if (!response.ok) {
        // The route's refusal is shown verbatim: it already names the real
        // cause (a projected .prj, a missing .prj, an operator byte cap) and
        // what to do about it. Replacing it with a generic sentence here would
        // throw that away.
        throw new Error(payload.error || "The map layer could not be added.");
      }

      setSrsSummary(payload.srsSummary ?? null);
      setFile(null);
      setName("");
      setDescription("");
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The map layer could not be added.");
    } finally {
      setIsUploading(false);
    }
  }

  async function patchLayer(layer: ContextLayerSummary, patch: Record<string, unknown>) {
    setError(null);
    setBusyLayerId(layer.id);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/context-layers/${layer.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.error || payload.details || "The map layer could not be updated.");
      }
      router.refresh();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "The map layer could not be updated.");
    } finally {
      setBusyLayerId(null);
    }
  }

  async function removeLayer(layer: ContextLayerSummary) {
    const confirmed = await confirm({
      headline: `Remove “${layer.name}” from this campaign's maps?`,
      consequence: "This cannot be undone.",
      confirmLabel: "Remove this layer",
    });
    if (!confirmed) return;
    setError(null);
    setBusyLayerId(layer.id);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/context-layers/${layer.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.error || payload.details || "The map layer could not be removed.");
      }
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The map layer could not be removed.");
    } finally {
      setBusyLayerId(null);
    }
  }

  /**
   * Move a layer up or down the draw order.
   *
   * Layers are drawn in `sort_order` and then upload time, and later layers draw
   * ON TOP. That matters concretely: a parcel fill uploaded after an alignment
   * would otherwise cover the line the campaign is actually about, and an
   * operator with no control over the order could not fix it.
   *
   * The whole list is renumbered to its array positions rather than the two
   * neighbours being swapped, because every layer starts at sort_order 0 — a
   * swap between two zeroes changes nothing at all.
   */
  async function reorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= layers.length) return;

    const next = [...layers];
    [next[index], next[target]] = [next[target], next[index]];

    setError(null);
    setBusyLayerId(layers[index].id);
    try {
      for (const [position, item] of next.entries()) {
        if (item.sort_order === position) continue;
        const response = await fetch(`/api/engagement/campaigns/${campaignId}/context-layers/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sortOrder: position }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string; details?: string };
          throw new Error(payload.error || payload.details || "The draw order could not be changed.");
        }
      }
      router.refresh();
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "The draw order could not be changed.");
    } finally {
      setBusyLayerId(null);
    }
  }

  async function toggleVisibility(layer: ContextLayerSummary) {
    if (!layer.visible_to_participants) {
      // The warning text is the shared one, word for word. Publishing a layer
      // deletes nothing, so it is a caution rather than a destruction — but it
      // is still asked, because it is the step that puts geometry in public.
      const confirmed = await confirm({
        headline: `Show “${layer.name}” to participants?`,
        consequence: contextLayerPublicationWarning(layer.name),
        confirmLabel: "Show it to participants",
        cancelLabel: "Keep it hidden",
        tone: "caution",
      });
      if (!confirmed) return;
    }
    void patchLayer(layer, { visibleToParticipants: !layer.visible_to_participants });
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Map layers</p>
          <h2 className="module-section-title">Put your project on the map</h2>
          <p className="module-section-description">
            Upload the alignment, the parcels, the existing network — anything a resident needs to see before
            they can tell you something useful. OpenPlan reads the coordinate system from the file itself, so
            there is no projection to choose. Layers arrive hidden; you decide which ones participants see.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Layers className="h-5 w-5" />
        </span>
      </div>

      {readFailure ? (
        <p className="mt-4 rounded-[0.5rem] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          This campaign&rsquo;s map layers could not be read, so none are listed below. That is not a finding
          that there are none. ({readFailure})
        </p>
      ) : null}

      {canWrite ? (
        <Form className="mt-5" onSubmit={handleUpload}>
          <FormField>
            <FormLabel htmlFor="context-layer-file">Layer file</FormLabel>
            <Input
              id="context-layer-file"
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                setError(null);
                setSrsSummary(null);
                if (chosen && !name.trim()) setName(filenameStem(chosen.name));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              GeoJSON (.geojson/.json), KML, KMZ, or a zipped shapefile — the whole shapefile, including its
              .prj, in one .zip. A shapefile in a projected coordinate system is refused rather than
              reprojected on a guess.
            </p>
          </FormField>

          <FormField>
            <FormLabel htmlFor="context-layer-name">Legend name</FormLabel>
            <Input
              id="context-layer-name"
              placeholder="Proposed alignment"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              This is what participants read in the map legend. An unlabelled line tells them nothing.
            </p>
          </FormField>

          <FormField>
            <FormLabel htmlFor="context-layer-description" optional>
              Legend note
            </FormLabel>
            <Textarea
              id="context-layer-description"
              rows={2}
              placeholder="Centreline as designed at 30% plans"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Shown under the layer name in the participant legend. Say what the geometry is and how firm it is.
            </p>
          </FormField>

          <FormField>
            <FormLabel htmlFor="context-layer-color">Map color</FormLabel>
            <div id="context-layer-color" className="flex flex-wrap gap-2">
              {LAYER_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Use color ${swatch}`}
                  aria-pressed={color === swatch}
                  onClick={() => setColor(swatch)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    color === swatch ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </FormField>

          {error ? <FormError>{error}</FormError> : null}
          {srsSummary ? (
            <p className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {srsSummary}
            </p>
          ) : null}

          <FormActions>
            <Button type="submit" disabled={isUploading || !file}>
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add layer
            </Button>
          </FormActions>
        </Form>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Your workspace role can view this campaign&rsquo;s map layers but not change them.
        </p>
      )}

      {layers.length === 0 && !readFailure ? (
        <p className="mt-5 text-sm text-muted-foreground">
          No map layers yet. Participants see the basemap and their own input only.
        </p>
      ) : (
        <ul role="list" className="mt-5 space-y-3">
          {layers.map((layer, index) => {
            const coverage = describeContextLayerCoverage(layer.name, contextLayerDisclosure(layer));
            return (
              <li key={layer.id} className="rounded-[0.5rem] border border-border/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: layer.display_color }}
                      />
                      {layer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatLabel(layer.source_format)} · {layer.feature_count.toLocaleString()} shape
                      {layer.feature_count === 1 ? "" : "s"} drawn · {layer.source_filename}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {describeContextLayerSrs({
                        authority: layer.srs_authority,
                        code: layer.srs_code,
                        name: layer.srs_name,
                        basis: layer.srs_basis,
                      })}
                    </p>
                    {coverage.map((note) => (
                      <p key={note} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        {note}
                      </p>
                    ))}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        layer.visible_to_participants
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {layer.visible_to_participants ? "Public" : "Hidden"}
                    </span>
                    {canWrite ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Draw ${layer.name} earlier`}
                          disabled={busyLayerId !== null || index === 0}
                          onClick={() => void reorder(index, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Draw ${layer.name} later`}
                          disabled={busyLayerId !== null || index === layers.length - 1}
                          onClick={() => void reorder(index, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busyLayerId === layer.id}
                          onClick={() => void toggleVisibility(layer)}
                        >
                          {layer.visible_to_participants ? "Hide from participants" : "Show to participants"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${layer.name}`}
                          disabled={busyLayerId === layer.id}
                          onClick={() => void removeLayer(layer)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                {layer.visible_to_participants ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Visible to anyone with this campaign&rsquo;s public link.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </article>
  );
}
