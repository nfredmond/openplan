import Link from "next/link";
import { redirect } from "next/navigation";

import { LandUsePlanCreator } from "@/components/land-use-plans/land-use-plan-creator";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  getJurisdictionPlanDescriptor,
  recommendJurisdictionPlanDescriptor,
} from "@/lib/land-use-plans/registry";
import { createClient } from "@/lib/supabase/server";
import { moduleMetadata } from "@/lib/ui/page-title";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  HOME_JURISDICTION_COLUMNS,
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
} from "@/lib/workspaces/home-geography";

export const metadata = moduleMetadata("Land Use Plans");

export default async function LandUsePlansPage() {
  const supabase = await createClient();
  const authResult = await supabase.auth.getUser();
  const auth = authResult.data;
  if (!auth.user) redirect("/sign-in");
  const { membership } = await loadCurrentWorkspaceMembership(supabase, auth.user.id);
  if (!membership) return <WorkspaceMembershipRequired moduleLabel="Land Use Plans" title="Land use plans need a team" description="Drafts, evidence, review, adoption, and implementation history belong to an agency team." />;
  const [plansResult, jurisdictionResult] = await Promise.all([
    supabase.from("land_use_plans")
      .select("id, title, descriptor_id, plan_kind_key, authority_label, geography_label, current_working_version_id, current_adopted_version_id, updated_at, land_use_plan_versions!land_use_plan_versions_plan_id_workspace_id_fkey(id, version_number, state, content_hash)")
      .eq("workspace_id", membership.workspace_id).order("updated_at", { ascending: false }),
    supabase.from("workspaces")
      .select(HOME_JURISDICTION_COLUMNS)
      .eq("id", membership.workspace_id)
      .maybeSingle(),
  ]);
  const reads = new ReadFailureLog();
  const unreadable = reads.check("land use plans", plansResult);
  const jurisdictionUnreadable = reads.check(
    "this workspace's home jurisdiction",
    jurisdictionResult
  );
  const plans = plansResult.data;
  const recommendation = recommendJurisdictionPlanDescriptor(
    jurisdictionUnreadable
      ? null
      : resolveJurisdiction(parseWorkspaceHomeGeography(jurisdictionResult.data))
  );

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Plans and programming</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Land Use Plans</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Author a plan, freeze what the public reviewed, save the exact adoption decision, publish the frozen plan, and keep implementation reporting tied to it.</p>
      </header>
      <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-100">
        OpenPlan tracks requirements and evidence. It does not certify legal sufficiency, perform environmental review, or replace counsel and qualified planning review.
      </div>
      {reads.any ? <div className="rounded-lg border border-destructive p-4 text-sm text-destructive">{reads.describe()} {reads.messages().join(" ")}</div> : null}
      {!unreadable && plans?.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => {
            const descriptor = getJurisdictionPlanDescriptor(plan.descriptor_id);
            const versions = plan.land_use_plan_versions ?? [];
            const active = versions.find((version) => version.id === plan.current_working_version_id) ?? versions.find((version) => version.id === plan.current_adopted_version_id);
            return (
              <Link key={plan.id} href={`/land-use-plans/${plan.id}`} className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50 hover:shadow-md">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{descriptor?.planKinds.find((kind) => kind.key === plan.plan_kind_key)?.label ?? plan.plan_kind_key}</p>
                <h2 className="mt-1 text-lg font-semibold">{plan.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{plan.authority_label} · {plan.geography_label}</p>
                <p className="mt-4 text-sm font-medium">{active ? `Version ${active.version_number} · ${active.state.replaceAll("_", " ")}` : "Version unavailable"}</p>
                {!descriptor?.configured ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Local legal requirements not configured</p> : null}
              </Link>
            );
          })}
        </section>
      ) : !unreadable ? <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">No land use plans yet. The setup below creates the first working version and its requirements checklist.</p> : null}
      <LandUsePlanCreator
        recommendedDescriptorId={recommendation.descriptor.id}
        recommendationKind={
          jurisdictionUnreadable ? "workspace_jurisdiction_unreadable" : recommendation.kind
        }
      />
    </main>
  );
}
