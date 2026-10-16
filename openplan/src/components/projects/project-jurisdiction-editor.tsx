"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
  let saved: ReturnType<typeof readProjectJurisdiction>;
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
  const currentScope = useRef({ projectId, userId, workspaceId, revision, canWrite, epoch: 0 });
  useLayoutEffect(() => {
    const previous = currentScope.current;
    const changed = previous.projectId !== projectId || previous.userId !== userId || previous.workspaceId !== workspaceId || previous.canWrite !== canWrite || previous.revision !== revision;
    currentScope.current = { projectId, userId, workspaceId, revision, canWrite, epoch: previous.epoch + (changed ? 1 : 0) };
  }, [projectId, userId, workspaceId, revision, canWrite]);
  const [draftScope, setDraftScope] = useState(currentScope.current);
  const staleDraft = draftScope.projectId !== projectId || draftScope.userId !== userId || draftScope.workspaceId !== workspaceId || draftScope.revision !== revision || !canWrite || draftScope.epoch !== currentScope.current.epoch;
  function restart() {
    setDraft(jurisdictionDraft(saved)); setDraftScope(currentScope.current); setError(null); setSelectedLabel(null); setEditing(true);
  }
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  async function save(entries: JurisdictionEntryInput[]) {
    if (staleDraft) { setError("This draft belongs to its original project, account, workspace and revision. Compare the saved context before restarting."); return; }
    const requestScope = draftScope;
    const scopeStillCurrent = () => currentScope.current.epoch === requestScope.epoch && currentScope.current.canWrite;
    setError(null); setSaving(true);
    try {
      const response = await fetch(`/api/projects/${requestScope.projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-openplan-expected-user": requestScope.userId, "x-openplan-expected-workspace": requestScope.workspaceId },
        body: JSON.stringify({ expectedRevision: requestScope.revision, jurisdiction: { version: 1, state: entries.length ? "declared" : "unresolved", entries } }),
      });
      if (!scopeStillCurrent()) { setError("The save response belongs to an earlier scope. Your original draft remains for comparison; check saved context before restarting."); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (!scopeStillCurrent()) { setError("The save response belongs to an earlier scope. Keep the original draft for comparison."); return; }
        setError(body.error ?? "Could not confirm the save. Keep your draft."); return;
      }
      setEditing(false); router.refresh();
    } catch { setError("Could not reach the server. Keep your draft."); }
    finally { setSaving(false); }
  }
  return <section id="project-jurisdiction" className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Project jurisdiction context</h3>
    <p className="text-sm text-muted-foreground">Declare the jurisdictions involved in this project separately from its study boundary. This does not establish adopting authority or legal applicability.</p>
    {invalid ? <p role="alert">Saved jurisdiction is invalid or could not be read. Jurisdiction assessment is unavailable.</p> : saved === null
      ? <p>No separate declaration. Jurisdiction assessment may show labelled legacy study-place context.</p>
      : saved.state === "unresolved" ? <p>Jurisdiction explicitly unresolved. Study-place fallback is disabled.</p>
        : <ul>{saved.entries.map((entry, index) => <li key={index}>{entry.label}: {entry.identity === "staff_declared" ? "unverified staff declaration" : "server-resolved identity"}</li>)}</ul>}
    {!editing && canWrite && <Button type="button" onClick={restart}>Edit jurisdiction context</Button>}
    {editing && staleDraft && <div role="alert">
      <p>This retained draft belongs to project {draftScope.projectId}, account {draftScope.userId}, workspace {draftScope.workspaceId}, revision {draftScope.revision}. Submission is blocked because scope, revision or permission changed. Compare it with the saved context above.</p>
      {canWrite && <Button type="button" disabled={saving} onClick={restart}>Compare saved context and restart</Button>}
    </div>}
    {editing && <fieldset disabled={saving || staleDraft} className="space-y-3">
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
      <p className="text-sm">Development limit: up to 12 declarations. Each receives a separate jurisdiction assessment. File labels and feature properties do not author jurisdiction.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving || draft.length === 0 || draft.length > 12} onClick={() => void save(draft)}>Save jurisdiction context</Button>
        <Button type="button" disabled={saving} onClick={() => void save([])}>Clear to unresolved</Button>
        <Button type="button" disabled={saving} onClick={() => { setEditing(false); setDraft([]); setError(null); }}>Cancel jurisdiction edit</Button>
      </div>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
