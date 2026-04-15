import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

type ModulePlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export function ModulePlaceholderPage({
  eyebrow,
  title,
  description,
  bullets,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: ModulePlaceholderPageProps) {
  return (
    <section className="space-y-6">
      <header className="relative overflow-hidden rounded-[0.75rem] border border-border/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.94))] p-6 shadow-[0_22px_56px_rgba(4,12,20,0.08)] sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(207,218,226,0.24),rgba(255,255,255,0))]"
        />
        <div className="relative inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
        <div className="relative mt-3 space-y-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{description}</p>
        </div>
        {(primaryHref && primaryLabel) || (secondaryHref && secondaryLabel) ? (
          <div className="relative flex flex-wrap gap-3 pt-4">
            {primaryHref && primaryLabel ? (
              <Link
                href={primaryHref}
                className="inline-flex items-center gap-2 rounded-full bg-[color:var(--pine)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--pine-deep)]"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
            {secondaryHref && secondaryLabel ? (
              <Link
                href={secondaryHref}
                className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/85 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:text-primary"
              >
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[0.75rem] border border-border/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(255,255,255,0.92))] p-6 shadow-[0_22px_56px_rgba(4,12,20,0.08)]">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">What belongs here</p>
          <ul className="mt-4 space-y-3">
            {bullets.map((bullet) => (
              <li key={bullet} className="rounded-[0.5rem] border border-border/70 bg-background/75 px-4 py-3 text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                {bullet}
              </li>
            ))}
          </ul>
        </article>

        <article className="relative overflow-hidden rounded-[0.75rem] border border-border/70 bg-[linear-gradient(180deg,rgba(13,24,34,0.97),rgba(8,15,21,0.95))] p-6 text-slate-100 shadow-[0_30px_70px_rgba(0,0,0,0.24)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0))]"
          />
          <p className="relative text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Planning OS signal</p>
          <h2 className="relative mt-3 text-xl font-semibold tracking-tight">This module is now part of the full platform shell</h2>
          <p className="relative mt-3 text-sm text-slate-300/85">
            The immediate goal is to make OpenPlan feel and behave like a serious planning operations platform, not a landing page with tools attached.
          </p>
          <div className="relative mt-5 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            Next implementation wave: bind these views to first-class Planning OS objects, shared filters, audit history, and project-scoped workflows.
          </div>
        </article>
      </div>
    </section>
  );
}
