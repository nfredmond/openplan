"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jurisdictionDraft, readProjectJurisdiction, type JurisdictionEntryInput } from "@/lib/projects/project-jurisdiction";

/** This editor owns no geometry callback or study-place write. */
export function ProjectJurisdictionEditor({ projectId, context, revision, userId, workspaceId, canWrite }: {
  projectId: string; context: unknown; revision: string; userId: string; workspaceId: string; canWrite: boolean;
}) {
  const router = useRouter();
  let saved;
  let invalid = false;
  try { saved = readProjectJurisdiction({ jurisdiction_context: context }); } catch { invalid = true; saved = null; }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JurisdictionEntryInput[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState<"administrative" | "sovereign" | "overlap" | "other">("other");
  const [country, setCountry] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  async function save(entries: JurisdictionEntryInput[]) {
    setError(null); setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId },
        body: JSON.stringify({ expectedRevision: baseRevision, jurisdiction: { version: 1, state: entries.length ? "declared" : "unresolved", entries } }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not confirm the save. Keep your draft."); return;
      }
      setEditing(false); router.refresh();
    } catch { setError("Could not reach the server. Keep your draft."); }
    finally { setSaving(false); }
  }
  return <section id="project-jurisdiction" className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Project jurisdiction context</h3>
    <p className="text-sm text-muted-foreground">Declare the jurisdictions involved in this project separately from its study boundary. This does not establish adopting authority or legal applicability.</p>
    {invalid ? <p role="alert">Saved jurisdiction is invalid or could not be read. Readiness is unavailable.</p> : saved === null
      ? <p>No separate declaration. Readiness may show labelled legacy study-place context.</p>
      : saved.state === "unresolved" ? <p>Jurisdiction explicitly unresolved. Study-place fallback is disabled.</p>
        : <ul>{saved.entries.map((entry, index) => <li key={index}>{entry.label}: {entry.identity === "staff_declared" ? "unverified staff declaration" : "server-resolved identity"}</li>)}</ul>}
    {!editing && canWrite && <Button type="button" onClick={() => { setDraft(jurisdictionDraft(saved)); setBaseRevision(revision); setError(null); setSelectedLabel(null); setEditing(true); }}>Edit jurisdiction context</Button>}
    {editing && <fieldset disabled={saving} className="space-y-3">
      <legend className="sr-only">Edit project jurisdiction</legend>
      <p className="text-sm">Search currently covers US Census counties, cities, CDPs and metro areas. Other contexts, including sovereign, overlapping and international jurisdictions, require an unverified staff declaration.</p>
      <StudyAreaPicker corridorText="" onCorridorChange={() => {}} searchOnly showRunEngineHint={false} onPlaceResolved={place => {
        if (place) { setDraft(items => [...items, { mode: "resolved", kind: place.kind, geoid: place.geoid }]); setSelectedLabel(place.label); }
      }} />
      {selectedLabel && <p>Added search identity: {selectedLabel}</p>}
      <ol>{draft.map((entry, index) => <li key={index}>{entry.mode === "staff" ? `${entry.label} (unverified)` : `${entry.kind} ${entry.geoid} (server re-resolves on save)`} <Button type="button" disabled={saving} onClick={() => setDraft(items => items.filter((_, i) => i !== index))}>Remove entry {index + 1}</Button></li>)}</ol>
      <fieldset disabled={saving} className="space-y-2">
        <legend>Unverified staff declaration</legend>
        <label className="block">Jurisdiction label<Input value={label} onChange={e => setLabel(e.target.value)} maxLength={200} /></label>
        <label className="block">Source-defined kind<Input value={kind} onChange={e => setKind(e.target.value)} maxLength={80} /></label>
        <label className="block">Context scope<select value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="other">Other or unclassified</option><option value="administrative">Administrative geography</option><option value="sovereign">Sovereign jurisdiction</option><option value="overlap">Overlapping jurisdictions</option></select></label>
        <label className="block">ISO country code, optional<Input value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} /></label>
        <label className="block">Subdivision code, optional<Input value={subdivision} onChange={e => setSubdivision(e.target.value.toUpperCase())} maxLength={16} /></label>
        <label className="block">Namespaced source reference, optional<Input value={reference} onChange={e => setReference(e.target.value)} maxLength={220} /></label>
        <Button type="button" disabled={!label.trim() || !kind.trim() || draft.length >= 12} onClick={() => {
          setDraft(items => [...items, { mode: "staff", label: label.trim(), kind: kind.trim(), countryCode: country || null, subdivisionCode: subdivision || null, reference: reference || null, scope }]);
          setLabel(""); setKind(""); setReference("");
        }}>Add staff declaration</Button>
      </fieldset>
      <p className="text-sm">Up to 12 declarations. Each receives a separate readiness assessment. File labels and feature properties do not author jurisdiction.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving || draft.length === 0 || draft.length > 12} onClick={() => void save(draft)}>Save jurisdiction context</Button>
        <Button type="button" disabled={saving} onClick={() => void save([])}>Clear to unresolved</Button>
        <Button type="button" disabled={saving} onClick={() => { setEditing(false); setDraft([]); setError(null); }}>Cancel jurisdiction edit</Button>
      </div>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
