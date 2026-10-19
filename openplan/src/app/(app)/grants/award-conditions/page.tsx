import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";
import { AwardConditionHandoff } from "@/components/grants/award-condition-handoff";
import { HANDOFF_AWARD_SELECT } from "@/lib/grants/award-handoff";

export default async function AwardConditionsPage({ searchParams }: { searchParams: Promise<{ opportunityId?: string; awardId?: string }> }) {
  const params = await searchParams; const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return <p>Sign in to review award conditions.</p>;
  let opportunityId = params.opportunityId;
  if (!opportunityId && params.awardId) {
    const award = await client.from("funding_awards").select("id, funding_opportunity_id").eq("id", params.awardId).maybeSingle();
    opportunityId = award.data?.funding_opportunity_id ?? undefined;
  }
  if (!opportunityId) return <main className="module-page"><Link href="/grants">Back to Grants</Link><h1>Record award conditions</h1><p>Select the linked grant opportunity first. An unlinked award needs an explicit matching opportunity.</p></main>;
  const opportunity = await client.from("funding_opportunities").select("id, workspace_id, project_id, program_id, title, pursuit_kind, expected_award_amount").eq("id", opportunityId).maybeSingle();
  const o = opportunity.data;
  if (!o || opportunity.error || o.pursuit_kind !== "grant" || !o.project_id) return <p>Select a grant linked to a project. <Link href="/grants">Return to Grants</Link></p>;
  const awards = await client.from("funding_awards").select(HANDOFF_AWARD_SELECT, { count: "exact" }).eq("workspace_id", o.workspace_id).eq("project_id", o.project_id).order("created_at");
  if (awards.error || awards.count !== awards.data?.length) return <p>Award conditions are unavailable. Apply the award-handoff migration and retry. No handoff was recorded.</p>;
  const available = awards.data.filter((a) => !a.funding_opportunity_id || a.funding_opportunity_id === o.id);
  return <main className="module-page space-y-6">
    <Link href="/grants?tab=awards">Back to Grants</Link>
    <header><h1 className="text-2xl font-semibold">Record award conditions</h1><p>{o.title}</p><p className="text-sm text-muted-foreground">Select the specific award. Review the application beside actual notice terms. Issuance, recipient acceptance and spending authorization remain separate.</p></header>
    {available.map((a) => <AwardConditionHandoff key={a.id} awardId={a.id} opportunityId={o.id} title={a.title} initiallyOpen={a.id === params.awardId} />)}
    {!available.length ? <p>No matching award exists yet. Record it below, then select the returned award here.</p> : null}
    <ProjectFundingAwardCreator projectId={o.project_id} opportunityOptions={[{ id: o.id, title: o.title }]} defaultOpportunityId={o.id} defaultProgramId={o.program_id} titleLabel="Record another award" description="Multiple awards may fund the same opportunity and project. The creator remains separate from source-confirmed conditions." />
  </main>;
}
