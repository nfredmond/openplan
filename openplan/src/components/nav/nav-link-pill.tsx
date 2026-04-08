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
        "inline-flex items-center gap-2 border-b px-0 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2",
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-foreground/68 hover:border-border hover:text-foreground"
      )}
    >
      <span>{label}</span>
      <span className="text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">{isActive ? "Live" : "Open"}</span>
    </Link>
  );
}
