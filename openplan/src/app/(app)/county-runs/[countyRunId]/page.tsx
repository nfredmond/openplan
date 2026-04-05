import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";

export default async function CountyRunDetailPage({ params }: { params: Promise<{ countyRunId: string }> }) {
  const { countyRunId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?next=/county-runs/${countyRunId}`);
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership?.workspace_id) {
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
