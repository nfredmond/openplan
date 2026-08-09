"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLabel } from "@/components/nav/nav-registry";
import { cn } from "@/lib/utils";

type SecondarySection = {
  title: string;
  description?: string;
  items: Array<{ href: string; description?: string }>;
};

// The grouping here is contextual — which neighbors make sense from where the
// planner is standing — but every label resolves through the shared nav
// registry, so a surface is named the same thing in every nav.
const sectionMap: Array<{
  match: string[];
  section: SecondarySection;
}> = [
  {
    match: ["/dashboard", "/command-center"],
    section: {
      title: "Overview",
      items: [
        { href: "/dashboard" },
        { href: "/command-center" },
        { href: "/projects" },
        { href: "/reports" },
      ],
    },
  },
  {
    match: ["/explore", "/safety"],
    section: {
      title: "Analysis Studio",
      items: [
        { href: "/explore" },
        { href: "/safety" },
        { href: "/reports" },
      ],
    },
  },
  {
    match: ["/projects"],
    section: {
      title: "Projects",
      items: [
        { href: "/projects" },
        { href: "/rtp" },
        { href: "/plans" },
        { href: "/programs" },
      ],
    },
  },
  {
    match: ["/rtp", "/plans", "/programs", "/knowledge-base"],
    section: {
      title: "Planning System",
      items: [
        { href: "/rtp" },
        { href: "/plans" },
        { href: "/programs" },
        { href: "/grants" },
        { href: "/engagement" },
        { href: "/knowledge-base" },
      ],
    },
  },
  {
    match: ["/grants"],
    section: {
      title: "Funding",
      items: [
        { href: "/grants" },
        { href: "/programs" },
        { href: "/projects" },
        { href: "/reports" },
      ],
    },
  },
  {
    match: ["/engagement"],
    section: {
      title: "Engagement",
      items: [
        { href: "/engagement" },
        { href: "/reports" },
        { href: "/data-hub" },
      ],
    },
  },
  {
    match: ["/scenarios", "/models", "/data-hub", "/county-runs"],
    section: {
      title: "Transportation Modeling",
      items: [
        { href: "/models" },
        { href: "/scenarios" },
        { href: "/county-runs" },
        { href: "/data-hub" },
      ],
    },
  },
  {
    match: ["/reports", "/invoicing", "/assistant-activity"],
    section: {
      title: "Operations",
      items: [
        { href: "/reports" },
        { href: "/invoicing" },
        { href: "/assistant-activity" },
      ],
    },
  },
];

export function AppSecondaryNav() {
  const pathname = usePathname();
  const section = sectionMap.find((entry) =>
    entry.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  )?.section;

  if (!section) {
    return null;
  }

  return (
    <div className="shell-ledger-panel gap-0">
      <p className="shell-panel-kicker">{section.title}</p>
      {section.description ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{section.description}</p>
      ) : null}
      <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
        {section.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  /*
                    The active row used `bg-accent text-foreground`, which
                    borrows shadcn's convention where `--accent` is a MUTED
                    surface. In this token system `--accent` is the saturated
                    brand colour, so the current page rendered as a full-width
                    slab of brand with `--foreground` text on it: near-white on
                    light green under the Meadow palette (~1.3:1), and only
                    ~2:1 on the cartographic default. The most prominent card on
                    the page was also its least readable text.

                    `--secondary` is the panel tint meant for exactly this —
                    a surface that reads as "selected" without competing with
                    the content — and the brand colour moves to a left marker,
                    where it identifies the current row without having to carry
                    text on top of it.
                  */
                  "block rounded border-l-2 px-2 py-1.5 text-[0.8rem] transition-colors duration-150",
                  active
                    ? "border-l-primary bg-secondary text-foreground"
                    : "border-l-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                )}
              >
                <span className="min-w-0">
                  <span className="block">{navLabel(item.href)}</span>
                  {item.description ? (
                    <span className="mt-1 block text-[0.72rem] leading-5 text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-primary">
                    Current
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
