import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/ui/status";

/*
  Tones read the fixed status tokens, not the palette accents. Success used to
  be `--pine` and warning `--copper`, which a palette may set to any hue: under
  Plum, "success" was violet, and under Cartographic "info" and "warning" were
  the same orange.
*/
const toneClasses: Record<StatusTone, string> = {
  neutral: "border-[color:var(--line)] bg-background text-foreground/72",
  info: "border-status-info/35 bg-status-info/12 text-status-info",
  success: "border-status-ok/35 bg-status-ok/12 text-status-ok",
  warning: "border-status-warn/38 bg-status-warn/12 text-status-warn",
  danger: "border-status-urgent/38 bg-status-urgent/12 text-status-urgent",
};

type StatusBadgeProps = React.ComponentProps<typeof Badge> & {
  tone?: StatusTone;
};

export function StatusBadge({ tone = "neutral", className, children, ...props }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn("min-h-6 px-2 py-0.5 text-label", toneClasses[tone], className)}
      {...props}
    >
      {children}
    </Badge>
  );
}
