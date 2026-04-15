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
    <div className="px-3 pt-1 pb-2">
      <p className="mb-1.5 px-2 text-[0.62rem] font-bold uppercase tracking-[0.2em] text-slate-600">
        {section.title}
      </p>
      <ul className="space-y-0.5">
        {section.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "block rounded px-2 py-1.5 text-[0.8rem] transition-colors duration-150",
                  active
                    ? "bg-white/[0.07] text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
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
