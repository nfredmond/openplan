"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { showsSharedMapControls } from "@/lib/navigation/map-surfaces";

/**
 * Renders its children only where the SHELL's background map is the working
 * surface — drawn here AND read here.
 *
 * A client component because `cartographic-shell` is a server component and has
 * no pathname; this is the smallest possible client boundary that can answer
 * "which page is this?" without turning the shell into a client tree.
 *
 * It renders NOTHING off a map surface rather than hiding with CSS: a
 * `display:none` layers panel still mounts its children, which for
 * `CartographicLayersPanel` means fetching workspace map-feature counts on
 * every page that does not draw them. `/explore` proved the second half of that
 * too — a hidden-but-mounted panel still satisfied `:has(.op-cart-layers)` and
 * held a 272px gutter open for a control nobody could see.
 *
 * ═══ WHY "IS A MAP SURFACE" IS NOT THE WHOLE TEST (2026-08-13) ═══
 *
 * It was, and `/safety` is what that missed. Safety is unambiguously a map
 * surface — a planner opens it to read where the collisions are — and it also
 * builds its OWN `mapboxgl.Map`. So the shell's dock mounted, and every control
 * in it drove the backdrop: measured at 1600×900, a layers panel at x=1344
 * toggling layers onto a 1600×900 map sitting entirely behind the page panel,
 * while the crash map the planner was reading was 558×457 at (305,350) and
 * carried none of them. The controls reported success and changed nothing the
 * planner could see, which is a worse failure than having no controls at all.
 *
 * `showsSharedMapControls` is the conjunction: the shell's controls go where
 * the shell's map is BOTH drawn and read. A route that owns its map owns its
 * controls with it.
 */
export function MapSurfaceOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!showsSharedMapControls(pathname)) return null;
  return <>{children}</>;
}
