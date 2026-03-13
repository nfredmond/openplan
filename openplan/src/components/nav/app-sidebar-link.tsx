"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  ClipboardList,
  Database,
  FileText,
  FolderKanban,
  LayoutDashboard,
  MessageSquareShare,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const icons = {
  overview: LayoutDashboard,
  projects: FolderKanban,
  plans: BookOpen,
  programs: ClipboardList,
  engagement: MessageSquareShare,
  analysis: BarChart3,
  scenarios: Briefcase,
  models: Building2,
  data: Database,
  reports: FileText,
  admin: Settings2,
} satisfies Record<string, LucideIcon>;

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type AppSidebarLinkProps = {
  href: string;
  label: string;
  icon: keyof typeof icons;
};

export function AppSidebarLink({ href, label, icon }: AppSidebarLinkProps) {
  const pathname = usePathname();
  const isActive = isActivePath(pathname, href);
  const Icon = icons[icon];

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm font-medium transition-all duration-200",
        isActive
          ? "border-white/15 bg-white/10 text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
          : "border-transparent text-slate-300/82 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
          isActive
            ? "border-emerald-300/25 bg-emerald-300/12 text-emerald-100"
            : "border-white/10 bg-white/[0.03] text-slate-300 group-hover:border-white/15 group-hover:text-white"
        )}
      >
        <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 truncate tracking-[0.01em]">{label}</span>
    </Link>
  );
}
