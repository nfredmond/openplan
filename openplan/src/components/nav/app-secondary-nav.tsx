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
        { href: "/projects", label: "Projects Board" },
        { href: "/reports", label: "Recent Reports" },
      ],
    },
  },
  {
    match: ["/explore"],
    section: {
      title: "Analysis Studio",
      items: [
        { href: "/explore", label: "Corridor Analysis" },
        { href: "/scenarios", label: "Scenario Workspace" },
        { href: "/reports", label: "Report Outputs" },
      ],
    },
  },
  {
    match: ["/projects"],
    section: {
      title: "Projects",
      items: [
        { href: "/projects", label: "All Projects" },
        { href: "/plans", label: "Linked Plans" },
        { href: "/programs", label: "Funding Programs" },
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
    match: ["/scenarios", "/models", "/data-hub"],
    section: {
      title: "Modeling & Data",
      items: [
        { href: "/scenarios", label: "Scenarios" },
        { href: "/models", label: "Managed Runs" },
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
      <ul className="mt-2.5 space-y-1">
        {section.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center rounded-xl px-2.5 py-2 text-[0.82rem] transition-all duration-200",
                  active
                    ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.05))] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "text-slate-300/70 hover:bg-white/[0.04] hover:text-white"
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
