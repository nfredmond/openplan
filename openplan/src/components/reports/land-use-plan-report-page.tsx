import { LandUsePlanReportDetail } from "@/components/reports/land-use-plan-report-detail";
import { LandUsePlanReportAdoption } from "@/components/reports/land-use-plan-report-adoption";
import { LandUsePlanPublicContext } from "@/components/land-use-plans/land-use-plan-public-context";
import { readFrozenPlanIdentity } from "@/lib/land-use-plans/frozen-identity";
import { createClient } from "@/lib/supabase/server";

type Report = {
  id: string;
  land_use_plan_id?: string | null;
  title: string;
  report_type: string;
  summary: string | null;
  generated_at: string | null;
};

export async function LandUsePlanReportPage({ report }: { report: Report }) {
  if (!report.land_use_plan_id) return null;
  const supabase = await createClient();
  const [planResult, artifactsResult] = await Promise.all([
    supabase.from("land_use_plans").select("id, title, authority_label, geography_label").eq("id", report.land_use_plan_id).maybeSingle(),
    supabase.from("report_artifacts").select("id, generated_at, metadata_json").eq("report_id", report.id).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (planResult.error || artifactsResult.error || !planResult.data || !artifactsResult.data) {
    return <div className="mx-auto max-w-3xl p-8"><h1 className="text-3xl font-semibold">This plan report could not be loaded</h1><p className="mt-4">The linked plan or frozen report file is missing or unreadable. OpenPlan did not substitute an empty report.</p></div>;
  }
  if (report.report_type === "land_use_plan_implementation_report") {
    return <LandUsePlanReportDetail report={report} plan={planResult.data} artifact={artifactsResult.data} />;
  }

  const artifact = artifactsResult.data;
  const metadata = artifact.metadata_json && typeof artifact.metadata_json === "object" && !Array.isArray(artifact.metadata_json)
    ? artifact.metadata_json as Record<string, unknown> : {};
  const frozen = metadata.frozenSnapshot && typeof metadata.frozenSnapshot === "object" && !Array.isArray(metadata.frozenSnapshot)
    ? metadata.frozenSnapshot as Record<string, unknown> : null;
  const versionId = typeof metadata.versionId === "string" ? metadata.versionId : null;
  // Bind this artifact to its recorded version, including superseded historical editions.
  const versionResult = versionId ? await supabase.from("land_use_plan_versions")
    .select("id, plan_id, version_number, state, content_hash, published_report_id")
    .eq("id", versionId).eq("plan_id", report.land_use_plan_id).maybeSingle() : null;
  const version = versionResult?.data;
  const identity = report.report_type === "land_use_plan_packet" && metadata.kind !== "land_use_plan_implementation_report"
    && metadata.landUsePlanId === report.land_use_plan_id && frozen && !versionResult?.error
    && version && version.id === versionId && version.plan_id === report.land_use_plan_id
    && ["adopted", "superseded", "repealed"].includes(version.state)
    && version.published_report_id === report.id && metadata.contentHash === version.content_hash && version.content_hash
    ? readFrozenPlanIdentity(frozen, report.land_use_plan_id, version.id, version.version_number, version.content_hash) : null;
  if (!identity || !frozen || !version) {
    return <div className="mx-auto max-w-3xl p-8"><h1 className="text-3xl font-semibold">This plan report could not be verified</h1><p role="alert" className="mt-4">The saved report does not match its recorded plan version. OpenPlan withheld the report content. This does not mean the agency withdrew the plan.</p></div>;
  }
  return <LandUsePlanReportDetail report={report}
    plan={{ id: identity.id, title: identity.title, authority_label: identity.authorityLabel, geography_label: identity.geographyLabel }}
    artifact={artifact} retainedContext={<LandUsePlanPublicContext snapshot={frozen} />}
    retainedAdoption={await LandUsePlanReportAdoption({ supabase, metadata, planId: identity.id, versionId: version.id, contentHash: version.content_hash })} />;
}
