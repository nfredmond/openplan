import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { createClient } from "@/lib/supabase/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BcaWorkbench } from "@/components/grants/bca-workbench/workbench";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadGuidedComparisonEvidence } from "@/lib/models/guided-comparison-evidence-server";
import { buildGuidedComparisonResults } from "@/lib/models/guided-comparison-results";
import type { BcaModelEvidence } from "@/lib/bca/workbench/model-evidence";
import { moduleMetadata } from "@/lib/ui/page-title";
import { BCA_PROJECT_PROJECTION, readBcaProjectPlace } from "@/lib/bca/workbench/project-place";
import { loadLatestBcaVersion, type BcaLatestVersionClient } from "@/lib/bca/workbench/latest-version";
import { loadBcaSafetyPlanOffers, type BcaSafetySupabaseLike } from "@/lib/safety/bca-evidence-loader";
export const metadata = moduleMetadata("Benefit-cost analysis");
export default async function BcaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // The same id check as the project page, so a project that opens there never answers 404 here first.
  if (!isUuid(projectId)) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const { data: project, error } = await supabase
    .from("projects")
    .select(BCA_PROJECT_PROJECTION)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error("Could not load the BCA project");
  if (!project) notFound();
  const membership = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", project.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error) throw new Error("Could not verify project membership");
  if (
    !membership.data ||
    !canAccessWorkspaceAction("programs.read", membership.data.role)
  )
    notFound();
  const latestSaved = await loadLatestBcaVersion(supabase as unknown as BcaLatestVersionClient, projectId);
  const reads = new ReadFailureLog();
  const sets = await supabase
    .from("scenario_sets")
    .select("id, project_id")
    .eq("project_id", projectId);
  reads.check("scenario sets", sets);
  const setIds = (sets.data ?? []).map((s) => s.id);
  const snapshots = setIds.length
    ? await supabase
        .from("scenario_comparison_snapshots")
        .select("id, scenario_set_id, label, metadata_json, status, updated_at")
        .in("scenario_set_id", setIds)
        .eq("status", "ready")
        .order("updated_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  reads.check("model comparisons", snapshots);
  const candidates = (snapshots.data ?? []).filter(
    (s) => s.metadata_json?.kind === "guided_project_comparison",
  );
  const evidence = await loadGuidedComparisonEvidence(
    supabase,
    reads,
    candidates.map((s) => s.id),
    project.workspace_id,
  );
  const models: BcaModelEvidence[] = reads.any
    ? []
    : candidates.flatMap((snapshot) =>
        buildGuidedComparisonResults({
          snapshotId: snapshot.id,
          ...evidence,
        }).map((result) => ({
          snapshotId: snapshot.id,
          scenarioSetId: snapshot.scenario_set_id,
          label: snapshot.label ?? "Saved comparison",
          updatedAt: snapshot.updated_at,
          result,
        })),
      );
  const safety = await loadBcaSafetyPlanOffers(supabase as unknown as BcaSafetySupabaseLike, {
    workspaceId: project.workspace_id,
    projectId,
  });
  return (
    <BcaWorkbench
      models={models}
      modelReadFailed={reads.any}
      safety={safety}
      projectId={projectId}
      projectName={project.name}
      projectPlace={readBcaProjectPlace(projectId, project)}
      latestSaved={latestSaved}
      userId={user.id}
      canSave={canAccessWorkspaceAction("programs.write", membership.data.role)}
    />
  );
}
