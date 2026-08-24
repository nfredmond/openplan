import { LandUsePlanWorkbench } from "@/components/land-use-plans/land-use-plan-workbench";
import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Land Use Plan");

export default async function LandUsePlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <main className="mx-auto w-full max-w-7xl p-4 md:p-8"><LandUsePlanWorkbench planId={planId} /></main>;
}

