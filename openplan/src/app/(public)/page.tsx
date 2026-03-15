import Link from "next/link";

const quickLinks = [
  {
    href: "/explore",
    title: "Open Analysis Studio",
    description:
      "Step into the operator-grade app shell and use corridor intelligence, Census overlays, and crash-safety layers inside the Planning OS.",
    eyebrow: "App shell",
  },
  {
    href: "/dashboard",
    title: "View Platform Overview",
    description:
      "See the workspace shell, module navigation, and live KPI instrumentation for your planning workloads.",
    eyebrow: "Workspace",
  },
  {
    href: "/pricing",
    title: "Review Pilot Pricing",
    description:
      "Inspect transparent pilot packaging for the platform foundation and Analysis Studio module.",
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
    <section className="space-y-10">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-3xl border border-[color:color-mix(in_srgb,var(--line)_50%,var(--pine)_20%)] bg-gradient-to-br from-[color:var(--pine-deep)] via-[color:color-mix(in_srgb,var(--pine-deep)_82%,var(--background)_18%)] to-[color:color-mix(in_srgb,var(--pine)_60%,var(--ink)_40%)] px-6 py-10 text-white shadow-[0_32px_80px_rgba(14,30,20,0.22)] sm:px-10 sm:py-12">
        {/* Glow accents — using pine & copper to stay on-palette */}
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-[color:color-mix(in_srgb,var(--pine)_28%,transparent)] blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-28 left-12 h-72 w-72 rounded-full bg-[color:color-mix(in_srgb,var(--copper)_22%,transparent)] blur-[90px]" />

        <div className="relative grid gap-10 lg:grid-cols-[1.3fr_0.85fr] lg:items-end">
          <div className="space-y-6">
            <p className="animate-fade-up inline-flex rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[color:color-mix(in_srgb,var(--copper)_72%,white)]">
              OpenPlan · Planning OS + Analysis Studio
            </p>
            <h1 className="animate-fade-up max-w-2xl font-display text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl lg:text-[2.8rem]" style={{ animationDelay: "80ms" }}>
              A planning operating system for agencies, commissions, consultants, and public-facing workflows.
            </h1>
            <p className="animate-fade-up max-w-2xl text-[0.94rem] leading-relaxed text-white/80" style={{ animationDelay: "160ms" }}>
              OpenPlan is being rebuilt as a multi-module Planning OS. The current Analysis Studio already supports
              corridor intelligence and reporting, while the broader platform grows toward projects, plans, programs,
              engagement, scenarios, data, and managed model workflows.
            </p>
            <div className="animate-fade-up flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
              <Link
                href="/explore"
                className="inline-flex items-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[color:var(--pine-deep)] shadow-sm transition-all duration-200 hover:bg-[color:color-mix(in_srgb,var(--copper)_14%,white)] hover:shadow-md"
              >
                Open Analysis Studio
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:border-white/40 hover:bg-white/10"
              >
                Create Pilot Account
              </Link>
            </div>
          </div>

          <div className="animate-fade-up rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-sm" style={{ animationDelay: "200ms" }}>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:color-mix(in_srgb,var(--copper)_65%,white)]">Why teams adopt</p>
            <ul className="mt-3.5 space-y-2.5 text-[0.88rem] leading-relaxed text-white/85">
              {trustPoints.map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--copper)]" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Quick-link cards ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {quickLinks.map((link, i) => (
          <Link
            key={link.href}
            href={link.href}
            className="animate-fade-up group rounded-2xl border border-border/70 bg-card/80 p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--pine)_40%,var(--line))] hover:shadow-[0_16px_40px_rgba(20,33,43,0.10)]"
            style={{ animationDelay: `${320 + i * 80}ms` }}
          >
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{link.eyebrow}</p>
            <h2 className="mt-2.5 text-base font-semibold tracking-tight text-foreground transition-colors group-hover:text-[color:var(--pine)]">
              {link.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{link.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
