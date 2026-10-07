"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { Input } from "@/components/ui/input";
import { studyAreaGeometrySchema } from "@/lib/geographies/study-area-capture";
import { withResolvedStudyPlace, type PlanContextDraft } from "@/lib/land-use-plans/plan-context-draft";

type Props = { value: PlanContextDraft; onChange: (value: PlanContextDraft) => void; hasSavedArea: boolean; disabled?: boolean };

export function PlanStudyAreaFields({ value, onChange, hasSavedArea, disabled = false }: Props) {
  const uploadHelp = useId();
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(0);
  // Picker callbacks can run in one event. Keep the second callback's authority
  // fields and geometry aligned with the first update instead of stale props.
  const current = useRef(value);
  const unavailable = useRef(disabled);
  useLayoutEffect(() => { current.current = value; unavailable.current = disabled; }, [value, disabled]);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function change(next: PlanContextDraft) { if (unavailable.current) return; reads.current++; current.current = next; onChange(next); setError(null); }
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="text-base font-semibold">Plan area</legend>
    <p className="max-w-prose text-sm text-muted-foreground">Keep the study boundary separate from the authority assessment below. Searching or drawing an area does not assign a governing body.</p>
    {hasSavedArea ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.place.mode === "retained"} onChange={event => change({ ...value,
      place: { ...value.place, mode: event.target.checked ? "retained" : "drawn", geometryText: event.target.checked ? value.place.geometryText : "", kind: null, geoid: "" } })} />Keep the saved plan area unchanged</label> : null}
    {value.place.mode === "retained" ? <p className="max-w-prose text-sm text-muted-foreground">Saving this assessment preserves the saved boundary, label and source identity. It does not fetch a newer boundary.</p> : <>
      <label className="block space-y-1 text-sm">Plan area label<Input value={value.place.label} onChange={event => change({ ...value, place: { ...value.place, label: event.target.value } })} maxLength={240} /></label>
      <StudyAreaPicker corridorText={value.place.geometryText} showRunEngineHint={false} externalLabel={value.place.label || null}
        onCorridorChange={geometryText => change({ ...current.current, place: { ...current.current.place, mode: "drawn", kind: null, geoid: "", geometryText } })}
        onPlaceResolved={place => change(withResolvedStudyPlace(current.current, place))} />
      <label className="block space-y-1 text-sm">Or upload a study boundary<input aria-label="Or upload a study boundary" aria-describedby={uploadHelp} type="file" accept=".geojson,.json,application/geo+json,application/json" className="block w-full text-sm" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (!file) return;
        if (file.size > 2_000_000) { setError("Use a boundary file smaller than 2 MB."); return; }
        const read = ++reads.current;
        void file.text().then(text => {
          if (!mounted.current || unavailable.current || read !== reads.current) return;
          const raw: unknown = JSON.parse(text);
          const candidate = raw && typeof raw === "object" && "type" in raw && raw.type === "Feature" && "geometry" in raw ? raw.geometry : raw;
          const geometry = studyAreaGeometrySchema.parse(candidate);
          change({ ...current.current, place: { ...current.current.place, mode: "uploaded", kind: null, geoid: "", geometryText: JSON.stringify(geometry) } });
        }).catch(() => { if (mounted.current && read === reads.current) setError("The file is not a closed WGS84 polygon or multipolygon. Keep the original file and check its geometry."); });
      }} /><span id={uploadHelp} className="text-xs text-muted-foreground">GeoJSON Polygon, MultiPolygon or a single Feature, up to 2 MB. An uploaded boundary has no inferred jurisdiction.</span></label>
      {value.place.mode === "place" ? <p className="text-sm text-muted-foreground">The selected place is resolved again when you save. Its returned boundary and source identity become the saved plan area.</p> : value.place.mode === "uploaded" ? <p className="text-sm text-muted-foreground">Boundary source: uploaded file. Responsible authorities remain as entered below.</p> : null}
    </>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </fieldset>;
}
