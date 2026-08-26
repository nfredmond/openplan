import Link from "next/link";
import { BookOpen, ExternalLink, Gauge, LifeBuoy, Wrench } from "lucide-react";

import { APP_NAV_ENTRIES, buildRailGroups } from "@/components/nav/nav-registry";
import { MODULE_DESCRIPTIONS } from "@/lib/help/module-descriptions";
import {
  describePublishedErrorEnvelope,
  SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE,
  SCREENING_GRADE_SAFE_TO_CONCLUDE,
  SCREENING_GRADE_SUMMARY,
  SCREENING_GRADE_TITLE,
  SCREENING_GRADE_YOUR_RUN_NOTE,
} from "@/lib/help/screening-grade";
import { NEW_WORKSPACE_GETTING_STARTED_STEPS } from "@/lib/onboarding/getting-started";
import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata(
  "Help",
  "What OpenPlan is, what each module does, where the setup guides live, and who fixes what."
);

/**
 * The same repository the public contact page points at. The docs linked below
 * are written for whoever installs or operates OpenPlan; linking them from
 * inside the app means a planner can hand the right guide to that person
 * without leaving the product.
 */
const REPO_URL = "https://github.com/nfredmond/openplan";

const OPERATOR_DOCS = [
  {
    href: `${REPO_URL}/blob/main/README.md`,
    label: "Running OpenPlan on one computer",
    description:
      "The step-by-step install guide, assuming nothing — it walks through installing Node and Docker on Windows, macOS, and Linux.",
  },
  {
    href: `${REPO_URL}/blob/main/openplan/docs/FIRST_DEPLOYMENT.md`,
    label: "First deployment for a team",
    description:
      "A checklist for putting OpenPlan somewhere a whole team can reach it.",
  },
  {
    href: `${REPO_URL}/blob/main/openplan/docs/SELF_HOSTING.md`,
    label: "Self-hosting reference",
    description:
      "What every service OpenPlan uses is for, and what to check when something misbehaves.",
  },
] as const;

export default function HelpPage() {
  const groups = buildRailGroups();
  const specialistPages = APP_NAV_ENTRIES.filter((entry) => entry.railHidden);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <div className="module-intro-card">
          <div className="module-intro-kicker">Help</div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">What OpenPlan is, and how it fits together</h1>
            <p className="module-intro-description">
              OpenPlan is a free, open-source workbench for the people who plan communities —
              regional agencies, cities, counties, tribes, consultancies, and independent planners.
              It brings transportation analysis, community engagement, and project and grant
              management into one place, so a piece of work moves between them without being
              re-entered. Everything in it is free: there is no paid tier and no payment step.
            </p>
          </div>
        </div>
      </header>

      {/* Getting started: the same list the workspace bootstrap API returns,
          rendered where a person can actually read it. */}
      <article className="mt-6 module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Getting started</p>
            <h2 className="module-section-title">The first things to do in a new workspace</h2>
            <p className="module-section-description">
              Six steps, in order. The Overview page tracks the state of the most important ones.
            </p>
          </div>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-sm text-foreground/90">
          {NEW_WORKSPACE_GETTING_STARTED_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      {/*
        THE ONE DEFINITION OF "SCREENING-GRADE".
        Every badge, caveat, and popover carrying that phrase links here. The
        error envelope is COMPUTED from the published example records
        (`describePublishedErrorEnvelope`) rather than typed, so publishing a
        new validation example updates this page and /legal together — and no
        page can quietly keep quoting an old ceiling.
      */}
      <article id="screening-grade" className="mt-6 module-section-surface scroll-mt-24">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">
              <Gauge className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              Reading results
            </p>
            <h2 className="module-section-title">{SCREENING_GRADE_TITLE}</h2>
            <p className="module-section-description">{SCREENING_GRADE_SUMMARY}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              What you can conclude from it
            </h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-6 text-sm leading-6 text-foreground/90">
              {SCREENING_GRADE_SAFE_TO_CONCLUDE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              What it is not
            </h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-6 text-sm leading-6 text-foreground/90">
              {SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5 rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            How far off it can be
          </h3>
          <p className="mt-2 text-sm leading-6 text-foreground/90">
            {describePublishedErrorEnvelope()}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {SCREENING_GRADE_YOUR_RUN_NOTE}
          </p>
        </div>

        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The formal version of this boundary — what an agency is agreeing to when it publishes
          something OpenPlan produced — is in the{" "}
          <a
            href="/legal"
            className="font-semibold underline underline-offset-4 hover:text-foreground"
          >
            legal notice
          </a>
          .
        </p>
      </article>

      {/* Which features run on an AI key. The list mirrors the workspace setup
          checklist's "Turn on your AI assistant" step — two different accounts
          of the same boundary would be two things to keep true. */}
      <article className="mt-6 module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">AI features</p>
            <h2 className="module-section-title">Which features need an AI key</h2>
            <p className="module-section-description">
              OpenPlan itself is free. Its AI features run on an AI-provider (Anthropic) key that is
              your workspace&apos;s own account with that provider — usage is billed by the
              provider, not by OpenPlan.
            </p>
          </div>
        </div>
        <ul className="mt-4 list-disc space-y-1.5 pl-6 text-sm text-foreground/90">
          <li>The Planner Agent — the in-app assistant that answers from your workspace&apos;s own records.</li>
          <li>AI synthesis of public comments collected through engagement campaigns.</li>
          <li>Narrative drafting for reports and grant applications.</li>
          <li>Comment translation on public engagement portals.</li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Everything else works without a key, and pages say plainly when an AI feature is
          unavailable rather than sitting silent. A workspace owner or admin adds the key on the{" "}
          <Link
            href="/workspace#workspace-ai-key"
            className="font-semibold underline underline-offset-4 hover:text-foreground"
          >
            Workspace setup &amp; health page
          </Link>{" "}
          or its Integration keys panel; a deployment-wide key set by whoever operates this
          deployment works too.
        </p>
      </article>

      {/* The modules, using the nav's own labels and groups so this page can
          never disagree with the rail about what a module is called. */}
      <article className="mt-6 module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">The modules</p>
            <h2 className="module-section-title">What each part of OpenPlan does</h2>
            <p className="module-section-description">
              Grouped the same way as the navigation rail on the left.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-6">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </h3>
              <ul className="mt-2 divide-y divide-border/60">
                {group.items.map((item) => (
                  <li key={item.href} className="py-3">
                    <Link
                      href={item.href}
                      className="text-sm font-semibold text-foreground hover:underline"
                    >
                      {item.label}
                    </Link>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {MODULE_DESCRIPTIONS[item.href] ??
                        "No description has been written for this module yet."}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {specialistPages.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Specialist modeling pages
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                These pages are part of Travel modeling and remain available from the command palette without adding a second rail.
              </p>
              <ul className="mt-2 divide-y divide-border/60">
                {specialistPages.map((item) => (
                  <li key={item.href} className="py-3">
                    <Link href={item.href} className="text-sm font-semibold text-foreground hover:underline">
                      {item.label}
                    </Link>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{MODULE_DESCRIPTIONS[item.href]}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </article>

      {/* Who fixes what. Worded so a planner knows which problems are theirs
          to solve and which belong to whoever runs the deployment. */}
      <article className="mt-6 module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">
              <Wrench className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              When something is switched off
            </p>
            <h2 className="module-section-title">
              Some fixes need whoever operates this deployment
            </h2>
          </div>
        </div>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            OpenPlan is software your organization (or a host acting for it) runs on a server. A
            few capabilities — maps, AI assistance, Census-backed equity data, the modeling worker
            that executes large runs — depend on keys and services that are set up on that server,
            not inside these pages. When one of them is missing, the affected pages say so plainly
            instead of showing an empty result.
          </p>
          <p>
            If you see a message that a capability is <em>switched off or limited by
            configuration</em>, nothing about your account, your data, or your area caused it, and
            nothing you can click in the app will fix it. Copy the message and hand it to whoever
            operates this deployment — your IT staff, the consultant who set OpenPlan up, or
            whoever installed it. Each message names exactly what to change, and none of the fixes
            cost anything: OpenPlan itself is free, and the keys it uses have free tiers that cover
            normal planning work.
          </p>
        </div>
      </article>

      {/* The operator guides, linked from inside the app so a planner can hand
          the right document to the right person. */}
      <article className="mt-6 module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">
              <BookOpen className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              Guides
            </p>
            <h2 className="module-section-title">Setup and operating guides</h2>
            <p className="module-section-description">
              Written for whoever installs or runs OpenPlan. They open on GitHub, where the
              OpenPlan source code lives.
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-border/60">
          {OPERATOR_DOCS.map((doc) => (
            <li key={doc.href} className="py-3">
              <a
                href={doc.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:underline"
              >
                {doc.label}
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </a>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{doc.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
          <LifeBuoy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Found something wrong, or something this page does not answer? OpenPlan is open
            source — questions and problem reports go to{" "}
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              the project&apos;s issue tracker
            </a>
            , and anyone can file one.
          </span>
        </p>
      </article>
    </section>
  );
}
