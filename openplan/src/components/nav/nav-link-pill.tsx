"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavLinkPillProps = {
  href: string;
  label: string;
};

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinkPill({ href, label }: NavLinkPillProps) {
  const pathname = usePathname();
  const isActive = isActivePath(pathname, href);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      data-active={isActive ? "true" : "false"}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2",
        isActive
          ? "border border-border bg-[color:color-mix(in_srgb,var(--pine)_8%,var(--card))] text-primary shadow-sm"
          : "border border-transparent text-foreground/70 hover:border-border hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </Link>
  );
}
