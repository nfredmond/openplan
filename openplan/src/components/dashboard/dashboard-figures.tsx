import Link from "next/link";

export type DashboardFigure = {
  key: string;
  label: string;
  /** Null when the number could not be read; the figure then says so. */
  value: string | null;
  /** Six words or fewer, or a disclosure the number cannot be read without. */
  qualifier?: string | null;
  href: string;
};

/**
 * Three numbers, each a label, a value and a link to the page that explains
 * it. A figure whose read failed shows a dash and "Not available", never zero.
 */
export function DashboardFigures({ figures }: { figures: readonly DashboardFigure[] }) {
  return (
    <section className="dashboard-figures" aria-label="Workspace figures">
      {figures.map((figure) => (
        <Link key={figure.key} href={figure.href} className="dashboard-figure" data-figure>
          <span className="dashboard-figure-label">{figure.label}</span>
          <span className="dashboard-figure-value">{figure.value ?? "—"}</span>
          <span className="dashboard-figure-qualifier">
            {figure.value === null ? "Not available" : figure.qualifier ?? " "}
          </span>
        </Link>
      ))}
    </section>
  );
}
