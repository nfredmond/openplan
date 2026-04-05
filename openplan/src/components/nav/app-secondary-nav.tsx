"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type SecondarySection = {
  title: string;
  description: string;
  items: Array<{ href: string; label: string; description: string }>;
};

const sectionMap: Array<{
  match: string[];
  section: SecondarySection;
}> = [
  {
    match: ["/dashboard"],
    section: {
      title: "Overview",
      description: "Start here for workspace signal, then step into the lane that matches the work.",
      items: [
        { href: "/dashboard", label: "Workspace Dashboard", description: "Top-level KPIs and current workspace posture." },
        { href: "/projects", label: "Projects Board", description: "Move from overview into active project control rooms." },
        { href: "/reports", label: "Recent Reports", description: "Review export posture and packet freshness." },
      ],
    },
  },
  {
    match: ["/explore"],
    section: {
      title: "Analysis Studio",
      description: "Use this cluster when producing evidence and pushing it downstream into reports.",
      items: [
        { href: "/explore", label: "Corridor Analysis", description: "Run and review corridor analysis work." },
        { href: "/scenarios", label: "Scenario Workspace", description: "Compare and organize scenario sets." },
        { href: "/reports", label: "Report Outputs", description: "Package the resulting evidence into deliverables." },
      ],
    },
  },
  {
    match: ["/projects"],
    section: {
      title: "Projects",
      description: "Portfolio and delivery context for the rest of the authenticated shell.",
      items: [
        { href: "/projects", label: "All Projects", description: "Portfolio records and project-level attention signals." },
        { href: "/plans", label: "Linked Plans", description: "Plan records attached to project delivery." },
        { href: "/programs", label: "Funding Programs", description: "Funding-cycle context and program coordination." },
      ],
    },
  },
  {
    match: ["/plans", "/programs"],
    section: {
      title: "Planning System",
      description: "Structured planning records with adjacent engagement and program surfaces.",
      items: [
        { href: "/plans", label: "Plans", description: "Plan inventory, records, and linked work." },
        { href: "/programs", label: "Programs & Cycles", description: "Program structure and cycle tracking." },
        { href: "/engagement", label: "Engagement", description: "Public-facing input and moderation workflows." },
      ],
    },
  },
  {
    match: ["/engagement"],
    section: {
      title: "Engagement",
      description: "Campaign operations, public input handling, and downstream reporting.",
      items: [
        { href: "/engagement", label: "Campaigns", description: "Manage campaigns, intake, and moderation." },
        { href: "/reports", label: "Outreach Reports", description: "Convert engagement evidence into share-safe outputs." },
        { href: "/data-hub", label: "Imported Datasets", description: "Check supporting inputs and attached data." },
      ],
    },
  },
  {
    match: ["/scenarios", "/models", "/data-hub", "/county-runs"],
    section: {
      title: "Modeling & Data",
      description: "Evidence-production routes, including county validation and related data surfaces.",
      items: [
        { href: "/scenarios", label: "Scenarios", description: "Scenario sets and comparison context." },
        { href: "/models", label: "Models", description: "Managed model records and run posture." },
        { href: "/county-runs", label: "County Validation", description: "County onboarding, scaffolds, and validation posture." },
        { href: "/data-hub", label: "Data Hub", description: "Imported inputs and operational datasets." },
      ],
    },
  },
  {
    match: ["/reports", "/billing", "/admin"],
    section: {
      title: "Operations",
      description: "Commercial controls and pilot-readiness surfaces for the supervised launch posture.",
      items: [
        { href: "/reports", label: "Reports", description: "Packet readiness and export surfaces." },
        { href: "/billing", label: "Billing", description: "Invoices, plan posture, and payment controls." },
        { href: "/admin", label: "Admin", description: "Workspace controls and staged admin modules." },
        { href: "/admin/pilot-readiness", label: "Pilot Readiness", description: "Smoke evidence, proof packets, and launch diligence." },
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
      <p className="mt-1.5 text-[0.76rem] leading-relaxed text-slate-300/72">{section.description}</p>
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
                  <span className={cn("mt-1 block text-[0.72rem] leading-relaxed", active ? "text-slate-200/78" : "text-slate-400")}>
                    {item.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
