import Link from "next/link";
import { Download, Map as MapIcon } from "lucide-react";
import { SetupPendingNotice } from "@/components/ui/setup-pending-notice";
import { ProjectMapPresence } from "@/components/projects/project-map-presence";
import { ProjectSavedMap } from "@/components/projects/project-saved-map";
import { Button } from "@/components/ui/button";
import type { ProjectCorridor } from "@/lib/cartographic/project-corridor-record";
import { projectGeoPackageCoreInventory } from "@/lib/projects/project-geopackage";
import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";

/**
 * Saved project geography and its editors. The project page owns this map;
 * ordinary project routes do not mount the workspace cartographic backdrop.
 */
export function ProjectMapPresencePanel({
  projectId,
  projectAreaGeometry,
  latitude,
  longitude,
  corridors,
  corridorsPending,
  homeCenter,
  homeZoom,
  canWrite,
}: {
  projectId: string;
  projectAreaGeometry: unknown;
  latitude: number | null;
  longitude: number | null;
  corridors: ProjectCorridor[];
  /** True when the corridors table is not present on this deployment yet. */
  corridorsPending: boolean;
  homeCenter?: [number, number];
  homeZoom?: number;
  canWrite: boolean;
}) {
  const packageInventory = projectGeoPackageCoreInventory({
    projectAreaGeometry,
    latitude,
    longitude,
    corridors,
  });
  const featureNoun = packageInventory.featureCount === 1 ? "feature" : "features";
  const rejectedNoun = packageInventory.rejectedFeatureCount === 1 ? "shape" : "shapes";
  const savedFeatures: GeoJSON.Feature[] = [];
  // The export inventory validates the complete geometry before it reaches
  // this map. Unwrap a Feature without changing rings, vertices or precision.
  if (packageInventory.layers[0].featureCount > 0) {
    let area = projectAreaGeometry as GeoJSON.Geometry | GeoJSON.Feature;
    while (area.type === "Feature") area = area.geometry;
    savedFeatures.push({ type: "Feature", geometry: area, properties: { layer: "project_area" } });
  }
  if (packageInventory.layers[1].featureCount > 0) {
    savedFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [longitude!, latitude!] }, properties: { layer: "project_location" } });
  }
  for (const corridor of corridors) {
    if (!isCorridorLineGeoJson(corridor.geometry)) continue;
    savedFeatures.push({ type: "Feature", id: corridor.id, geometry: corridor.geometry, properties: { layer: "project_corridors", name: corridor.name } });
  }

  return (
    <article id="project-map-presence" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <MapIcon className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <h2 className="module-section-title">Where this project is</h2>
            <p className="module-section-description">
              Review the saved project boundary, site marker and corridors together. Draw or upload a
              location or corridor below. Save changes to include them on this map and in exports.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-4 py-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Take the stored project area, site marker, and corridors into QGIS or another GIS. The
          package includes an EPSG:4326 manifest that names any missing or invalid map shapes. Linked
          datasets, documents, and analysis evidence are not included yet.
          {" "}Approved public engagement locations from every linked outreach effort are included automatically;
          private notes and pending comments are excluded. Inspect the downloaded layer summary for their counts.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/projects/${projectId}/export/geopackage`} download>
              <Download aria-hidden="true" />
              Download GeoPackage
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/maps?projectId=${projectId}`}>Map packages</Link>
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border/70 bg-background px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Core project layers</h3>
        <p className="mt-1 text-xs text-muted-foreground">Coordinate reference system: {packageInventory.crs} (WGS 84 longitude/latitude)</p>
        <ul className="mt-2 space-y-1 text-sm text-foreground">
          {packageInventory.layers.map((layer) => {
            const layerFeatureNoun = layer.featureCount === 1 ? "feature" : "features";
            return (
              <li key={layer.layerKey}>
                {layer.layerKey} · {layer.geometryType} · {layer.featureCount} {layerFeatureNoun} included
                {layer.status === "unavailable" ? " (unavailable)" : ""}
                {layer.rejectedFeatureCount > 0
                  ? ` · ${layer.rejectedFeatureCount} rejected ${layer.rejectedFeatureCount === 1 ? "shape" : "shapes"}`
                  : ""}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-sm font-medium text-foreground">
          {packageInventory.layers.length} core layers · {packageInventory.featureCount} {featureNoun} included · {packageInventory.unavailableLayerCount} unavailable · {packageInventory.rejectedFeatureCount} rejected {rejectedNoun}
        </p>
      </div>

      <div className="mt-4">
        <ProjectSavedMap collection={{ type: "FeatureCollection", features: savedFeatures }} />
      </div>

      {corridorsPending ? (
        <SetupPendingNotice className="mt-3" consequence="Project corridors cannot be listed or drawn.">
          The project corridors table is not available on this deployment yet. Apply the pending
          migrations to enable it.
        </SetupPendingNotice>
      ) : (
        <div className="mt-4">
          <ProjectMapPresence
            projectId={projectId}
            initialLatitude={latitude}
            initialLongitude={longitude}
            initialCorridors={corridors}
            {...(homeCenter ? { initialCenter: homeCenter } : {})}
            {...(homeZoom !== undefined ? { initialZoom: homeZoom } : {})}
            canWrite={canWrite}
          />
        </div>
      )}
    </article>
  );
}
