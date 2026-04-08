import * as React from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type StateTone = "neutral" | "info" | "warning" | "danger";

type BaseStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
};

export function StateBlock({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  tone = "neutral",
}: BaseStateProps & {
  icon?: React.ReactNode;
  tone?: StateTone;
}) {
  const toneClasses = {
    neutral: {
      container: "border-border/80 bg-muted/35 text-foreground",
      icon: "border-border/70 bg-background text-muted-foreground",
      description: "text-muted-foreground",
      role: "status",
    },
    info: {
      container: "border-sky-500/35 bg-sky-500/10 text-sky-950 dark:text-sky-100",
      icon: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
      description: "text-sky-800/90 dark:text-sky-100/85",
      role: "status",
    },
    warning: {
      container: "border-amber-400/45 bg-amber-400/10 text-amber-950 dark:text-amber-100",
      icon: "border-amber-400/35 bg-amber-400/10 text-amber-700 dark:text-amber-200",
      description: "text-amber-800/90 dark:text-amber-100/85",
      role: "status",
    },
    danger: {
      container: "border-destructive/40 bg-destructive/10 text-destructive",
      icon: "border-destructive/35 bg-destructive/10 text-destructive",
      description: "text-destructive/90",
      role: "alert",
    },
  } satisfies Record<StateTone, { container: string; icon: string; description: string; role: "status" | "alert" }>;

  const styles = toneClasses[tone];
  const resolvedIcon =
    icon ??
    (tone === "danger" || tone === "warning" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : tone === "info" ? (
      <Loader2 className="h-4 w-4" />
    ) : (
      <Inbox className="h-4 w-4" />
    ));

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3",
        styles.container,
        compact ? "space-y-1.5" : "space-y-2.5",
        className
      )}
      role={styles.role}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center border",
            styles.icon
          )}
        >
          {resolvedIcon}
        </span>

        <div className="space-y-1">
          <p className={cn("font-semibold tracking-tight", compact ? "text-sm" : "text-base")}>{title}</p>
          {description ? <p className={cn(compact ? "text-xs" : "text-sm", styles.description)}>{description}</p> : null}
        </div>
      </div>

      {action ? <div className="pt-0.5">{action}</div> : null}
    </div>
  );
}

type LoadingStateProps = {
  label?: string;
  description?: string;
  compact?: boolean;
  className?: string;
};

export function LoadingState({
  label = "Loading",
  description,
  compact = false,
  className,
}: LoadingStateProps) {
  return (
    <StateBlock
      icon={<Loader2 className="h-4 w-4 animate-spin" />}
      title={label}
      description={description}
      compact={compact}
      className={className}
    />
  );
}

export function EmptyState({ title, description, action, compact = false, className }: BaseStateProps) {
  return (
    <StateBlock
      icon={<Inbox className="h-4 w-4" />}
      title={title}
      description={description}
      action={action}
      compact={compact}
      className={className}
    />
  );
}

export function ErrorState({ title, description, action, compact = false, className }: BaseStateProps) {
  return (
    <StateBlock
      icon={<AlertTriangle className="h-4 w-4" />}
      title={title}
      description={description}
      action={action}
      compact={compact}
      className={className}
      tone="danger"
    />
  );
}
