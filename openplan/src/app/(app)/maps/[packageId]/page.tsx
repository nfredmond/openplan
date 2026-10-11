import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { MapPackageView, type MapPackageViewFile, type MapPackageViewRecord } from "@/components/map-packages/map-package-view";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/state-block";
import { buildFocusedOpportunityCardHref } from "@/lib/grants/page-helpers";
import { MAP_PACKAGE_DELIVERABLE_LABELS, type MapPackageDeliverable } from "@/lib/map-packages/catalog";
import { createClient } from "@/lib/supabase/server";

/** One map package: its progress, figures, QA, review gates and download. */
export default async function MapPackagePage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  if (!z.string().uuid().safeParse(packageId).success) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/maps/${packageId}`);

  const packageRead = await supabase.from("project_map_packages")
    .select("id, request_id, workspace_id, project_id, requested_by, title, source, deliverable, funding_opportunity_id, connection_id, provider, auth_mode, model_id, effort, brief_hash, skill_tree_hash, state, attempt_id, lease_expires_at, last_heartbeat_at, progress, receipt, failure_code, upload_file_name, created_at, started_at, finished_at, brief_client:brief->>client, brief_request:brief->>request, project:projects(id, name), funding_opportunity:funding_opportunities(id, title)")
    .eq("id", packageId).maybeSingle();
  if (packageRead.error) {
    return <ErrorState title="This map package could not be read" description="The record did not load. Nothing was changed. Try again." />;
  }
  if (!packageRead.data) notFound();
  const filesRead = await supabase.from("project_map_package_files").select("name, role, bytes, verified_at").eq("package_id", packageId).order("name");
  const row = packageRead.data as unknown as MapPackageViewRecord & {
    deliverable: string;
    brief_client: string | null;
    brief_request: string | null;
    project: { id: string; name: string | null } | null;
    funding_opportunity: { id: string; title: string } | null;
  };

  return (
    <section className="module-page space-y-6" aria-label="Map package">
      <PageHeader
        title={row.title}
        description={
          <>
            {row.project ? <Link href={`/projects/${row.project.id}`} className="underline underline-offset-2">{row.project.name}</Link> : null}
            {" · "}{MAP_PACKAGE_DELIVERABLE_LABELS[row.deliverable as MapPackageDeliverable] ?? row.deliverable}
            {row.funding_opportunity ? <> · <Link href={buildFocusedOpportunityCardHref(row.funding_opportunity.id)} className="underline underline-offset-2">{row.funding_opportunity.title}</Link></> : null}
            {row.brief_client ? ` · For ${row.brief_client}` : null}
          </>
        }
      />
      {filesRead.error ? <ErrorState compact title="The file list could not be read" description="Downloads are unavailable until it loads." /> : null}
      <MapPackageView initial={row} initialFiles={(filesRead.data ?? []) as MapPackageViewFile[]} />
      {row.brief_request ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">What was asked</summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{row.brief_request}</p>
        </details>
      ) : null}
    </section>
  );
}
