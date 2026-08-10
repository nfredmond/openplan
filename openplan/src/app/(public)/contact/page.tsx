import Link from "next/link";
import { ArrowRight, ClipboardCheck, Github } from "lucide-react";

export const metadata = {
  // No product name here: the root layout appends it via `title.template`.
  title: "Contact",
  description:
    "Get in touch about OpenPlan — questions, bug reports, and feedback from planners using the software.",
};

const REPO_URL = "https://github.com/nfredmond/openplan";

export default function ContactPage() {
  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Contact</p>
          <div className="public-headline-block">
            <h1 className="public-title">Questions, bug reports, and feedback.</h1>
            <p className="public-lead max-w-4xl">
              You do not need to contact anyone to use OpenPlan — it is free and open source, and
              signing up creates your workspace immediately. Use this if something is broken,
              something is unclear, or you want to tell us what planners in your agency actually
              need.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/sign-up" className="public-primary-link">
              Create your free workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={`${REPO_URL}/issues`}
              className="public-secondary-link"
              rel="noopener noreferrer"
            >
              File an issue on GitHub
            </a>
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ClipboardCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Nothing is gated</p>
              <h2 className="public-rail-title">This is not a way to get access.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            There is no access queue, no approval step, and no payment. Sign up and the software is
            yours to use. OpenPlan is open source — issues and pull requests on the repository are
            welcome too, and are often the fastest route for a bug.
          </p>
        </aside>
      </section>

      <section className="public-surface">
        <div className="public-section-header">
          <div>
            <p className="public-section-label">Where to reach the project</p>
            <h2 className="public-section-title">Everything goes through the repository.</h2>
          </div>
          <p className="public-section-description max-w-2xl">
            OpenPlan has no support desk and no intake queue. The repository is the front door for
            every kind of message, and it is public, so answers help the next planner too.
          </p>
        </div>
        <div className="public-ledger">
          <div className="public-ledger-row">
            <div className="public-ledger-icon">
              <Github className="h-4 w-4 text-[color:var(--accent)]" />
            </div>
            <div className="public-ledger-body">
              <p className="public-ledger-label">Bugs and feature requests</p>
              <p className="public-ledger-copy">
                Open an issue at{" "}
                <a
                  href={`${REPO_URL}/issues`}
                  className="underline underline-offset-4 hover:text-foreground"
                  rel="noopener noreferrer"
                >
                  github.com/nfredmond/openplan/issues
                </a>
                . Include what you did, what you expected, and what happened instead — and whether
                you were on a local dev server or a self-hosted deployment.
              </p>
            </div>
          </div>
          <div className="public-ledger-row">
            <div className="public-ledger-icon">
              <Github className="h-4 w-4 text-[color:var(--accent)]" />
            </div>
            <div className="public-ledger-body">
              <p className="public-ledger-label">Security reports</p>
              <p className="public-ledger-copy">
                Report vulnerabilities privately through GitHub Security Advisories on the
                repository — see <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">SECURITY.md</code>.
                Never put exploitable details in a public issue.
              </p>
            </div>
          </div>
          <div className="public-ledger-row">
            <div className="public-ledger-icon">
              <Github className="h-4 w-4 text-[color:var(--accent)]" />
            </div>
            <div className="public-ledger-body">
              <p className="public-ledger-label">Everything else</p>
              <p className="public-ledger-copy">
                Feedback on what your agency actually needs, questions about self-hosting, and
                contributions all belong on the repository too — start with{" "}
                <a
                  href={REPO_URL}
                  className="underline underline-offset-4 hover:text-foreground"
                  rel="noopener noreferrer"
                >
                  the README
                </a>{" "}
                and <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">CONTRIBUTING.md</code>.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
