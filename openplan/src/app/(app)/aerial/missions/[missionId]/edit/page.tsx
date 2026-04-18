import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, PlaneTakeoff } from "lucide-react";

import { MissionAoiEditor, type AoiPolygon } from "@/components/aerial/mission-aoi-editor";
import { StateBlock } from "@/components/ui/state-block";
import { Worksurface, WorksurfaceSection } from "@/components/ui/worksurface";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
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
        title="Mission AOI authoring needs a provisioned workspace"
        description="Mission authoring is workspace-scoped. Join or create a workspace to draw AOIs."
      />
    );
  }

  const workspaceId = membership.workspace_id;

  const { data: mission, error } = await supabase
    .from("aerial_missions")
    .select("id, workspace_id, title, aoi_geojson")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !mission) {
    notFound();
  }

  const initialPolygon: AoiPolygon | null = isAoiPolygonGeoJson(mission.aoi_geojson)
    ? mission.aoi_geojson
    : null;

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
          <MissionAoiEditor missionId={mission.id} initialPolygon={initialPolygon} />
          <StateBlock
            className="mt-4"
            title="Honest scope"
            description="This editor supports a single outer polygon. Multi-polygon, hole-cutting, and altitude terrain following are out of scope for this prototype."
            tone="info"
            compact
          />
        </WorksurfaceSection>
      }
    />
  );
}
