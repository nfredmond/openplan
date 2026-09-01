import { Download, Map as MapIcon } from "lucide-react";
import { ProjectMapPresence } from "@/components/projects/project-map-presence";
import { Button } from "@/components/ui/button";
import type { ProjectCorridor } from "@/lib/cartographic/project-corridor-record";
import { projectGeoPackageCoreInventory } from "@/lib/projects/project-geopackage";

/**
 * The project's presence on the cartographic backdrop: its marker and its study
 * corridors.
 *
 * Both were read-only for the life of the product — the columns existed and the
 * backdrop drew them, but the only writer was a demo seed. See
 * `src/components/projects/project-map-presence.tsx`.
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

  return (
    <article id="project-map-presence" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <MapIcon className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Cartographic backdrop</p>
            <h2 className="module-section-title">Where this project is</h2>
            <p className="module-section-description">
              Put the project on the map and add its corridors — draw them here, or upload the map
              files you already have. Everything set here appears on the workspace map, and in the
              layer counts beside it.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-4 py-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Take the stored project area, site marker, and corridors into QGIS or another GIS. The
          package includes an EPSG:4326 manifest that names any missing or invalid map shapes. Linked
          datasets, documents, and analysis evidence are not included yet.
        </p>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/projects/${projectId}/export/geopackage`} download>
            <Download aria-hidden="true" />
            Download GeoPackage
          </a>
        </Button>
      </div>

      <div className="mt-3 rounded-lg border border-border/70 bg-background px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Layers in this package</h3>
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

      {corridorsPending ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The project corridors table is not available on this deployment yet, so corridors cannot be
          listed or drawn. Apply the pending migrations to enable them.
        </p>
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
