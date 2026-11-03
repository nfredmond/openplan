import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";
import { CountyRunCeqaVmtScreen } from "@/components/county-runs/county-run-ceqa-vmt-screen";
import { loadBehavioralOnrampKpisForWorkspace } from "@/lib/models/behavioral-onramp-kpis";
import { countyRunShowsCeqaScreen, type CountyRunGeography } from "@/lib/models/county-run-vmt-framework";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { CountyRunBehavioralKpisSection } from "./_components/county-run-behavioral-kpis";
import { isUuid } from "@/lib/uuid";
import { isCountyOnrampWorkerConfigured } from "@/lib/config/deployment-health-facts";

type CountyRunDetailPageProps = {
  params: Promise<{ countyRunId: string }>;
  searchParams?: Promise<{ includeScreening?: string }>;
};

export default async function CountyRunDetailPage({ params, searchParams }: CountyRunDetailPageProps) {
  const { countyRunId } = await params;
  if (!isUuid(countyRunId)) notFound();
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
        title="County run detail needs a workspace"
        description="A county run's outputs belong to the workspace that produced them. You are signed in, but this account is not in a workspace yet, so there is nothing here to review."
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

  // The row gives the run's name and its county. A failed read is disclosed
  // below as unreadable, never as a run with no name. The county decides
  // whether the CEQA screen applies, so an unread row shows no CEQA screen.
  const countyRunResult = await supabase
    .from("county_runs")
    .select("id, run_name, geography_type, geography_id")
    .eq("id", countyRunId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  const reads = new ReadFailureLog();
  reads.check("this county run's record", countyRunResult);
  const countyRun = countyRunResult.data as
    | ({ id: string; run_name: string | null } & CountyRunGeography)
    | null;
  const runName = countyRun?.run_name ?? null;
  // CEQA is California law. Outside California this page shows no CEQA screen.
  const showsCeqaScreen = countyRunShowsCeqaScreen(countyRun);

  const kpisForThisRun = kpiResult.kpis.filter((kpi) => kpi.county_run_id === countyRunId);

  return (
    <>
      <CountyRunDetailClient
        countyRunId={countyRunId}
        countyOnrampWorkerConfigured={isCountyOnrampWorkerConfigured()}
      />
      {reads.any ? (
        // Internal page, so the database's own message is shown — the reader
        // here is the person who can act on it.
        <section className="module-page pb-0 pt-0">
          <div
            className="rounded-[0.75rem] border border-destructive/40 bg-destructive/5 px-5 py-4 text-sm text-foreground"
            data-testid="county-run-read-failures"
            role="alert"
          >
            <p>{reads.describe()}</p>
            <p className="mt-1.5 text-label text-muted-foreground">{reads.messages().join(" · ")}</p>
          </div>
        </section>
      ) : null}
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
      {showsCeqaScreen ? (
        <section className="module-page pb-10 pt-0">
          <CountyRunCeqaVmtScreen
            countyRunId={countyRunId}
            runName={runName}
            kpis={kpisForThisRun}
            heldBackByScreeningGate={isThisRunRejected && !acceptingScreeningGrade}
            includeScreeningHref={`${basePathname}?includeScreening=1`}
            kpiReadError={kpiResult.error?.message ?? null}
          />
        </section>
      ) : null}
    </>
  );
}
