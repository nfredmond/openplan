import { LandUsePlanWorkbench } from "@/components/land-use-plans/land-use-plan-workbench";
import { notFound } from "next/navigation";
import { moduleMetadata } from "@/lib/ui/page-title";
import { isUuid } from "@/lib/uuid";
import { createClient } from "@/lib/supabase/server";
import { recordRowIsAbsent } from "@/lib/routing/record-not-found";

export const metadata = moduleMetadata("Land Use Plan");

export default async function LandUsePlanPage({ params, searchParams }: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ versionId?: string | string[] }>;
}) {
  const { planId } = await params;
  if (!isUuid(planId)) notFound();
  // The workbench loads the plan in the browser, so without this read the page
  // answered 200 for a plan the reader cannot see (KI-2026-11-14-280). Row
  // security decides: another workspace's plan reads as no row. A failed read
  // renders the workbench, which says the plan could not be loaded.
  const supabase = await createClient();
  const planRead = await supabase.from("land_use_plans").select("id").eq("id", planId).maybeSingle();
  if (recordRowIsAbsent(planRead)) notFound();
  const { versionId } = await searchParams;
  if (Array.isArray(versionId)) return <p role="alert" className="p-8">Choose one plan version to open.</p>;
  return <div className="mx-auto w-full max-w-7xl p-4 md:p-8"><LandUsePlanWorkbench key={`${planId}:${versionId ?? "current"}`} planId={planId} versionId={versionId} /></div>;
}
