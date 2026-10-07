import type { BcaDocument } from "@/lib/bca/workbench/schema";
import {
  calculateBcaDocument,
  calculateBcaComponents,
  calculateBcaSensitivity,
} from "@/lib/bca/workbench/engine";
const money = (v: number | null) =>
  v === null
    ? "Not calculated"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(v);
export function BcaResults({ doc }: { doc: BcaDocument }) {
  const result = calculateBcaDocument(doc),
    sensitivity = calculateBcaSensitivity(doc);
  const max = Math.max(
    1,
    ...result.annual.flatMap((r) => [Math.abs(r.benefits), Math.abs(r.costs)]),
  );
  return (
    <div className="space-y-6">
      <section className="space-y-4" aria-label="Analysis results">
        <h2 className="text-xl font-semibold">What the evidence supports</h2>
        <p>
          {result.complete
            ? "The entered numerical streams can be calculated. Review source quality and program requirements before application use."
            : "The analysis is incomplete. The displayed annual subtotals omit incomplete streams; they are not a project result."}
        </p>
        <dl className="grid gap-5 border-y border-border py-5 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">
              Benefit-cost ratio
            </dt>
            <dd className="text-3xl font-semibold tabular-nums">
              {result.benefitCostRatio?.toFixed(2) ?? "Not calculated"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Net present value</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {money(result.netPresentValue)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Evidence and method checks
            </dt>
            <dd className="text-2xl font-semibold">
              {result.issues.length} open
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {doc.priceYear} constant dollars, discounted to {doc.discountYear} at{" "}
          {doc.discountRatePct}%.{" "}
          {doc.costConvention === "capital-only"
            ? "Capital is the BCR denominator. Net operating costs reduce the numerator."
            : "All incremental costs enter the BCR denominator."}{" "}
          A ratio above 1 does not establish eligibility, forecast accuracy or
          award likelihood.
        </p>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Project elements</h3>
        <p className="text-sm">
          Allocate every stream to one element. Document how shared costs and
          benefits are allocated. Whole-project totals add the allocated
          dollars, never the element ratios.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Element</th>
                <th>BCR</th>
                <th>Net present value</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {calculateBcaComponents(doc).map(({ component, result: r }) => (
                <tr key={component} className="border-t">
                  <th className="p-2">{component}</th>
                  <td className="p-2">
                    {r.benefitCostRatio?.toFixed(2) ?? "Not calculated"}
                  </td>
                  <td className="p-2">{money(r.netPresentValue)}</td>
                  <td className="p-2">{r.issues.length} open</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Review worklist</h3>
        {result.issues.length ? (
          <ul className="space-y-2">
            {result.issues.map((issue, i) => (
              <li
                className="rounded border border-border p-3 text-sm"
                key={`${issue.code}-${i}`}
              >
                <strong>
                  {issue.severity === "error"
                    ? "Missing or incompatible input. "
                    : "Review. "}
                </strong>
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No automated issue found. Analyst and program review remain
            necessary.
          </p>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Annual benefits and costs</h3>
        <p className="text-sm text-muted-foreground">
          Bar length shows absolute magnitude. Values retain their signs. The
          table below contains the full series.
        </p>
        <div
          className="space-y-2"
          role="img"
          aria-label="Annual benefits and costs, with exact values in the following table"
        >
          {result.annual.map((row) => (
            <div
              key={row.year}
              className="grid grid-cols-[3rem_1fr] items-center gap-3 text-xs"
            >
              <span>{row.year}</span>
              <div className="space-y-1">
                <div
                  className="h-2 rounded-sm bg-[color:var(--pine)]"
                  style={{
                    width: `${Math.max(0.3, (Math.abs(row.benefits) / max) * 100)}%`,
                  }}
                />
                <div
                  className="h-2 rounded-sm bg-[color:var(--ochre,#a96b20)]"
                  style={{
                    width: `${Math.max(0.3, (Math.abs(row.costs) / max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm">
          Upper bar: benefit magnitude. Lower bar: cost magnitude. Negative
          effects keep their signs in the table.
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          aria-label="Annual cash-flow table"
        >
          <table className="w-full text-right text-sm">
            <caption className="sr-only">
              Annual undiscounted benefits and costs and discounted net value
            </caption>
            <thead>
              <tr>
                {["Year", "Benefits", "Costs", "Net", "Discounted net"].map(
                  (v) => (
                    <th className="p-2" key={v}>
                      {v}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {result.annual.map((r) => (
                <tr key={r.year} className="border-t">
                  <th className="p-2">{r.year}</th>
                  {[r.benefits, r.costs, r.net, r.presentValueNet].map(
                    (v, i) => (
                      <td
                        className="whitespace-nowrap p-2 tabular-nums"
                        key={i}
                      >
                        {money(v)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Sensitivity and break-even</h3>
        <p className="text-sm">{doc.sensitivity.rationale}</p>
        <p className="text-sm text-muted-foreground">
          Ranges are analyst assumptions, not probabilities. Scenarios vary
          positive benefits or positive costs; disbenefits and cost savings keep
          their signs.
        </p>
        {sensitivity.breakEvenBenefitMultiplier !== null && (
          <p>
            Positive benefits must be at least{" "}
            <strong>
              {(sensitivity.breakEvenBenefitMultiplier * 100).toFixed(1)}%
            </strong>{" "}
            of the base estimate to break even, holding other flows fixed.
          </p>
        )}
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Scenario</th>
                <th className="p-2">BCR</th>
                <th className="p-2">NPV</th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.cases.map((row) => (
                <tr className="border-t" key={row.label}>
                  <th className="p-2 font-normal">{row.label}{row.issues.map((issue, i) => <p className="text-xs" key={i}>{issue.message}</p>)}</th>
                  <td className="p-2 tabular-nums">
                    {row.bcr?.toFixed(2) ?? "Not calculated"}
                  </td>
                  <td className="whitespace-nowrap p-2 tabular-nums">
                    {money(row.npv)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Largest calculation drivers</h3>
        {sensitivity.drivers.map((row) => (
          <div
            className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"
            key={row.id}
          >
            <span>
              {row.label} ({row.side})
            </span>
            <strong className="tabular-nums">{money(row.presentValue)}</strong>
          </div>
        ))}
        <p className="text-sm text-muted-foreground">
          Improve the evidence behind the largest uncertain flows first. A new
          traffic study is useful when its result could change the decision; a
          narrower count, crash review or closure history may answer the relevant
          question.
        </p>
      </section>
    </div>
  );
}
