import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
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

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership?.workspace_id) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="County onboarding"
        title="County onboarding needs a provisioned workspace"
        description="County runs are workspace-scoped. Create or join a workspace before launching and reviewing county onboarding jobs."
      />
    );
  }

  return <CountyRunsPageClient workspaceId={membership.workspace_id} />;
}
