import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 py-2 text-base shadow-xs transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
