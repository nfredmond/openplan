import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";
import { loadBehavioralOnrampKpisForWorkspace } from "@/lib/models/behavioral-onramp-kpis";
import { CountyRunBehavioralKpisSection } from "./_components/county-run-behavioral-kpis";

type CountyRunDetailPageProps = {
  params: Promise<{ countyRunId: string }>;
  searchParams?: Promise<{ includeScreening?: string }>;
};

export default async function CountyRunDetailPage({ params, searchParams }: CountyRunDetailPageProps) {
  const { countyRunId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const acceptingScreeningGrade = resolvedSearchParams.includeScreening === "1";

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

  const kpiResult = await loadBehavioralOnrampKpisForWorkspace({
    supabase,
    workspaceId: membership.workspace_id,
    consent: { acceptScreeningGrade: acceptingScreeningGrade },
  });

  const isThisRunRejected = kpiResult.rejectedCountyRunIds.includes(countyRunId);
  const basePathname = `/county-runs/${countyRunId}`;

  return (
    <>
      <CountyRunDetailClient countyRunId={countyRunId} />
      <section className="module-page pb-10 pt-0">
        <CountyRunBehavioralKpisSection
          countyRunId={countyRunId}
          kpis={kpiResult.kpis}
          isThisRunRejected={isThisRunRejected}
          rejectedTotalCount={kpiResult.rejectedCountyRunIds.length}
          acceptingScreeningGrade={acceptingScreeningGrade}
          basePathname={basePathname}
          error={kpiResult.error?.message ?? null}
        />
      </section>
    </>
  );
}
