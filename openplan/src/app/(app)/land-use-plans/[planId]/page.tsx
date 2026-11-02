import { LandUsePlanWorkbench } from "@/components/land-use-plans/land-use-plan-workbench";
import { notFound } from "next/navigation";
import { moduleMetadata } from "@/lib/ui/page-title";
import { isUuid } from "@/lib/uuid";

export const metadata = moduleMetadata("Land Use Plan");

export default async function LandUsePlanPage({ params, searchParams }: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ versionId?: string | string[] }>;
}) {
  const { planId } = await params;
  if (!isUuid(planId)) notFound();
  const { versionId } = await searchParams;
  if (Array.isArray(versionId)) return <p role="alert" className="p-8">Choose one plan version to open.</p>;
  return <div className="mx-auto w-full max-w-7xl p-4 md:p-8"><LandUsePlanWorkbench key={`${planId}:${versionId ?? "current"}`} planId={planId} versionId={versionId} /></div>;
}
