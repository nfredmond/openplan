import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";
import { HOME_GEOGRAPHY_COLUMNS, parseWorkspaceHomeGeography } from "@/lib/workspaces/home-geography";
import { studyAreaPrefillFromHomeGeography } from "@/lib/models/study-area";

export default async function CountyRunsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/county-runs");
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

  // The workspace already stated where it works. Resolving it here — on the
  // server, where the row is already in reach — is what stops this page asking
  // a planner to be the FIPS lookup table for their own county.
  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select(HOME_GEOGRAPHY_COLUMNS)
    .eq("id", membership.workspace_id)
    .maybeSingle();

  const homeGeography = parseWorkspaceHomeGeography(workspaceRow);
  const prefill = studyAreaPrefillFromHomeGeography(homeGeography);

  return (
    <CountyRunsPageClient
      workspaceId={membership.workspace_id}
      initialStudyArea={{
        corridorText: prefill.corridorText,
        place: prefill.place,
        label: prefill.label,
      }}
    />
  );
}
