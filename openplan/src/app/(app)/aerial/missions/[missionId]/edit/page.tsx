import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, PlaneTakeoff } from "lucide-react";

import { MissionAoiEditor, type AoiPolygon } from "@/components/aerial/mission-aoi-editor";
import { StateBlock } from "@/components/ui/state-block";
import { Worksurface, WorksurfaceSection } from "@/components/ui/worksurface";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { buildMissionAoiSeedSources, type AoiSeedSource } from "@/lib/aerial/aoi-seed";
import { isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type EditMissionAoiPageProps = {
  params: Promise<{ missionId: string }>;
};

export default async function EditMissionAoiPage({ params }: EditMissionAoiPageProps) {
  const { missionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?next=/aerial/missions/${missionId}/edit`);
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership?.workspace_id) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Aerial operations"
        title="Mission AOI authoring needs a workspace"
        description="A mission's area of interest is drawn inside the workspace that owns the mission. You are signed in, but this account is not in a workspace yet."
      />
    );
  }

  const workspaceId = membership.workspace_id;

  const { data: mission, error } = await supabase
    .from("aerial_missions")
    .select("id, workspace_id, project_id, title, aoi_geojson")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !mission) {
    notFound();
  }

  const initialPolygon: AoiPolygon | null = isAoiPolygonGeoJson(mission.aoi_geojson)
    ? mission.aoi_geojson
    : null;

  // Geometry the mission's project already holds, offered as AOI starting
  // shapes. A mission with no project — or a project with no recorded
  // geometry — gets an empty list, and the editor renders no seed affordance.
  // A FAILED lookup is not the same as "no geometry": the editor stays fully
  // usable for hand drawing, but the page says the shapes could not be loaded
  // instead of silently offering none.
  let seedSources: AoiSeedSource[] = [];
  let seedLoadFailed = false;
  if (mission.project_id) {
    const [projectResult, corridorsResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, place_label, place_geometry_geojson")
        .eq("id", mission.project_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("project_corridors")
        .select("id, name, geometry_geojson")
        .eq("project_id", mission.project_id)
        .eq("workspace_id", workspaceId)
        .order("name"),
    ]);

    seedLoadFailed = Boolean(projectResult.error || corridorsResult.error);
    const project = projectResult.data;
    const corridors = corridorsResult.data;

    seedSources = buildMissionAoiSeedSources({
      projectLabel: project?.place_label ?? project?.name ?? null,
      placeGeometryGeojson: project?.place_geometry_geojson ?? null,
      corridors: (corridors ?? []) as { id: string; name: string; geometry_geojson: unknown }[],
    });
  }

  const header = (
    <div className="flex flex-col gap-3">
      <Link
        href={`/aerial/missions/${mission.id}`}
        className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to mission
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
          <PlaneTakeoff className="h-3 w-3" />
          Mission AOI
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Draw AOI — {mission.title}</h1>
        <p className="text-sm text-muted-foreground">
          Click to add polygon vertices. Double-click to close. Right-click removes the last vertex.
          Save writes the polygon back to the mission so it can be exported as a DJI waypoint file.
        </p>
      </div>
    </div>
  );

  return (
    <Worksurface
      ariaLabel={`Edit AOI for aerial mission ${mission.title}`}
      header={header}
      worksurface={
        <WorksurfaceSection
          id="aerial-mission-aoi-editor"
          label="Authoring"
          title="AOI polygon"
          description="Geometry stored as GeoJSON. Exports convert the outer ring to DJI waypoints."
        >
          {seedLoadFailed ? (
            <StateBlock
              className="mb-4"
              title="Project shapes could not be loaded"
              description="This mission's project may have saved boundary or corridor shapes, but they could not be read just now, so no starting shapes are offered. Drawing and saving the AOI by hand still works — reload the page to try again."
              tone="warning"
              compact
            />
          ) : null}
          <MissionAoiEditor
            missionId={mission.id}
            initialPolygon={initialPolygon}
            seedSources={seedSources}
          />
          <StateBlock
            className="mt-4"
            title="Editor scope"
            description="This editor supports a single outer polygon. Multi-polygon boundaries, hole cutting, and terrain-following altitude ship in a future release."
            tone="info"
            compact
          />
        </WorksurfaceSection>
      }
    />
  );
}
