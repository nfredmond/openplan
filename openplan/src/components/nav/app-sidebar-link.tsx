"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  CircuitBoard,
  ClipboardList,
  CreditCard,
  Database,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Map,
  MessageSquareShare,
  Route,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const icons = {
  overview: LayoutDashboard,
  projects: FolderKanban,
  rtp: Route,
  plans: BookOpen,
  programs: ClipboardList,
  engagement: MessageSquareShare,
  analysis: BarChart3,
  scenarios: Briefcase,
  models: CircuitBoard,
  data: Database,
  county: Map,
  reports: FileText,
  billing: CreditCard,
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
        "group relative grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border border-transparent px-3 py-3 text-[0.84rem] font-medium transition-all duration-200",
        isActive
          ? "bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          : "text-slate-300/78 hover:border-white/[0.06] hover:bg-white/[0.025] hover:text-white"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-emerald-200/90 to-transparent transition-opacity duration-200",
          isActive ? "opacity-100" : "opacity-0"
        )}
      />
      <span
        className={cn(
          "relative flex h-9 w-9 items-center justify-center border text-current transition-colors duration-200",
          isActive
            ? "border-emerald-300/16 bg-emerald-300/10 text-emerald-100"
            : "border-white/[0.08] bg-white/[0.02] text-slate-400 group-hover:border-white/[0.12] group-hover:text-slate-200"
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <span className="relative min-w-0 truncate tracking-[0.01em]">{label}</span>
      <span
        aria-hidden
        className={cn(
          "text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors",
          isActive && "text-emerald-100/82"
        )}
      >
        {isActive ? "Live" : "Open"}
      </span>
    </Link>
  );
}
