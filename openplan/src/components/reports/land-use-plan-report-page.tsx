import { LandUsePlanReportDetail } from "@/components/reports/land-use-plan-report-detail";
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
    return <main className="mx-auto max-w-3xl p-8"><h1 className="text-3xl font-semibold">This plan report could not be loaded</h1><p className="mt-4">The linked plan or frozen report file is missing or unreadable. OpenPlan did not substitute an empty report.</p></main>;
  }
  return <LandUsePlanReportDetail report={report} plan={planResult.data} artifact={artifactsResult.data} />;
}
