import * as React from "react";

import { cn } from "@/lib/utils";

type WorksurfaceDensity = "comfortable" | "compact";
type WorksurfaceVariant = "default" | "inspector-open" | "full-bleed";

export type WorksurfaceProps = {
  leftRail?: React.ReactNode;
  worksurface: React.ReactNode;
  inspector?: React.ReactNode;
  header?: React.ReactNode;
  variant?: WorksurfaceVariant;
  density?: WorksurfaceDensity;
  className?: string;
  ariaLabel?: string;
};

const densityClasses: Record<WorksurfaceDensity, string> = {
  comfortable: "gap-6",
  compact: "gap-4",
};

export function Worksurface({
  leftRail,
  worksurface,
  inspector,
  header,
  variant = "default",
  density = "comfortable",
  className,
  ariaLabel,
}: WorksurfaceProps) {
  const hasLeftRail = Boolean(leftRail);
  const hasInspector = Boolean(inspector) && variant !== "full-bleed";

  const gridColumns = variant === "full-bleed"
    ? "grid-cols-1"
    : hasLeftRail && hasInspector
      ? "grid-cols-1 xl:grid-cols-[minmax(14rem,16rem)_minmax(0,1fr)_minmax(18rem,22rem)]"
      : hasLeftRail
        ? "grid-cols-1 xl:grid-cols-[minmax(14rem,16rem)_minmax(0,1fr)]"
        : hasInspector
          ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
          : "grid-cols-1";

  return (
    <section
      aria-label={ariaLabel}
      className={cn("worksurface-root flex flex-col", densityClasses[density], className)}
      data-variant={variant}
      data-density={density}
    >
      {header ? <header className="worksurface-header">{header}</header> : null}
      <div className={cn("worksurface-grid grid", densityClasses[density], gridColumns)}>
        {hasLeftRail ? (
          <aside
            className="worksurface-left-rail flex flex-col gap-4"
            data-worksurface-slot="left-rail"
            aria-label="Navigation rail"
          >
            {leftRail}
          </aside>
        ) : null}
        <div
          className="worksurface-main min-w-0 flex flex-col gap-6"
          data-worksurface-slot="worksurface"
        >
          {worksurface}
        </div>
        {hasInspector ? (
          <aside
            className="worksurface-inspector flex flex-col gap-4"
            data-worksurface-slot="inspector"
            aria-label="Inspector"
          >
            {inspector}
          </aside>
        ) : null}
      </div>
    </section>
  );
}

export function WorksurfaceSection({
  id,
  label,
  title,
  description,
  trailing,
  children,
  className,
}: {
  id?: string;
  label?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article id={id} className={cn("worksurface-section module-section-surface", className)}>
      <div className="module-section-header">
        <div className="module-section-heading">
          {label ? <p className="module-section-label">{label}</p> : null}
          <h2 className="module-section-title">{title}</h2>
          {description ? <p className="module-section-description">{description}</p> : null}
        </div>
        {trailing ? <div className="worksurface-section-trailing">{trailing}</div> : null}
      </div>
      <div className="worksurface-section-body">{children}</div>
    </article>
  );
}
