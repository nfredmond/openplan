"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  CircuitBoard,
  ClipboardList,
  Database,
  FileText,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  Library,
  LifeBuoy,
  ListChecks,
  Map as MapIcon,
  MapPinned,
  Menu,
  MessageSquareShare,
  PlaneTakeoff,
  Receipt,
  Route,
  ScrollText,
  Settings2,
  ShieldAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { ThemeControls } from "@/components/theme-controls";
import { ThemeToggle } from "@/components/theme-toggle";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { cn } from "@/lib/utils";

const ICONS = {
  overview: LayoutDashboard,
  // A checklist, not a person glyph: /my-work is a queue of dated work, and an
  // avatar would read as an account or profile page.
  work: ListChecks,
  projects: FolderKanban,
  rtp: Route,
  plans: BookOpen,
  programs: ClipboardList,
  grants: Landmark,
  engagement: MessageSquareShare,
  safety: ShieldAlert,
  analysis: BarChart3,
  scenarios: Briefcase,
  models: CircuitBoard,
  data: Database,
  knowledge: Library,
  county: MapIcon,
  reports: FileText,
  maps: MapPinned,
  aerial: PlaneTakeoff,
  // Receipt, not CreditCard: the register holds invoices the agency SENDS
  // (reimbursement claims to funders) — a payment-card glyph misread as
  // OpenPlan charging the user, which is not a thing.
  invoicing: Receipt,
  admin: Settings2,
  activity: ScrollText,
  help: LifeBuoy,
} satisfies Record<string, LucideIcon>;

/**
 * The icon names this rail can render. The nav registry stores icons as names
 * (it must stay importable from the middleware runtime), and the registry test
 * asserts every registered name appears here, so a typo fails in CI instead of
 * crashing the rail.
 */
export const CARTOGRAPHIC_RAIL_ICON_NAMES = Object.keys(ICONS);

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
  /** Sign out (or sign in), shown in the phone "More" sheet. */
  accountControl?: ReactNode;
};

/**
 * The destinations the phone bar shows by name. Everything else is one tap
 * away in the "More" sheet, with its label. The bar used to be twenty icons
 * with no labels in a strip that scrolled sideways, each 23px tall.
 */
const PHONE_BAR_HREFS = new Set(["/dashboard", "/my-work", "/projects"]);

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CartographicRail({ groups, accountControl }: CartographicRailProps) {
  const pathname = usePathname();
  // The sheet is the shared modal primitive: focus is trapped, Escape closes
  // it, and focus returns to the More button.
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * How many button-height rows the rail draws: every nav item, plus the theme
   * control in the foot. The stylesheet divides the window height by this to
   * size a row, so the rail fits without a scrollbar.
   *
   * It is a variable rather than a number in the CSS on purpose. The previous
   * fix used fixed heights at four `max-height` breakpoints, which left bands
   * of window height where the nav overflowed by a few pixels — measured at
   * 1000px tall, the nav wanted 857px and had 850px, so a scrollbar appeared.
   * Worse, any number baked into the stylesheet goes stale the moment someone
   * adds a nav entry, and nothing would fail to say so. Reading the count from
   * the rendered groups means adding an item re-sizes the rows instead.
   */
  const rowCount = groups.reduce((total, group) => total + group.items.length, 0) + 1;

  return (
    <aside
      className="op-cart-rail"
      aria-label="Primary navigation"
      style={{ "--op-rail-rows": rowCount } as React.CSSProperties}
    >
      <div className="op-cart-rail__inner">
        {/*
          No brand mark here. It was a second link to /dashboard, which the
          "Overview" item directly below it already is — two adjacent links to
          one destination, and 59px of a rail that has to fit eighteen items
          without scrolling. The tab title and the workspace pill in the header
          say whose app this is.
        */}
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
                    data-phone-bar={PHONE_BAR_HREFS.has(item.href) || active ? "true" : undefined}
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
        {/* Phone only (CSS). Opens every destination, by name. */}
        <button
          type="button"
          className="op-cart-rail__btn op-cart-rail__more"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        >
          <Menu size={16} strokeWidth={1.8} />
          <span className="op-cart-rail__tip">More</span>
        </button>
        {sheetOpen ? (
          <ModalDialog
            titleId="nav-sheet-title"
            onRequestClose={() => setSheetOpen(false)}
            closeOnBackdropPress
            className="op-cart-navsheet"
          >
            <div className="op-cart-navsheet__panel">
              <div className="op-cart-navsheet__hd">
                <h2 id="nav-sheet-title" className="op-cart-navsheet__title">All sections</h2>
                <button
                  type="button"
                  className="op-cart-navsheet__close"
                  aria-label="Close"
                  onClick={() => setSheetOpen(false)}
                >
                  <X size={18} strokeWidth={1.8} />
                </button>
              </div>
              {groups.map((group) => (
                <section key={group.title} className="op-cart-navsheet__group">
                  <h3 className="op-cart-navsheet__group-title">{group.title}</h3>
                  <ul>
                    {group.items.map((item) => {
                      const Icon = ICONS[item.icon];
                      const active = isActivePath(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={cn("op-cart-navsheet__link", active && "is-active")}
                            aria-current={active ? "page" : undefined}
                            onClick={() => setSheetOpen(false)}
                          >
                            <Icon size={18} strokeWidth={1.8} />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              <div className="op-cart-navsheet__ft">
                <ThemeControls />
                {accountControl}
              </div>
            </div>
          </ModalDialog>
        ) : null}
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
