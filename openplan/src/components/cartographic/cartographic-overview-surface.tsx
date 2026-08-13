"use client";

import { AppSecondaryNav } from "@/components/nav/app-secondary-nav";

import { useCartographicMapReading } from "./cartographic-context";

type CartographicOverviewSurfaceProps = {
  children: React.ReactNode;
  /** Optional inline header shown above page content. */
  heading?: {
    kicker?: string;
    title?: string;
    subtitle?: string;
  } | null;
};

/**
 * Floating panel that hosts route content on top of the map backdrop.
 * Width adapts to content: pages that only need a narrow column render
 * in ~420px; pages with tables/boards flex up to the available stage width.
 *
 * ═══ WHY THIS IS A CLIENT COMPONENT ═══
 *
 * Only for `inert`. When a planner asks to read the map (see
 * `cartographic-map-reading-toggle`), the stylesheet takes this panel off the
 * screen — but CSS cannot take it out of the tab order, and a page faded to
 * zero opacity with twenty focusable rows still in sequence is worse than a
 * visible one: Tab walks into content nobody can see. `inert` is the only
 * mechanism that answers that, it is an attribute, and an attribute needs a
 * component that can read state. Everything else about this panel — position,
 * opacity, transition — stays in `cartographic.css`, where the rest of the
 * shell's layout lives.
 *
 * Its children are RSC output passed through as a prop, so making this a client
 * component does not pull any page into the client bundle.
 */
export function CartographicOverviewSurface({
  children,
  heading,
}: CartographicOverviewSurfaceProps) {
  const { mapReading } = useCartographicMapReading();

  return (
    <section
      // Named so the toggle can point `aria-controls` at it. The id is the
      // contract between the two; renaming it silently is how a control ends up
      // describing nothing.
      id="op-cart-surface"
      className="op-cart-surface"
      inert={mapReading}
      /*
        `aria-hidden` ALONGSIDE `inert`, not instead of it.

        `aria-hidden` on a container holding focusable elements is a WCAG 4.1.2
        failure — that is the well-known trap, and it is exactly what `inert`
        removes: an inert subtree has no focusable elements. The pair is the
        supported way to say "this is not part of the page right now" in both
        the a11y tree and the focus order, and stating it explicitly means the
        claim does not depend on how completely a given browser has implemented
        `inert`'s implied semantics.
      */
      aria-hidden={mapReading || undefined}
    >
      <AppSecondaryNav />
      {heading ? (
        <header className="op-cart-surface__hd">
          {heading.kicker ? <div className="op-cart-surface__kicker">{heading.kicker}</div> : null}
          {heading.title ? <h1 className="op-cart-surface__title">{heading.title}</h1> : null}
          {heading.subtitle ? (
            <p className="op-cart-surface__sub">{heading.subtitle}</p>
          ) : null}
        </header>
      ) : null}
      <div className="op-cart-surface__body">{children}</div>
    </section>
  );
}
