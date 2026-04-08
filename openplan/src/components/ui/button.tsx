import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border-primary/12 bg-primary text-primary-foreground hover:bg-[color:var(--pine-deep)] focus-visible:ring-[color:var(--focus-ring-light)]/45",
        destructive: "border-destructive/30 bg-destructive text-white hover:brightness-110 focus-visible:ring-destructive/55",
        outline: "border-[color:color-mix(in_srgb,var(--line)_84%,var(--ink)_16%)] bg-background text-[color:var(--ink)] hover:border-[color:var(--pine)] hover:bg-[color:color-mix(in_srgb,var(--pine)_8%,white)] hover:text-[color:var(--pine-deep)] focus-visible:ring-[color:var(--focus-ring-light)]/45",
        secondary: "border-[color:var(--line)] bg-[color:var(--sand)] text-[#1f2428] hover:brightness-105 focus-visible:ring-[color:var(--focus-ring-light)]/45",
        ghost: "border-transparent text-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[color:var(--focus-ring-light)]/45",
        link: "border-transparent text-primary underline-offset-4 hover:underline focus-visible:ring-[color:var(--focus-ring-light)]/45",
      },
      size: {
        default: "h-10 px-4.5 py-2 has-[>svg]:px-3.5",
        xs: "h-8 gap-1 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3.5 has-[>svg]:px-3",
        lg: "h-11 px-6 has-[>svg]:px-4.5",
        icon: "size-10",
        "icon-xs": "size-8 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
