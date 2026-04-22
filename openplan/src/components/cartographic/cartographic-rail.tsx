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
  Map as MapIcon,
  MessageSquareShare,
  PlaneTakeoff,
  Radar,
  Route,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const ICONS = {
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
  county: MapIcon,
  reports: FileText,
  aerial: PlaneTakeoff,
  billing: CreditCard,
  admin: Settings2,
} satisfies Record<string, LucideIcon>;

export type CartographicRailItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number | string;
};

export type CartographicRailGroup = {
  title: string;
  items: CartographicRailItem[];
};

type CartographicRailProps = {
  groups: CartographicRailGroup[];
  brand?: string;
};

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CartographicRail({ groups, brand = "◎" }: CartographicRailProps) {
  const pathname = usePathname();

  return (
    <aside className="op-cart-rail" aria-label="Primary navigation">
      <div className="op-cart-rail__inner">
        <Link href="/dashboard" className="op-cart-rail__logo" aria-label="OpenPlan home">
          {brand}
        </Link>
        <div className="op-cart-rail__sep" />
        <nav className="op-cart-rail__nav">
          {groups.map((group, groupIdx) => (
            <div key={group.title} className="op-cart-rail__group">
              {groupIdx > 0 ? <div className="op-cart-rail__sep" /> : null}
              <p className="op-cart-rail__group-title">{group.title}</p>
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("op-cart-rail__btn", active && "is-active")}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                    {item.badge != null ? (
                      <span className="op-cart-rail__badge">{item.badge}</span>
                    ) : null}
                    <span className="op-cart-rail__tip">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="op-cart-rail__flex" />
        <div className="op-cart-rail__foot">
          <div className="op-cart-rail__btn op-cart-rail__btn--ghost" aria-hidden={false}>
            <ThemeToggle />
            <span className="op-cart-rail__tip">Theme</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
