import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";

export default async function CountyRunDetailPage({ params }: { params: Promise<{ countyRunId: string }> }) {
  const { countyRunId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/signin?next=/county-runs/${countyRunId}`);
  }

  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1);

  if (error) {
    throw new Error(error.message || "Failed to load workspace membership");
  }

  const workspaceId = memberships?.[0]?.workspace_id;

  if (!workspaceId) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="County onboarding"
        title="County run detail needs a provisioned workspace"
        description="County run details are workspace-scoped. Create or join a workspace before reviewing county onboarding outputs."
      />
    );
  }

  return <CountyRunDetailClient countyRunId={countyRunId} />;
}
