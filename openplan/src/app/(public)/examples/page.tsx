import Link from "next/link";
import { AlertTriangle, FileSearch, MapPin, ShieldCheck } from "lucide-react";
import { buildOpenPlanPublicMetadata } from "@/lib/public-page-metadata";
import {
  NEVADA_COUNTY_BUYER_EVIDENCE_BRIEF as buyerEvidenceBrief,
  NEVADA_COUNTY_CAVEATS_VERBATIM as caveatsVerbatim,
  NEVADA_COUNTY_FACILITY_RANKING as facilityRanking,
  NEVADA_COUNTY_RUN_CONTEXT as runContext,
  NEVADA_COUNTY_SCREENING_GATE as screeningGate,
  NEVADA_COUNTY_VALIDATION_METRICS as validationMetrics,
  buildNevadaCountyBuyerEvidenceBriefText,
} from "@/lib/examples/nevada-county-2026-03-24";

export const metadata = buildOpenPlanPublicMetadata({
  title: "Evidence catalog: screening proof with caveats intact",
  description:
    "Inspect a real Nevada County screening run with validation metrics, caveats, and prototype-only limits preserved for buyer-safe review.",
  path: "/examples",
});

export default function ExamplesEvidenceCatalogPage() {
  const buyerEvidenceBriefText = buildNevadaCountyBuyerEvidenceBriefText();

  return (
    <div className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">OpenPlan evidence catalog</p>
          <div className="public-headline-block">
            <h1 className="public-title">
              A transparent record of what OpenPlan has actually run — caveats intact.
            </h1>
            <p className="public-lead max-w-4xl">
              This is not a product tour and not a forecasting claim. It is a transparency-first look
              at one real screening run (Nevada County, 2026-03-24), with the same validation
              metrics, caveats, and prototype-only gate the platform enforces internally.
            </p>
          </div>

          <div className="public-fact-grid public-fact-grid--three">
            <div className="public-fact">
              <p className="public-fact-label">Current status</p>
              <p className="public-fact-value">Internal prototype only</p>
              <p className="public-fact-detail">
                Not production-ready forecasting. No outward modeling claims are made from this
                run.
              </p>
            </div>
            <div className="public-fact">
              <p className="public-fact-label">What is shown</p>
              <p className="public-fact-value">One completed run, verbatim</p>
              <p className="public-fact-detail">
                Five-station Caltrans validation, facility ranking, APE distribution, and screening
                gate pulled from the artifact.
              </p>
            </div>
            <div className="public-fact">
              <p className="public-fact-label">AI disclosure</p>
              <p className="public-fact-value">Drafting + QA only</p>
              <p className="public-fact-detail">
                AI accelerates drafting, data cleaning, and QA. Client-critical conclusions require
                qualified human review.
              </p>
            </div>
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Why this page exists</p>
              <h2 className="public-rail-title">Honest proof beats glossy previews</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            A marketing PDF that softened the max APE (237.62%) or hid the caveats would violate
            the Nat Ford covenant. This page is the opposite: it puts the hardest numbers on top
            and preserves the screening gate as written.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">
              Caveats are quoted verbatim from the validation artifact, not paraphrased.
            </div>
            <div className="public-rail-item">
              The screening gate is displayed as the run recorded it — internal prototype only.
              See the{" "}
              <Link href="/legal" className="underline underline-offset-4 hover:text-foreground">
                legal notice
              </Link>{" "}
              for what that label authorizes and forbids.
            </div>
            <div className="public-rail-item">
              Coverage here is narrow by design. More runs enter the catalog only when their gate
              status supports it.
            </div>
          </div>
        </aside>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Example · Nevada County</p>
              <h2 className="public-section-title">Screening runtime vs. Caltrans 2023 counts</h2>
            </div>
            <p className="public-section-description max-w-2xl">
              One AequilibraE screening run against a five-station Caltrans priority-count subset
              on the Grass Valley corridor. What we ran, what it matched, and where it diverged.
            </p>
          </div>

          <div className="public-ledger">
            <div className="public-ledger-row">
              <div className="public-ledger-icon">
                <MapPin className="h-4 w-4 text-[color:var(--pine)]" />
              </div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Run context</p>
                <h3 className="public-ledger-title">{runContext.runId}</h3>
                <p className="public-ledger-copy">
                  Engine: {runContext.engine}. Counts source: {runContext.countsSource}. Artifact
                  generated {runContext.createdAt}.
                </p>
              </div>
            </div>

            <div className="public-ledger-row">
              <div className="public-ledger-icon">
                <FileSearch className="h-4 w-4 text-[color:var(--accent)]" />
              </div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Validation metrics</p>
                <h3 className="public-ledger-title">Absolute percent error + facility ranking</h3>
                <div className="mt-3 overflow-hidden rounded-lg border border-border/60">
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {validationMetrics.map((row) => (
                        <tr key={row.label} className="border-b border-border/50 last:border-b-0">
                          <th className="w-1/2 bg-muted/30 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {row.label}
                          </th>
                          <td className="px-3 py-2 text-foreground">
                            <span className="font-semibold">{row.value}</span>
                            {row.note ? (
                              <span className="mt-1 block text-xs text-muted-foreground">{row.note}</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="public-ledger-row">
              <div className="public-ledger-icon">
                <FileSearch className="h-4 w-4 text-[color:var(--accent)]" />
              </div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Facility ranking (observed vs. modeled)</p>
                <h3 className="public-ledger-title">Five Caltrans 2023 priority stations</h3>
                <div className="mt-3 overflow-hidden rounded-lg border border-border/60">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/30 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="px-3 py-2 text-left">Station</th>
                        <th className="px-3 py-2 text-right">Observed</th>
                        <th className="px-3 py-2 text-right">Modeled daily PCE</th>
                        <th className="px-3 py-2 text-right">Obs rank</th>
                        <th className="px-3 py-2 text-right">Mod rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facilityRanking.map((row) => (
                        <tr key={row.station} className="border-b border-border/50 last:border-b-0">
                          <td className="px-3 py-2 text-foreground">{row.station}</td>
                          <td className="px-3 py-2 text-right text-foreground">{row.observed}</td>
                          <td className="px-3 py-2 text-right text-foreground">{row.modeled}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{row.obsRank}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{row.modRank}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Gate + caveats</p>
              <h2 className="public-section-title">What the run itself says about itself</h2>
            </div>
            <p className="public-section-description max-w-xl">
              Lifted verbatim from the validation artifact so the language cannot drift between the
              internal record and this public page.
            </p>
          </div>

          <div className="public-ledger">
            <div className="public-ledger-row">
              <div className="public-ledger-icon">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
              </div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Screening gate</p>
                <h3 className="public-ledger-title">{screeningGate.statusLabel}</h3>
                <p className="public-ledger-copy">{screeningGate.reason}</p>
              </div>
            </div>

            <div className="public-ledger-row">
              <div className="public-ledger-icon">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
              </div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Model caveats (verbatim)</p>
                <h3 className="public-ledger-title">What the screening run explicitly is not</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {caveatsVerbatim.map((caveat) => (
                    <li key={caveat}>{caveat}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="public-ledger-row">
              <div className="public-ledger-icon">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
              </div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Reference</p>
                <h3 className="public-ledger-title">Full internal proof record</h3>
                <p className="public-ledger-copy">
                  The repository proof doc (with workflow, runtime commands, artifact paths,
                  and the same numbers) lives at{" "}
                  <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">
                    docs/ops/2026-04-18-modeling-nevada-county-live-proof.md
                  </code>{" "}
                  inside the repository.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
            This page is generated from a single validation artifact snapshot. If the underlying
            run is re-validated or superseded, this page should be updated or removed — it is not
            a guarantee of current runtime state.
          </p>
        </article>
      </section>

      <section id="nevada-county-buyer-evidence-brief" className="public-surface scroll-mt-24">
        <div className="public-section-header">
          <div>
            <p className="public-section-label">Copyable buyer evidence brief</p>
            <h2 className="public-section-title">{buyerEvidenceBrief.title}</h2>
          </div>
          <p className="public-section-description max-w-2xl">
            {buyerEvidenceBrief.buyerUse} Keep this brief attached to the caveats; it is a static
            screening-run snapshot for supervised review, not a broader capability claim.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="public-ledger">
            <div className="public-ledger-row">
              <div className="public-ledger-index">01</div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Posture</p>
                <p className="public-ledger-copy text-foreground">{buyerEvidenceBrief.posture}</p>
              </div>
            </div>
            <div className="public-ledger-row">
              <div className="public-ledger-index">02</div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Not proof of</p>
                <p className="public-ledger-copy text-foreground">{buyerEvidenceBrief.notProofOf}</p>
              </div>
            </div>
            <div className="public-ledger-row">
              <div className="public-ledger-index">03</div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Next step</p>
                <p className="public-ledger-copy text-foreground">{buyerEvidenceBrief.nextStep}</p>
              </div>
            </div>
          </div>
          <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
            {buyerEvidenceBriefText}
          </pre>
        </div>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Open source + services</p>
              <h2 className="public-section-title">Open-source proof, then supervised service paths</h2>
            </div>
            <p className="public-section-description max-w-2xl">
              The examples catalog should convert careful agencies without pretending OpenPlan is a
              closed SaaS black box. Public artifacts show the work; paid help starts when someone
              needs implementation, hosting, review, or planning support.
            </p>
          </div>
          <div className="public-ledger">
            <div className="public-ledger-row">
              <div className="public-ledger-index">01</div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Inspect the proof trail</p>
                <p className="public-ledger-copy text-foreground">
                  Evidence pages point back to repository records, validation artifacts, and caveats
                  so technical reviewers can inspect how a claim was produced before asking for help.
                </p>
              </div>
            </div>
            <div className="public-ledger-row">
              <div className="public-ledger-index">02</div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">Request implementation help</p>
                <p className="public-ledger-copy text-foreground">
                  Request-access routes lead to service conversations — managed hosting, self-hosting
                  readiness, workflow setup, or planning analysis — rather than instant unsupervised
                  checkout.
                </p>
              </div>
            </div>
            <div className="public-ledger-row">
              <div className="public-ledger-index">03</div>
              <div className="public-ledger-body">
                <p className="public-ledger-label">No instant checkout demo claim</p>
                <p className="public-ledger-copy text-foreground">
                  A public example is not a promise that every workspace will reproduce these results.
                  Production commitments belong in scoped services with human review.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/pricing#service-lanes" className="public-primary-link">
              Review service lanes
            </Link>
            <Link
              href="/request-access?lane=implementation"
              className="public-secondary-link"
            >
              Request supervised access
            </Link>
          </div>
          <div className="mt-5 space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div>
              <p className="public-ledger-label">Guided demo fit check</p>
              <p className="mt-2 text-sm text-muted-foreground">
                A useful buyer walkthrough should end with one scoped first workflow, a named review
                owner, known data-sensitivity constraints, and the right delivery lane: self-hosted,
                managed-hosted, implementation-only, or a mix.
              </p>
            </div>
            <div className="border-t border-border/60 pt-4">
              <p className="public-ledger-label">Command Center handoff cue</p>
              <p className="mt-2 text-sm text-muted-foreground">
                If an operator arrives here from Command Center, keep the narration sequence intact:
                name the proof boundary, show the internal prototype gate, preserve the Max APE caveat,
                then route the next step to supervised access or service-lane review.
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Signed-in operators can return to the internal command surface; public visitors should use
                the supervised request path instead.
              </p>
              <Link href="/command-center" className="public-secondary-link mt-3 inline-flex">
                Open operator Command Center
              </Link>
            </div>
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">What comes next</p>
              <h2 className="public-section-title">How additional examples enter the catalog</h2>
            </div>
          </div>
          <div className="public-ledger">
            <div className="public-ledger-row">
              <div className="public-ledger-index">01</div>
              <div className="public-ledger-body">
                <p className="public-ledger-copy text-foreground">
                  A run is added only when its validation artifact exists, its screening gate is
                  captured, and its caveats are preserved verbatim.
                </p>
              </div>
            </div>
            <div className="public-ledger-row">
              <div className="public-ledger-index">02</div>
              <div className="public-ledger-body">
                <p className="public-ledger-copy text-foreground">
                  Gate upgrades (e.g., beyond `internal prototype only`) require recalibration
                  evidence, not just prettier framing. The catalog shows status truthfully.
                </p>
              </div>
            </div>
            <div className="public-ledger-row">
              <div className="public-ledger-index">03</div>
              <div className="public-ledger-body">
                <p className="public-ledger-copy text-foreground">
                  Agencies and consultants who want to see the methodology behind a run can{" "}
                  <Link href="/pricing" className="underline underline-offset-4 hover:text-foreground">
                    review service lanes
                  </Link>{" "}
                  or{" "}
                  <Link href="/request-access" className="underline underline-offset-4 hover:text-foreground">
                    request a supervised walk-through
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
