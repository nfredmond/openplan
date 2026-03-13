import Link from "next/link";

const quickLinks = [
  {
    href: "/explore",
    title: "Open Analysis Studio",
    description:
      "Step into the new left-nav app shell and use the existing corridor intelligence workflow as one module inside the Planning OS.",
    eyebrow: "App shell",
  },
  {
    href: "/dashboard",
    title: "View Platform Overview",
    description:
      "See the operator-grade workspace shell, module navigation, and current implementation baseline.",
    eyebrow: "Workspace",
  },
  {
    href: "/pricing",
    title: "Review Pilot Pricing",
    description:
      "Inspect current pilot packaging for the platform foundation and Analysis Studio module.",
    eyebrow: "Commercial",
  },
  {
    href: "/sign-up",
    title: "Start a Pilot Workspace",
    description:
      "Create an account and begin with the current platform shell while the full Planning OS modules come online.",
    eyebrow: "Pilot ready",
  },
];

const trustPoints = [
  "Planning OS direction: projects, plans, programs, engagement, analysis, and reporting in one shell",
  "Analysis Studio already live for corridor intelligence, scoring, and export-ready outputs",
  "Transparent methods and assumptions with client-safe disclosure language",
  "Modular architecture designed to grow into engagement, scenario, model, and data-hub workflows",
];

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 px-6 py-8 text-slate-100 shadow-2xl shadow-slate-900/20 sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-12 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />

        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.9fr] lg:items-end">
          <div className="space-y-5">
            <p className="inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/90">
              OpenPlan · Planning OS + Analysis Studio
            </p>
            <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              A planning operating system for agencies, commissions, consultants, and public-facing workflows.
            </h1>
            <p className="max-w-2xl text-sm text-slate-200/85 sm:text-base">
              OpenPlan is being rebuilt as a multi-module Planning OS. The current Analysis Studio already supports
              corridor intelligence and reporting, while the broader platform grows toward projects, plans, programs,
              engagement, scenarios, data, and managed model workflows.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/explore"
                className="inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-100"
              >
                Open Analysis Studio
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center rounded-full border border-white/25 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Create Pilot Account
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/80">Why teams adopt</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-100/90">
              {trustPoints.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-200" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-2xl border border-border/70 bg-card/80 p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{link.eyebrow}</p>
            <h2 className="mt-2 text-base font-semibold tracking-tight text-foreground group-hover:text-teal-700 dark:group-hover:text-cyan-300">
              {link.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{link.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
