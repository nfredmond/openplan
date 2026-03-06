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
        "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/40 focus-visible:ring-offset-2",
        isActive
          ? "border border-[color:color-mix(in_srgb,var(--line)_72%,var(--pine)_28%)] bg-[color:color-mix(in_srgb,var(--pine)_8%,white)] text-[color:var(--pine-deep)] shadow-sm"
          : "border border-transparent text-[color:var(--ink)]/85 hover:border-[color:var(--line)] hover:bg-muted hover:text-[color:var(--pine-deep)]"
      )}
    >
      {label}
    </Link>
  );
}
