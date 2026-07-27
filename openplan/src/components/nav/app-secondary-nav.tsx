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
                  "block rounded px-2 py-1.5 text-[0.8rem] transition-colors duration-150",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
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
