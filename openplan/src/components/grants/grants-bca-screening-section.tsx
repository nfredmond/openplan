import Link from "next/link";
import { Calculator } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  BcaScreeningBody,
  type BcaScreeningProjectOption,
} from "@/components/grants/bca-screening-body";

export type GrantsBcaScreeningSectionProps = {
  projects: BcaScreeningProjectOption[];
  canSave: boolean;
};

export function GrantsBcaScreeningSection({ projects, canSave }: GrantsBcaScreeningSectionProps) {
  return (
    <article
      id="grants-benefit-cost"
      className="module-section-surface scroll-mt-24"
      data-testid="grants-bca-screening"
    >
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Calculator className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Decision support</p>
            <h2 className="module-section-title">Benefit-cost analysis and screening</h2>
            <p className="module-section-description">
              Screens a project&apos;s pursue/skip posture before anyone commits to a full
              application benefit-cost analysis: operator-supplied costs and benefits, USDOT-style
              monetization defaults, a seeded uncertainty screen, and a downloadable memo.
              Arithmetic on operator-supplied magnitudes — no missing input is invented, and
              nothing is stored unless an operator saves a screening to the project record.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">Screening-level — not an application BCA</StatusBadge>
      </div>

      <section className="space-y-3 border-b border-border p-4 sm:p-6" aria-label="Benefit-cost analysis workbench">
        <h3 className="font-semibold">Prepare a program-specific analysis</h3>
        <p className="max-w-3xl text-sm text-muted-foreground">Open an annual Build/No Build ledger with program methods, evidence gaps, sensitivity, retained versions and a calculation package. The existing screening remains below.</p>
        <div className="flex flex-wrap gap-2">{projects.map(project => <Link key={project.id} href={`/grants/bca/${project.id}`} className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent">Analyze {project.name}</Link>)}</div>
        {!projects.length && <p className="text-sm">Create a project first to retain its analysis and evidence.</p>}
      </section>
      <BcaScreeningBody projects={projects} canSave={canSave} />
    </article>
  );
}
