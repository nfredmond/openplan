import { LandUsePlanReportDetail } from "@/components/reports/land-use-plan-report-detail";
import { LandUsePlanReportAdoption } from "@/components/reports/land-use-plan-report-adoption";
import { LandUsePlanPublicContext } from "@/components/land-use-plans/land-use-plan-public-context";
import { loadAdoptedReportSnapshot } from "@/lib/land-use-plans/report-snapshot";
import { createClient } from "@/lib/supabase/server";

type Report = {
  id: string;
  workspace_id: string;
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
  const snapshot = await loadAdoptedReportSnapshot(supabase, report, metadata);
  if (!snapshot) {
    return <div className="mx-auto max-w-3xl p-8"><h1 className="text-3xl font-semibold">This plan report could not be verified</h1><p role="alert" className="mt-4">The saved report does not match its frozen plan version. OpenPlan withheld the report content. This does not mean the agency withdrew the plan.</p></div>;
  }
  const { identity, frozen } = snapshot;
  return <LandUsePlanReportDetail report={report}
    plan={{ id: identity.id, title: identity.title, authority_label: identity.authorityLabel, geography_label: identity.geographyLabel }}
    artifact={artifact} retainedContext={<LandUsePlanPublicContext snapshot={frozen} />}
    retainedAdoption={await LandUsePlanReportAdoption({ supabase, metadata, planId: identity.id, versionId: snapshot.versionId, contentHash: snapshot.contentHash })} />;
}
