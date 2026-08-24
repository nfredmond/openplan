"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS } from "@/lib/land-use-plans/registry";

export function LandUsePlanCreator() {
  const router = useRouter();
  const [descriptorId, setDescriptorId] = useState(SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS[0].id);
  const descriptor = useMemo(
    () => SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find((item) => item.id === descriptorId)!,
    [descriptorId]
  );
  const [planKindKey, setPlanKindKey] = useState(descriptor.planKinds[0].key);
  const [title, setTitle] = useState("");
  const [authorityLabel, setAuthorityLabel] = useState("");
  const [geographyLabel, setGeographyLabel] = useState("");
  const [corridorText, setCorridorText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createPlan() {
    setError(null);
    let geographyGeojson: Record<string, unknown>;
    try {
      geographyGeojson = JSON.parse(corridorText) as Record<string, unknown>;
    } catch {
      setError("Select or draw the plan geography before creating the plan.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/land-use-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, descriptorId, planKindKey, authorityLabel, geographyLabel, geographyGeojson }),
      });
      const payload = (await response.json()) as { planId?: string; error?: string };
      if (!response.ok || !payload.planId) throw new Error(payload.error ?? "Failed to create plan");
      router.push(`/land-use-plans/${payload.planId}`);
      router.refresh();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Failed to create plan");
    } finally {
      setSubmitting(false);
    }
  }

  const ready = title.trim() && authorityLabel.trim() && geographyLabel.trim() && corridorText.trim();
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Start a land use plan</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        California has a sourced checklist. Everywhere else gets the same versioned workflow with local legal requirements plainly marked unconfigured.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          Legal bundle
          <select
            className="module-select w-full"
            value={descriptorId}
            onChange={(event) => {
              const next = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find((item) => item.id === event.target.value)!;
              setDescriptorId(next.id);
              setPlanKindKey(next.planKinds[0].key);
            }}
          >
            {SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.map((item) => <option key={item.id} value={item.id}>{item.jurisdictionLabel}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Plan kind
          <select className="module-select w-full" value={planKindKey} onChange={(event) => setPlanKindKey(event.target.value)}>
            {descriptor.planKinds.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">Plan title<Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="2045 General Plan" /></label>
        <label className="space-y-1 text-sm font-medium">Planning authority<Input value={authorityLabel} onChange={(event) => setAuthorityLabel(event.target.value)} placeholder="The adopting agency or sovereign authority" /></label>
      </div>
      <div className="mt-4 space-y-2">
        <label className="space-y-1 text-sm font-medium">Plan geography label<Input value={geographyLabel} onChange={(event) => setGeographyLabel(event.target.value)} placeholder="The area in the agency's own words" /></label>
        <StudyAreaPicker
          corridorText={corridorText}
          onCorridorChange={setCorridorText}
          onPlaceResolved={(place) => { if (place?.label) setGeographyLabel(place.label); }}
          showRunEngineHint={false}
          externalLabel={geographyLabel || null}
        />
      </div>
      {!descriptor.configured ? <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">{descriptor.disclosure}</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <Button className="mt-4" onClick={() => void createPlan()} disabled={!ready || submitting}>{submitting ? "Creating…" : "Create plan and first working version"}</Button>
    </section>
  );
}

