import * as React from "react";

import { cn } from "@/lib/utils";

export function Inspector({
  title,
  subtitle,
  children,
  className,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "inspector-root flex flex-col gap-4 rounded-[18px] border border-border/60 bg-muted/20 p-4",
        className
      )}
      aria-label="Selection inspector"
    >
      <header className="inspector-header flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="inspector-title text-sm font-semibold text-foreground">{title}</h3>
          {actions ? <div className="inspector-actions flex items-center gap-2">{actions}</div> : null}
        </div>
        {subtitle ? <p className="inspector-subtitle text-xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div className="inspector-body flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function InspectorField({
  label,
  value,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("inspector-field flex flex-col gap-1", className)}>
      <span className="inspector-field-label text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="inspector-field-value text-sm text-foreground">{value}</span>
      {hint ? <span className="inspector-field-hint text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function InspectorGroup({
  label,
  children,
  className,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("inspector-group flex flex-col gap-2 border-t border-border/50 pt-3 first:border-t-0 first:pt-0", className)}>
      {label ? (
        <p className="inspector-group-label text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function InspectorEmpty({
  title = "No selection",
  description,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inspector-empty flex flex-col items-start gap-1 rounded-[14px] border border-dashed border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground",
        className
      )}
      role="status"
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
