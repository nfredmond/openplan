"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isMapSurfaceRoute } from "@/lib/navigation/map-surfaces";

/**
 * Renders its children only where the background map is a working surface.
 *
 * A client component because `cartographic-shell` is a server component and has
 * no pathname; this is the smallest possible client boundary that can answer
 * "which page is this?" without turning the shell into a client tree.
 *
 * It renders NOTHING off a map surface rather than hiding with CSS: a
 * `display:none` layers panel still mounts its children, which for
 * `CartographicLayersPanel` means fetching workspace map-feature counts on
 * every page that does not draw them.
 */
export function MapSurfaceOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!isMapSurfaceRoute(pathname)) return null;
  return <>{children}</>;
}
