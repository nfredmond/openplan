"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type SecondarySection = {
  title: string;
  description?: string;
  items: Array<{ href: string; label: string; description?: string }>;
};

const sectionMap: Array<{
  match: string[];
  section: SecondarySection;
}> = [
  {
    match: ["/dashboard", "/command-center"],
    section: {
      title: "Overview",
      items: [
        { href: "/dashboard", label: "Workspace Dashboard" },
        { href: "/command-center", label: "Command Center" },
        { href: "/projects", label: "Projects" },
        { href: "/reports", label: "Reports" },
      ],
    },
  },
  {
    match: ["/explore"],
    section: {
      title: "Analysis Studio",
      items: [
        { href: "/explore", label: "Corridor Analysis" },
        { href: "/reports", label: "Reports" },
      ],
    },
  },
  {
    match: ["/projects"],
    section: {
      title: "Projects",
      items: [
        { href: "/projects", label: "All Projects" },
        { href: "/rtp", label: "RTP Cycles" },
        { href: "/plans", label: "Plans" },
        { href: "/programs", label: "Programs" },
      ],
    },
  },
  {
    match: ["/rtp", "/plans", "/programs"],
    section: {
      title: "Planning System",
      items: [
        { href: "/rtp", label: "RTP Cycles" },
        { href: "/plans", label: "Plans" },
        { href: "/programs", label: "Programs & Cycles" },
        { href: "/grants", label: "Grants" },
        { href: "/engagement", label: "Engagement" },
      ],
    },
  },
  {
    match: ["/grants"],
    section: {
      title: "Funding",
      items: [
        { href: "/grants", label: "Grant Pipeline" },
        { href: "/programs", label: "Programs & Cycles" },
        { href: "/projects", label: "Projects" },
        { href: "/reports", label: "Reports" },
      ],
    },
  },
  {
    match: ["/engagement"],
    section: {
      title: "Engagement",
      items: [
        { href: "/engagement", label: "Campaigns" },
        { href: "/reports", label: "Outreach Reports" },
        { href: "/data-hub", label: "Imported Datasets" },
      ],
    },
  },
  {
    match: ["/scenarios", "/models", "/data-hub", "/county-runs"],
    section: {
      title: "Transportation Modeling",
      items: [
        { href: "/models", label: "Models" },
        { href: "/scenarios", label: "Scenarios" },
        { href: "/county-runs", label: "County Validation" },
        { href: "/data-hub", label: "Data Hub" },
      ],
    },
  },
  {
    match: ["/reports", "/billing", "/admin", "/assistant-activity"],
    section: {
      title: "Operations",
      items: [
        { href: "/reports", label: "Reports" },
        { href: "/billing", label: "Billing" },
        { href: "/assistant-activity", label: "Agent Activity" },
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
                  <span className="block">{item.label}</span>
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
