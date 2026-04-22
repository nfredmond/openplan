import { AppSecondaryNav } from "@/components/nav/app-secondary-nav";

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
 */
export function CartographicOverviewSurface({
  children,
  heading,
}: CartographicOverviewSurfaceProps) {
  return (
    <section className="op-cart-surface">
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
