import Link from "next/link";

const quickLinks = [
  {
    href: "/explore",
    title: "Explore maps and analysis",
    description: "Review corridors, overlays, run history, and share-ready visuals in one place.",
  },
  {
    href: "/projects",
    title: "Manage projects",
    description: "Keep planning projects, linked records, and delivery progress organized across the workspace.",
  },
  {
    href: "/engagement",
    title: "Review public input",
    description: "Track comments, categories, moderation status, and summary-ready engagement records.",
  },
];

export default function PublicLandingPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(30,64,175,0.16),_transparent_48%),linear-gradient(180deg,_#f8fbff_0%,_#eef5ff_100%)] text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-10 px-6 py-20 sm:px-10 lg:px-12">
        <div className="max-w-3xl space-y-6">
          <span className="inline-flex items-center rounded-full border border-sky-200/80 bg-white/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-800 shadow-sm">
            OpenPlan
          </span>
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl">
              Planning software for maps, projects, engagement, and reports.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
              OpenPlan helps planning teams move from a corridor question to a clear deliverable with maps, project context,
              public input, and reporting tools in one connected workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500"
            >
              Sign in
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
            >
              View pricing
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_26px_60px_-34px_rgba(14,116,144,0.35)]"
            >
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">OpenPlan</p>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 group-hover:text-sky-800">
                    {link.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{link.description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
