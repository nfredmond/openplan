import { Calculator } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  BcaScreeningBody,
  type BcaScreeningProjectOption,
} from "@/components/grants/bca-screening-body";

export type GrantsBcaScreeningSectionProps = {
  projects: BcaScreeningProjectOption[];
};

export function GrantsBcaScreeningSection({ projects }: GrantsBcaScreeningSectionProps) {
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
            <h2 className="module-section-title">Benefit-cost screening</h2>
            <p className="module-section-description">
              Screens a project&apos;s pursue/skip posture before anyone commits to a full
              application benefit-cost analysis: operator-supplied costs and benefits, USDOT-style
              monetization defaults, a seeded uncertainty screen, and a downloadable memo.
              Arithmetic on operator-supplied magnitudes — no missing input is invented and
              nothing is stored.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">Screening-level — not an application BCA</StatusBadge>
      </div>

      <BcaScreeningBody projects={projects} />
    </article>
  );
}
