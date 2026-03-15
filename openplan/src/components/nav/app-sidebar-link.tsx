"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  CircuitBoard,
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
  models: CircuitBoard,
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
        "group relative flex items-center gap-3 overflow-hidden rounded-[18px] border px-3 py-2.5 text-[0.84rem] font-medium transition-all duration-200",
        isActive
          ? "border-white/[0.1] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.048))] text-white shadow-[0_12px_28px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "border-transparent text-slate-300/75 hover:border-white/[0.08] hover:bg-white/[0.03] hover:text-white"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-1.5 w-px rounded-full bg-gradient-to-b from-emerald-200/0 via-emerald-200/90 to-emerald-200/0 transition-opacity duration-200",
          isActive ? "opacity-100" : "opacity-0"
        )}
      />
      <span
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-xl border transition-colors duration-200",
          isActive
            ? "border-emerald-300/20 bg-[linear-gradient(180deg,rgba(110,231,183,0.14),rgba(110,231,183,0.08))] text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            : "border-white/[0.08] bg-white/[0.02] text-slate-400 group-hover:border-white/[0.12] group-hover:text-slate-200"
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <span className="relative min-w-0 truncate tracking-[0.01em]">{label}</span>
    </Link>
  );
}
