type ModulePageSkeletonProps = {
  /** Number of section-surface blocks to render below the header. */
  sections?: number;
  /** Pulsing rows inside each section surface. */
  rowsPerSection?: number;
};

function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-muted/50 ${className}`} />;
}

/**
 * Instant loading skeleton in the module-* worksurface language: a header-bar
 * shimmer plus a few section-surface blocks with pulsing record rows. Pure CSS
 * animation (Tailwind animate-pulse) on theme-token colors, so it reads in both
 * light and dark themes. No spinners, no card grids.
 */
export function ModulePageSkeleton({ sections = 3, rowsPerSection = 4 }: ModulePageSkeletonProps) {
  return (
    <section className="module-page" aria-busy="true" aria-hidden="true" data-testid="module-page-skeleton">
      <div className="module-page-backdrop" />

      <header className="module-header-grid">
        <div className="module-intro-card animate-pulse">
          <div className="space-y-3">
            <Bar className="h-3 w-28" />
            <Bar className="h-8 w-3/4" />
            <Bar className="h-4 w-1/2" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-md border border-border/60 p-3">
                <Bar className="h-3 w-16 bg-muted/40" />
                <Bar className="h-6 w-12 bg-muted/60" />
              </div>
            ))}
          </div>
        </div>

        <div className="module-section-surface animate-pulse">
          <div className="space-y-3">
            <Bar className="h-3 w-24" />
            <Bar className="h-5 w-2/3" />
            <Bar className="h-4 w-full bg-muted/40" />
            <Bar className="h-4 w-5/6 bg-muted/40" />
            <Bar className="h-4 w-3/4 bg-muted/40" />
          </div>
        </div>
      </header>

      {Array.from({ length: Math.max(1, sections) }).map((_, sectionIndex) => (
        <div key={sectionIndex} className="module-section-surface animate-pulse">
          <div className="module-section-header">
            <div className="module-section-heading space-y-2">
              <Bar className="h-3 w-24" />
              <Bar className="h-5 w-56" />
            </div>
            <Bar className="h-6 w-24 rounded-full bg-muted/40" />
          </div>

          <div className="mt-4 module-record-list">
            {Array.from({ length: Math.max(1, rowsPerSection) }).map((_, rowIndex) => (
              <div key={rowIndex} className="module-record-row space-y-3">
                <Bar className="h-3 w-32 bg-muted/40" />
                <Bar className="h-4 w-3/4 bg-muted/55" />
                <Bar className="h-3 w-1/2 bg-muted/35" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
