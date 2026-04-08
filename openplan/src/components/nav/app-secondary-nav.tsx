"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type SecondarySection = {
  title: string;
  items: Array<{ href: string; label: string }>;
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
        { href: "/plans", label: "Plans" },
        { href: "/programs", label: "Programs" },
      ],
    },
  },
  {
    match: ["/plans", "/programs"],
    section: {
      title: "Planning System",
      items: [
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
      items: [
        { href: "/reports", label: "Reports" },
        { href: "/billing", label: "Billing" },
        { href: "/admin", label: "Admin" },
        { href: "/admin/pilot-readiness", label: "Pilot Readiness" },
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
    <div className="rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.018))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <p className="text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-slate-400">{section.title}</p>
      <ul className="mt-3 space-y-1.5">
        {section.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex rounded-xl px-2.5 py-2.5 transition-all duration-200",
                  active
                    ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.05))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "text-slate-300/70 hover:bg-white/[0.04] hover:text-white"
                )}
              >
                <span className="min-w-0">
                  <span className="block text-[0.82rem] font-medium">{item.label}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
