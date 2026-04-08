import * as React from "react";

import { cn } from "@/lib/utils";

export function MetaList({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("module-inline-list", className)} {...props} />;
}

export function MetaItem({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("module-inline-item", className)} {...props} />;
}
