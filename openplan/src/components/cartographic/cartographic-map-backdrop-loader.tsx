"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { showsSharedMapControls } from "@/lib/navigation/map-surfaces";
import type { HomeMapView } from "@/lib/workspaces/home-geography";

/**
 * Holds the shell map's place until its code arrives. Same class and frame as
 * the backdrop, so the shell's layout rules (`:has(.op-map-backdrop)`) hold
 * from the first paint and the page does not jump when the map loads.
 */
function BackdropPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="op-map-backdrop"
      data-testid="cartographic-map-backdrop-placeholder"
      style={{ position: "fixed", inset: 0, zIndex: 0, background: "var(--bg)" }}
    />
  );
}

/*
  LOADED ONLY WHERE IT DRAWS. The backdrop is about 2,500 lines and brings
  mapbox-gl with it, but it draws only where `showsSharedMapControls` is true
  (the Aerial index today). A static import put both in the bundle of every
  signed-in page (two-month review, finding 10).
*/
const CartographicMapBackdrop = dynamic(
  () => import("./cartographic-map-backdrop").then((module) => module.CartographicMapBackdrop),
  { ssr: false, loading: BackdropPlaceholder },
);

/**
 * The shell's map, behind the route check.
 *
 * Off a map route the backdrop rendered nothing but did one thing: it marked
 * the page as owning its own map (`data-map-owner`), which hides the shell's
 * inspector dock. That moves here, so the backdrop does not have to load for it.
 */
export function CartographicMapBackdropLoader({
  homeMapView = null,
  workspaceId = null,
}: {
  homeMapView?: HomeMapView | null;
  workspaceId?: string | null;
}) {
  const pathname = usePathname();
  const drawsHere = showsSharedMapControls(pathname);

  useEffect(() => {
    if (drawsHere) return;
    document.body.dataset.mapOwner = "true";
    return () => {
      delete document.body.dataset.mapOwner;
    };
  }, [drawsHere]);

  if (!drawsHere) return null;
  return <CartographicMapBackdrop homeMapView={homeMapView} workspaceId={workspaceId} />;
}
