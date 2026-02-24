import Link from "next/link";

const quickLinks = [
  {
    href: "/explore",
    title: "Explore Use Cases",
    description: "Review corridor planning workflows and MVP positioning.",
  },
  {
    href: "/dashboard",
    title: "Workspace Dashboard",
    description: "Access your planning workspace and active projects.",
  },
  {
    href: "/sign-up",
    title: "Create Account",
    description: "Start a pilot workspace for your transportation team.",
  },
];

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Sprint 0
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          OpenPlan MVP foundation
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
          OpenPlan is a transportation planning SaaS focused on corridor analysis,
          scenario comparisons, and grant-ready planning outputs.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30"
          >
            <h2 className="text-base font-semibold">{link.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{link.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
