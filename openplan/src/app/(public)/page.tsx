import Link from "next/link";
import { ArrowRight, FileText, Map, MessageSquareText, ShieldCheck } from "lucide-react";
import { buildOpenPlanPublicMetadata } from "@/lib/public-page-metadata";

export const metadata = buildOpenPlanPublicMetadata({
  title: "Free, open-source planning software",
  description:
    "Apache-2.0 planning software for agencies, tribes, RTPAs, counties, cities, non-profits, and consultants anywhere in the United States. Free to use, free to self-host, no paid tier.",
  path: "/",
});


const sourceProofLinks = [
  {
    href: "https://github.com/nfredmond/openplan",
    label: "Source repository",
  },
  {
    href: "https://github.com/nfredmond/openplan/blob/main/LICENSE",
    label: "Apache-2.0 license text",
  },
];

/**
 * WHO THIS PAGE IS WRITTEN FOR.
 *
 * An assistant planner a few months out of a master's programme, who has never
 * heard of OpenPlan, is looking at it because someone sent a link, and has about
 * thirty seconds to work out whether it is worth a sign-up.
 *
 * The previous copy was written for the people building it: "surface areas",
 * "core lanes", "enter through the right lane", "a planning flow, not a feature
 * collage", "proof path for the Apache-2.0 claim", "the platform is built for
 * teams that need traceable planning work, not another static status page".
 * Every one of those is a sentence about the software's architecture, and none
 * of them says what a planner would actually DO with it on a Tuesday.
 *
 * The rule for anything added here: name the task a planner recognises, in the
 * words they would use at their own desk. "Study a corridor", "collect public
 * comments", "write the report". Not lanes, surfaces, ledgers or postures.
 *
 * The honesty stays, because it is the most useful thing on the page — it is
 * just said plainly now. "It tells you what it does not know" does the same work
 * as a paragraph about claim tiers, and a new graduate can act on it.
 */

const whatYouCanDo = [
  {
    title: "Study a corridor without losing the work",
    description:
      "Pick a street, a corridor, or a whole city. OpenPlan pulls census, jobs, transit and safety data for that exact area, scores it, and saves the run — so when someone asks in six months where a number came from, you can show them.",
  },
  {
    title: "Ask the public, and keep track of what they said",
    description:
      "Publish a map where residents drop a pin and tell you what is wrong with an intersection. You read every comment before it counts, and the comments stay attached to the project when you write it up.",
  },
  {
    title: "Get a first draft of the write-up",
    description:
      "Turn the analysis and the public comments into draft text you can edit — with the caveats already attached, so nothing quietly becomes more certain than it should on its way into a board packet.",
  },
];

const whereToStart = [
  {
    href: "/examples",
    label: "No account needed",
    title: "See a real example first",
    description:
      "A real screening run for a real place, with its caveats and its checks against observed traffic counts shown exactly as they were recorded. Look before you sign up.",
  },
  {
    href: "/sign-up?source=landing&intent=modeling",
    label: "About five minutes",
    title: "Run your first corridor study",
    description:
      "Make a free account, search for anywhere in the United States, and get a scored corridor with the data behind it. Your own city, not a demo county.",
  },
  {
    href: "/sign-up?source=landing&intent=engagement",
    label: "For a live project",
    title: "Collect public comments on a map",
    description:
      "Make a free account and publish a comment map for a project you are working on. Nothing a resident writes appears publicly until you approve it.",
  },
];

const theBasics = [
  {
    label: "Cost",
    value: "Free — all of it",
    detail:
      "No plans, no per-seat pricing, no limit you have to pay to lift. There is no payment step anywhere in the software.",
  },
  {
    label: "The code",
    value: "Apache-2.0, public",
    detail:
      "Anyone can read it, run it, and change it. If your agency wants it on its own servers instead of ours, that is allowed and documented.",
  },
  {
    label: "Getting started",
    value: "Sign up and you are in",
    detail:
      "Your workspace is ready immediately. No waiting list, no sales call, and nobody you have to talk to first.",
  },
];

const whatToExpect = [
  "You can read the code. The software behind a public planning decision should be something the public can inspect.",
  "Everyone gets everything. There is no paid tier that unlocks more of it, and no feature held back.",
  "You approve public comments before they count. Nothing a resident writes reaches a report without a person reading it first.",
  "It tells you what it does not know. Results are screening-grade — good for comparing options, setting priorities, and making a case, and not a substitute for engineering design or a CEQA determination.",
  "It works for your area, not a sample one. Pick any city, county, town or metro area in the United States. Where a data source genuinely does not cover you, it says so instead of showing an empty result.",
];

const theThreeParts = [
  {
    title: "Maps and analysis",
    description:
      "Choose a place, pull the public data for it, score it, and keep the run so you can come back to it.",
    icon: Map,
    accentClass: "text-[color:var(--accent)]",
  },
  {
    title: "Public engagement",
    description:
      "Collect comments on a map, review them yourself, and keep them tied to the project they belong to.",
    icon: MessageSquareText,
    accentClass: "text-[color:var(--pine)]",
  },
  {
    title: "Reports and grants",
    description:
      "Turn the work into a document, with the caveats already written in and the sources still attached.",
    icon: FileText,
    accentClass: "text-[color:var(--copper)]",
  },
];

export default function PublicLandingPage() {
  return (
    <div className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Free, open-source planning software</p>
          <div className="public-headline-block">
            <h1 className="public-title">Your maps, your public comments, and your report — in one place.</h1>
            <p className="public-lead max-w-4xl">
              OpenPlan is software for the work planners actually do: studying a corridor, asking the public what they think, keeping track of projects and grants, and writing the documents that come out of all of it. It is free, and the code is public. Used by city and county planners, MPOs and RTPAs, tribes, non-profits and consultants.
            </p>
          </div>

          <div className="public-source-proof" aria-label="Open-source proof path">
            <span>Do not take our word for it — read the code:</span>
            {sourceProofLinks.map((link) => (
              <Link key={link.href} href={link.href} className="public-source-proof-link">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="public-actions">
            <Link href="/sign-up?source=landing" className="public-primary-link">
              Create your free workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/sign-in" className="public-secondary-link">
              Sign in to existing workspace
            </Link>
          </div>
          <p className="public-fine-print mt-2 text-sm text-muted-foreground">
            Free and open source. Sign up and your workspace is ready immediately — no waiting
            list, no approval step, and no payment at any point.
          </p>

          <div className="public-fact-grid public-fact-grid--three">
            {theBasics.map((fact) => (
              <div key={fact.label} className="public-fact">
                <p className="public-fact-label">{fact.label}</p>
                <p className="public-fact-value">{fact.value}</p>
                <p className="public-fact-detail">{fact.detail}</p>
              </div>
            ))}
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Who it is for</p>
              <h2 className="public-rail-title">Planners, including the ones doing it alone</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            A one-person planning department, a regional agency, a tribal transportation office, a consultant with six clients. If you write corridor studies, run public meetings, or put grant applications together, this was built for that job.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">
              You do not need to be technical to use it, and you do not need permission from us to start.
            </div>
            <div className="public-rail-item">
              It says what it does not know. Where a number is uncertain or a data source does not cover your area, it tells you plainly rather than hiding it.
            </div>
            <div className="public-rail-item">
              Your data stays yours, and you can take it with you.
            </div>
          </div>
        </aside>
      </section>

      <section className="public-content-grid">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">What you can do with it</p>
              <h2 className="public-section-title">Three things planners use it for</h2>
            </div>
            <p className="public-section-description max-w-2xl">
              Most planning work starts with a question about a place and ends with a document somebody has to defend. OpenPlan is built for the middle.
            </p>
          </div>

          <div className="public-ledger">
            {whatYouCanDo.map((flow, index) => (
              <div key={flow.title} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  
                  <h3 className="public-ledger-title">{flow.title}</h3>
                  <p className="public-ledger-copy">{flow.description}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Where to start</p>
              <h2 className="public-section-title">Pick whichever is closest to your week</h2>
            </div>
            <p className="public-section-description max-w-xl">
              You can look at a finished example without signing up. The other two need a free account, which takes about a minute.
            </p>
          </div>

          <div className="public-ledger">
            {whereToStart.map((surface) => (
              <Link key={surface.href} href={surface.href} className="public-link-row">
                <div className="public-ledger-body">
                  <p className="public-ledger-label">{surface.label}</p>
                  <h3 className="public-ledger-title">{surface.title}</h3>
                  <p className="public-ledger-copy">{surface.description}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">What to expect</p>
              <h2 className="public-section-title">Straight answers before you sign up</h2>
            </div>
          </div>
          <div className="public-ledger">
            {whatToExpect.map((boundary, index) => (
              <div key={boundary} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{boundary}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">The three parts</p>
              <h2 className="public-section-title">How the software is put together</h2>
            </div>
          </div>
          <div className="public-ledger">
            {theThreeParts.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.title} className="public-ledger-row">
                  <div className="public-ledger-icon">
                    <Icon className={`h-4 w-4 ${lane.accentClass}`} />
                  </div>
                  <div className="public-ledger-body">
                    <h3 className="public-ledger-title">{lane.title}</h3>
                    <p className="public-ledger-copy">{lane.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
}
