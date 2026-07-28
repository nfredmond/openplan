import { Map as MapIcon } from "lucide-react";
import { ProjectMapPresence } from "@/components/projects/project-map-presence";
import type { ProjectCorridor } from "@/lib/cartographic/project-corridor-record";

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
  latitude,
  longitude,
  corridors,
  corridorsPending,
  homeCenter,
  homeZoom,
  canWrite,
}: {
  projectId: string;
  latitude: number | null;
  longitude: number | null;
  corridors: ProjectCorridor[];
  /** True when the corridors table is not present on this deployment yet. */
  corridorsPending: boolean;
  homeCenter?: [number, number];
  homeZoom?: number;
  canWrite: boolean;
}) {
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
              Place the project marker and draw its study corridors. Everything set here appears on
              the workspace map, and in the layer counts beside it.
            </p>
          </div>
        </div>
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
