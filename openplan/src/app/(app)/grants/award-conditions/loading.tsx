import { ModulePageSkeleton } from "@/components/ui/module-page-skeleton";

/**
 * The same skeleton the grants hub shows. It sat in `grants/loading.tsx` and
 * covered this page from there until the hub moved into `(overview)/` so the
 * benefit-cost record page could answer a real 404 (KI-2026-11-14-280).
 */
export default function Loading() {
  return <ModulePageSkeleton sections={4} />;
}
