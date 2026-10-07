import type { BcaDocument, BcaFlow } from "@/lib/bca/workbench/schema";
import { BCA_CATEGORIES, BCA_UNITS } from "@/lib/bca/workbench/schema";
import {
  USDOT_PARAMETERS,
  USDOT_2026_SOURCE,
} from "@/lib/bca/workbench/profiles";
import { Field, NumberField, selectClass, buttonClass } from "./fields";
export function BcaFlowEditor({
  flow,
  doc,
  onChange,
  onDocument,
  onRemove,
}: {
  flow: BcaFlow;
  doc: BcaDocument;
  onChange: (flow: BcaFlow) => void;
  onDocument: (doc: BcaDocument) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof BcaFlow>(key: K, value: BcaFlow[K]) =>
    onChange({ ...flow, [key]: value });
  return (
    <section
      className="space-y-4 rounded-lg border border-border p-4 sm:p-5"
      aria-label={`${flow.label || "Untitled"} input`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{flow.label || "Untitled stream"}</h3>
        <button className={buttonClass} onClick={onRemove}>
          Remove stream
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Stream name"
          value={flow.label}
          onChange={(v) => set("label", v)}
        />
        <Field
          label="Project element"
          value={flow.component}
          onChange={(component) => set("component", component)}
        />
        <Field label="Economic side">
          <select
            className={selectClass}
            value={flow.side}
            onChange={(e) => set("side", e.target.value as BcaFlow["side"])}
          >
            <option value="benefit">Benefit</option>
            <option value="cost">Cost: Build minus No Build</option>
          </select>
        </Field>
        <Field label="Category">
          <select
            className={selectClass}
            value={flow.category}
            onChange={(e) =>
              set("category", e.target.value as BcaFlow["category"])
            }
          >
            {BCA_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Benefit direction">
          <select
            className={selectClass}
            value={flow.benefitDirection}
            onChange={(e) =>
              set(
                "benefitDirection",
                e.target.value as BcaFlow["benefitDirection"],
              )
            }
          >
            <option value="reduction">Reduction: No Build minus Build</option>
            <option value="increase">
              Increase: Build minus No Build (e.g. residual)
            </option>
          </select>
        </Field>
        <Field label="Quantity unit">
          <select
            className={selectClass}
            value={flow.unit}
            onChange={(e) => set("unit", e.target.value as BcaFlow["unit"])}
          >
            {BCA_UNITS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <NumberField
          label="First flow year"
          value={flow.startYear}
          onChange={(v) => set("startYear", v ?? 0)}
        />
        <NumberField
          label="Last flow year"
          value={flow.endYear}
          onChange={(v) => set("endYear", v ?? 0)}
        />
        <NumberField
          label="No Build quantity"
          value={flow.noBuild}
          onChange={(v) => set("noBuild", v)}
        />
        <NumberField
          label="Build quantity"
          value={flow.build}
          onChange={(v) => set("build", v)}
        />
        <NumberField
          label="Occurrences per year (1 if already annual)"
          value={flow.annualization}
          onChange={(v) => set("annualization", v)}
        />
        <NumberField
          label="Dollars per quantity unit"
          value={flow.unitValue}
          onChange={(v) => set("unitValue", v)}
        />
        <NumberField
          label="Value dollar year"
          value={flow.priceYear}
          onChange={(v) => set("priceYear", v ?? 0)}
        />
        <NumberField
          label={`Conversion to ${doc.priceYear} dollars`}
          value={flow.priceFactor}
          onChange={(v) => set("priceFactor", v)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Enter zero only when supported. A blank prevents a complete result.
        Person-hours and vehicle-hours differ. Dollar quantities use a unit
        value of 1. Negative differences remain in the result.
      </p>
      <Field label="Insert a published USDOT 2026 value">
        <select
          className={selectClass}
          value=""
          onChange={(e) => {
            const p = USDOT_PARAMETERS.find((p) => p.id === e.target.value);
            if (!p || p.unit !== flow.unit) return;
            const sourceId = `usdot-2026-${p.id}`;
            onDocument({
              ...doc,
              evidence: [
                ...doc.evidence.filter((s) => s.id !== sourceId),
                {
                  id: sourceId,
                  title: `USDOT 2026: ${p.label}`,
                  reference: USDOT_2026_SOURCE,
                  locator: p.locator,
                  observedYear: 2024,
                  status: "documented",
                  method: `${p.value} dollars per ${p.unit}, in 2024 dollars. Confirm applicability to this stream.`,
                  limitation:
                    "Guidance value; does not establish the project's avoided quantity.",
                  owner: "",
                  dueDate: "",
                },
              ],
              flows: doc.flows.map((f) =>
                f.id === flow.id
                  ? {
                      ...f,
                      unitValue: p.value,
                      priceYear: 2024,
                      priceFactor: doc.priceYear === 2024 ? 1 : null,
                      parameterSourceId: sourceId,
                    }
                  : f,
              ),
            });
          }}
        >
          <option value="">Select a value matching the quantity unit</option>
          {USDOT_PARAMETERS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.unit !== flow.unit}>
              {p.label}: ${p.value.toLocaleString("en-US")} per {p.unit}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity evidence">
          <select
            className={selectClass}
            multiple
            size={Math.min(4, Math.max(2, doc.evidence.length))}
            value={flow.sourceIds}
            onChange={(e) =>
              set(
                "sourceIds",
                Array.from(e.target.selectedOptions).map((o) => o.value),
              )
            }
          >
            {doc.evidence.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monetization source">
          <select
            className={selectClass}
            value={flow.parameterSourceId ?? ""}
            onChange={(e) => set("parameterSourceId", e.target.value || null)}
          >
            <option value="">Not linked</option>
            {doc.evidence.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.id}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Calculation and causal explanation"
          multiline
          value={flow.rationale}
          onChange={(v) => set("rationale", v)}
        />
        <Field label="Dollar-conversion source">
          <select
            className={selectClass}
            value={flow.conversionSourceId ?? ""}
            onChange={(e) => set("conversionSourceId", e.target.value || null)}
          >
            <option value="">Not needed or not linked</option>
            {doc.evidence.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.id}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">
          Growth, overlap and annual overrides
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Annual quantity growth (%)"
            value={flow.quantityGrowthPct}
            onChange={(v) => set("quantityGrowthPct", v ?? 0)}
          />
          <NumberField
            label="Real unit-value growth (%)"
            value={flow.realValueGrowthPct}
            onChange={(v) => set("realValueGrowthPct", v ?? 0)}
          />
          <NumberField
            label="Separate discount rate (%), blank uses default"
            value={flow.discountRatePct}
            onChange={(v) => set("discountRatePct", v)}
          />
          <Field
            label="Overlap group"
            value={flow.overlapGroup}
            onChange={(v) => set("overlapGroup", v)}
          />
          <Field
            label="Why grouped benefits do not overlap"
            multiline
            value={flow.overlapResolution}
            onChange={(v) => set("overlapResolution", v)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          An override replaces that year&apos;s base quantities and unit value,
          without growth. Other years grow from the first flow year. Enter a
          complete schedule when interpolated growth is not supported.
        </p>
        {flow.annualOverrides.map((row, index) => (
          <div
            className="grid gap-3 rounded border p-3 sm:grid-cols-5"
            key={index}
          >
            {(["year", "noBuild", "build", "unitValue"] as const).map((key) => (
              <NumberField
                key={key}
                label={
                  {
                    year: "Year",
                    noBuild: "No Build override",
                    build: "Build override",
                    unitValue: "Unit value override",
                  }[key]
                }
                value={row[key]}
                onChange={(v) =>
                  set(
                    "annualOverrides",
                    flow.annualOverrides.map((r, i) =>
                      i === index
                        ? { ...r, [key]: key === "year" ? (v ?? 0) : v }
                        : r,
                    ),
                  )
                }
              />
            ))}
            <button
              className={buttonClass}
              onClick={() =>
                set(
                  "annualOverrides",
                  flow.annualOverrides.filter((_, i) => i !== index),
                )
              }
            >
              Remove year
            </button>
          </div>
        ))}
        <button
          className={buttonClass}
          onClick={() =>
            set("annualOverrides", [
              ...flow.annualOverrides,
              {
                year: flow.startYear + flow.annualOverrides.length,
                noBuild: null,
                build: null,
                unitValue: null,
              },
            ])
          }
        >
          Add annual override
        </button>
      </details>
    </section>
  );
}
