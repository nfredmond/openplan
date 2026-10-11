import type { ReactNode } from "react";
import { recordMetadata } from "@/lib/ui/page-title";

/** The browser-tab title for one map package. */
export async function generateMetadata({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  return recordMetadata({ table: "project_map_packages", nameColumn: "title", id: packageId, moduleName: "Maps" });
}

// Pass-through: this layout exists to name the tab, not to add chrome.
export default function MapPackageLayout({ children }: { children: ReactNode }) {
  return children;
}
