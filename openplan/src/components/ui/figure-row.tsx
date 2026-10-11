import Link from "next/link";

export type Figure = {
  label: string;
  /** Null when the number could not be read; the figure then says so instead of showing zero. */
  value: string | number | null;
  /** Six words or fewer, or a disclosure the number cannot be read without. */
  note?: string | null;
  /** Where the number is explained. The value becomes the link. */
  href?: string;
};

function formatted(value: string | number) {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

/**
 * A row of three or four figures: a label, a value and an optional short note,
 * separated by hairlines rather than boxed. Replaces the stat-tile walls the
 * October 1 and October 10, 2026 reviews found on the main pages, where every
 * number carried its own card and its own sentence.
 */
export function FigureRow({ figures, label }: { figures: readonly Figure[]; label: string }) {
  return (
    <dl className="figure-row" aria-label={label}>
      {figures.map((figure) => (
        <div key={figure.label} className="figure-row-item">
          <dt className="figure-row-label">{figure.label}</dt>
          <dd className="figure-row-value" data-figure>
            {figure.value === null ? (
              "—"
            ) : figure.href ? (
              <Link href={figure.href} className="figure-row-link">
                {formatted(figure.value)}
              </Link>
            ) : (
              formatted(figure.value)
            )}
          </dd>
          {figure.value === null ? (
            <dd className="figure-row-note">Not available</dd>
          ) : figure.note ? (
            <dd className="figure-row-note">{figure.note}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
