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
    match: ["/dashboard"],
    section: {
      title: "Overview",
      items: [
        { href: "/dashboard", label: "Workspace Dashboard" },
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
        { href: "/engagement", label: "Engagement" },
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
    match: ["/reports", "/billing", "/admin"],
    section: {
      title: "Operations",
      description: "Commercial controls and pilot-readiness surfaces",
      items: [
        { href: "/reports", label: "Reports" },
        { href: "/billing", label: "Billing" },
        { href: "/admin", label: "Admin" },
        {
          href: "/admin/pilot-readiness",
          label: "Pilot Readiness",
          description: "Smoke evidence, proof packets, and launch diligence",
        },
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
        <p className="mt-2 text-xs leading-5 text-slate-300/72">{section.description}</p>
      ) : null}
      <ul className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.06]">
        {section.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-[0.82rem] transition-all duration-200",
                  active ? "text-white" : "text-slate-300/72 hover:text-white"
                )}
              >
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {item.description ? (
                    <span className="mt-1 block text-[0.72rem] leading-5 text-slate-400">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "text-[0.58rem] font-semibold uppercase tracking-[0.18em]",
                    active ? "text-emerald-100/84" : "text-slate-500"
                  )}
                >
                  {active ? "Current" : "Lane"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
