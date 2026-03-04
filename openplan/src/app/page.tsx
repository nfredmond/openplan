import Link from "next/link";

const quickLinks = [
  {
    href: "/explore",
    title: "Run Corridor Analysis",
    description:
      "Upload a corridor and generate accessibility, safety, and equity scoring with export-ready outputs.",
    eyebrow: "Planner workflow",
  },
  {
    href: "/dashboard",
    title: "Open Workspace Dashboard",
    description:
      "Review run history, reload prior analyses, and keep decision-ready outputs in one place.",
    eyebrow: "Workspace",
  },
  {
    href: "/pricing",
    title: "View Pilot Pricing",
    description:
      "Review Starter and Professional plans with transparent pilot packaging and implementation notes.",
    eyebrow: "Commercial",
  },
  {
    href: "/sign-up",
    title: "Start a Pilot Workspace",
    description:
      "Create an account and stand up a live OpenPlan workspace for your next grant cycle.",
    eyebrow: "Pilot ready",
  },
];

const trustPoints = [
  "Grant-oriented scoring aligned to ATP / SS4A / RAISE framing",
  "Transparent methods and assumptions with client-safe disclosure language",
  "Exports built for review packets, reports, and GIS handoff",
  "Modular architecture that can be adapted to law, science, education, engineering, real estate, and more",
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
              OpenPlan · Corridor Intelligence
            </p>
            <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Grant-ready corridor analysis that looks as serious as the planning work behind it.
            </h1>
            <p className="max-w-2xl text-sm text-slate-200/85 sm:text-base">
              OpenPlan helps transportation teams move from boundary file to defensible scoring, narrative summary,
              and report packaging in minutes—while keeping methods transparent and reviewable. The same platform can
              be customized for any profession, including law, science, education, engineering, and real estate.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/explore"
                className="inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-100"
              >
                Launch Explore
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
