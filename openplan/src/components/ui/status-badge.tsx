import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/ui/status";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-[color:var(--line)] bg-background text-foreground/72",
  info: "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)]",
  success: "border-[color:var(--pine)]/32 bg-[color:var(--pine)]/10 text-[color:var(--pine)]",
  warning: "border-[color:var(--copper)]/38 bg-[color:var(--copper)]/12 text-[color:var(--copper)]",
  danger: "border-destructive/38 bg-destructive/10 text-destructive",
};

type StatusBadgeProps = React.ComponentProps<typeof Badge> & {
  tone?: StatusTone;
};

export function StatusBadge({ tone = "neutral", className, children, ...props }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("min-h-8 px-2.5 py-1 text-[0.62rem] tracking-[0.16em]", toneClasses[tone], className)}
      {...props}
    >
      {children}
    </Badge>
  );
}
