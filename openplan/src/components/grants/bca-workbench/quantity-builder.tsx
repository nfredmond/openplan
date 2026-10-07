import { useState } from "react";
import type { BcaDocument } from "@/lib/bca/workbench/schema";
import { newBcaFlow } from "@/lib/bca/workbench/document";
import {
  travelTimeQuantity,
  safetyQuantity,
  resilienceQuantity,
} from "@/lib/bca/workbench/quantities";
import { Field, NumberField, buttonClass, selectClass } from "./fields";
export function BcaQuantityBuilder({
  doc,
  onChange,
}: {
  doc: BcaDocument;
  onChange: (doc: BcaDocument) => void;
}) {
  const [kind, setKind] = useState("travel"),
    [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [reference, setReference] = useState("");
  const [safetyUnit, setSafetyUnit] = useState<
    "crash" | "fatality" | "serious-injury" | "minor-injury"
  >("crash");
  const [bins, setBins] = useState([
    {
      label: "",
      probability: null as number | null,
      noBuildLoss: null as number | null,
      buildLoss: null as number | null,
    },
  ]);
  const fields =
    kind === "travel"
      ? [
          ["noBuildTrips", "No Build vehicle trips/day"],
          ["buildTrips", "Build vehicle trips/day"],
          ["noBuildMinutes", "No Build minutes/trip"],
          ["buildMinutes", "Build minutes/trip"],
          ["occupancy", "Persons per vehicle"],
          ["days", "Affected days/year"],
        ]
      : [
          ["events", `Observed ${safetyUnit} count`],
          ["years", "Observation years"],
          ["cmf", "Crash modification factor (not percent)"],
        ];
  function add() {
    try {
      let result: { noBuild: number; build: number; method: string };
      const read = (key: string) => {
        const v = values[key];
        if (v === undefined || v === null)
          throw new Error(`Enter ${key}; blank is not zero.`);
        return v;
      };
      if (kind === "travel")
        result = travelTimeQuantity({
          noBuildTrips: read("noBuildTrips"),
          buildTrips: read("buildTrips"),
          noBuildMinutes: read("noBuildMinutes"),
          buildMinutes: read("buildMinutes"),
          occupancy: read("occupancy"),
          days: read("days"),
        });
      else if (kind === "safety")
        result = safetyQuantity({
          events: read("events"),
          years: read("years"),
          cmf: read("cmf"),
        });
      else
        result = resilienceQuantity(
          bins.map((b) => {
            if (
              b.probability === null ||
              b.noBuildLoss === null ||
              b.buildLoss === null
            )
              throw new Error(
                "Enter each bin's probability and both consequences.",
              );
            return {
              ...b,
              probability: b.probability,
              noBuildLoss: b.noBuildLoss,
              buildLoss: b.buildLoss,
            };
          }),
        );
      if (kind === "safety")
        result.method = `Count unit: ${safetyUnit}. ${result.method}`;
      const id = crypto.randomUUID(),
        label =
          kind === "travel"
            ? "Travel time, rule-of-half approximation"
            : kind === "safety"
              ? "Safety, observed baseline and CMF"
              : "Expected annual avoided losses";
      onChange({
        ...doc,
        evidence: [
          ...doc.evidence,
          {
            id,
            title: label,
            reference,
            locator: "Quantity builder inputs retained in method",
            observedYear: null,
            status: "assumption",
            method: result.method,
            limitation:
              "User-supplied inputs. Source applicability and causal validity require review.",
            owner: "",
            dueDate: "",
          },
        ],
        flows: [
          ...doc.flows,
          {
            ...newBcaFlow(doc, "benefit", crypto.randomUUID()),
            label,
            noBuild: result.noBuild,
            build: result.build,
            category:
              kind === "travel"
                ? "travel-time"
                : kind === "safety"
                  ? "safety"
                  : "resilience",
            unit:
              kind === "travel"
                ? "person-hour"
                : kind === "safety"
                  ? safetyUnit
                  : "dollar",
            unitValue: kind === "resilience" ? 1 : null,
            sourceIds: [id],
            parameterSourceId: kind === "resilience" ? id : null,
            rationale: result.method,
          },
        ],
      });
      setError(
        "Added an annual stream and its full calculation record. Review units, source and valuation below.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quantity calculation failed");
    }
  }
  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer font-semibold">
        Calculate quantities from project evidence
      </summary>
      <div className="mt-4 space-y-4">
        <Field label="Quantity calculation">
          <select
            className={selectClass}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setError("");
            }}
          >
            <option value="travel">Travel time and changing trip demand</option>
            <option value="safety">Safety baseline and a documented CMF</option>
            <option value="resilience">
              Expected annual losses from disjoint hazard bins
            </option>
          </select>
        </Field>
        <p className="text-sm">
          No project values are supplied automatically. These helpers show
          arithmetic and retain your inputs. They do not establish traffic
          forecasts, treatment effectiveness or hazard probabilities.
        </p>
        {kind === "safety" && (
          <Field label="Safety count unit">
            <select
              className={selectClass}
              value={safetyUnit}
              onChange={(e) =>
                setSafetyUnit(e.target.value as typeof safetyUnit)
              }
            >
              <option value="crash">Crashes, event count</option>
              <option value="fatality">Fatalities, person count</option>
              <option value="serious-injury">
                Serious injuries, person count
              </option>
              <option value="minor-injury">Minor injuries, person count</option>
            </select>
          </Field>
        )}
        {kind !== "resilience" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([key, label]) => (
              <NumberField
                key={key}
                label={label}
                value={values[key] ?? null}
                onChange={(v) => setValues({ ...values, [key]: v })}
              />
            ))}
          </div>
        ) : (
          <>
            <p className="text-sm">
              Use mutually exclusive annual event probabilities, not cumulative
              return-period exceedance probabilities. Unlisted probability mass
              represents zero loss.
            </p>
            {bins.map((b, i) => (
              <div className="grid gap-3 border p-3 sm:grid-cols-2" key={i}>
                <Field
                  label="Hazard bin"
                  value={b.label}
                  onChange={(v) =>
                    setBins(
                      bins.map((r, n) => (n === i ? { ...r, label: v } : r)),
                    )
                  }
                />
                {(["probability", "noBuildLoss", "buildLoss"] as const).map(
                  (k) => (
                    <NumberField
                      key={k}
                      label={
                        {
                          probability: "Annual probability, 0 to 1",
                          noBuildLoss: "No Build loss, constant dollars",
                          buildLoss: "Build loss, constant dollars",
                        }[k]
                      }
                      value={b[k]}
                      onChange={(v) =>
                        setBins(
                          bins.map((r, n) => (n === i ? { ...r, [k]: v } : r)),
                        )
                      }
                    />
                  ),
                )}
              </div>
            ))}
            <button
              className={buttonClass}
              onClick={() =>
                setBins([
                  ...bins,
                  {
                    label: "",
                    probability: null,
                    noBuildLoss: null,
                    buildLoss: null,
                  },
                ])
              }
            >
              Add hazard bin
            </button>
          </>
        )}
        <Field
          label="Source reference for these inputs"
          value={reference}
          onChange={setReference}
        />
        <button className={buttonClass} onClick={add}>
          Calculate and add annual stream
        </button>
        {error && (
          <p role="status" className="text-sm">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
