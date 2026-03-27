import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";

export default async function CountyRunsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin?next=/county-runs");
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
        title="County onboarding needs a provisioned workspace"
        description="County runs are workspace-scoped. Create or join a workspace before launching and reviewing county onboarding jobs."
      />
    );
  }

  return <CountyRunsPageClient workspaceId={workspaceId} />;
}
