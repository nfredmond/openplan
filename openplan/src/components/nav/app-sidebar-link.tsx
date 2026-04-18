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
  PlaneTakeoff,
  Radar,
  Route,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const icons = {
  overview: LayoutDashboard,
  command: Radar,
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
  aerial: PlaneTakeoff,
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
        "flex items-center gap-2.5 rounded px-2 py-1.5 text-[0.84rem] transition-colors duration-150",
        isActive
          ? "bg-white/[0.07] text-white"
          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive ? "text-emerald-300/90" : "text-slate-500"
        )}
        strokeWidth={1.8}
      />
      <span className="min-w-0 truncate font-medium tracking-[0.01em]">{label}</span>
    </Link>
  );
}
