import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";
import { buildCountyRunDetailHref, getSafeCountyRunsBackHref } from "@/lib/ui/county-runs-navigation";

export default async function CountyRunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ countyRunId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { countyRunId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedBackTo = typeof resolvedSearchParams.backTo === "string" ? resolvedSearchParams.backTo : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/signin?next=${encodeURIComponent(
        buildCountyRunDetailHref(countyRunId, getSafeCountyRunsBackHref(requestedBackTo))
      )}`
    );
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
