"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { emptyPlanAuthority, type PlanContextDraft, type PlanAuthorityDraft } from "@/lib/land-use-plans/plan-context-draft";

const suggestedBodyTypes = [
  { value: "city", label: "City government" }, { value: "county", label: "County government" },
  { value: "tribal_government", label: "Tribal government" }, { value: "regional_body", label: "Regional body" },
  { value: "state_agency", label: "State agency" }, { value: "unassessed", label: "Not assessed" },
];

type Props = { value: PlanContextDraft; onChange: (value: PlanContextDraft) => void; disabled?: boolean };

export function PlanAuthorityFields({ value, onChange, disabled = false }: Props) {
  const kindList = useId();
  function updateAuthority(id: string, patch: Partial<PlanAuthorityDraft>) {
    onChange({ ...value, authorities: value.authorities.map(authority => authority.id === id ? { ...authority, ...patch } : authority) });
  }
  function updateAssessment(patch: Partial<PlanContextDraft["applicability"]>) {
    onChange({ ...value, applicability: { ...value.applicability, ...patch } });
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <legend className="text-base font-semibold">Responsible bodies and applicability</legend>
    <p className="max-w-prose text-sm text-muted-foreground">Identify the bodies responsible for this plan and their roles. A study boundary or office location does not establish governing authority. Keep private consultation notes in the consultation section.</p>
    <datalist id={kindList}>{suggestedBodyTypes.map(type => <option key={type.value} value={type.label} />)}</datalist>
    {value.authorities.map((authority, index) => <fieldset key={authority.id} className="min-w-0 space-y-3 border-l-2 border-border pl-4">
      <legend className="text-sm font-semibold">Responsible body {index + 1}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-sm">Body name<Input value={authority.label} onChange={event => updateAuthority(authority.id, { label: event.target.value })} maxLength={240} /></label>
        <label className="block space-y-1 text-sm">Role in this plan<Input value={authority.role} onChange={event => updateAuthority(authority.id, { role: event.target.value })} placeholder="For example, adopting or consulting" maxLength={240} /></label>
        <label className="block space-y-1 text-sm">Type of body<Input list={kindList} value={suggestedBodyTypes.find(type => type.value === authority.kind)?.label ?? authority.kind} onChange={event => updateAuthority(authority.id, { kind: suggestedBodyTypes.find(type => type.label === event.target.value)?.value ?? event.target.value })} placeholder="Select a suggestion or enter another type" maxLength={240} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={authority.jurisdictionUnknown} onChange={event => updateAuthority(authority.id, { jurisdictionUnknown: event.target.checked })} />Jurisdiction is not assessed</label>
        {!authority.jurisdictionUnknown ? <>
          <label className="block space-y-1 text-sm">Country code<Input aria-label="Country code" aria-describedby={`${kindList}-${authority.id}-country`} value={authority.country} onChange={event => updateAuthority(authority.id, { country: event.target.value })} maxLength={2} /><span id={`${kindList}-${authority.id}-country`} className="text-xs text-muted-foreground">Two-letter country code for the jurisdiction of this body.</span></label>
          <label className="block space-y-1 text-sm">State or subdivision code<Input aria-label="State or subdivision code" aria-describedby={`${kindList}-${authority.id}-subdivision`} value={authority.subdivision} onChange={event => updateAuthority(authority.id, { subdivision: event.target.value })} maxLength={12} /><span id={`${kindList}-${authority.id}-subdivision`} className="text-xs text-muted-foreground">Leave blank when no single subdivision describes it.</span></label>
        </> : null}
      </div>
      <label className="block space-y-1 text-sm">Authority sources<Textarea aria-label="Authority sources" aria-describedby={`${kindList}-${authority.id}-sources`} value={authority.sourceText} onChange={event => updateAuthority(authority.id, { sourceText: event.target.value })} rows={3} maxLength={62000} /><span id={`${kindList}-${authority.id}-sources`} className="text-xs text-muted-foreground">One public source URL per line. Keep unresolved authority explicit when sources are missing.</span></label>
      <Button type="button" variant="outline" disabled={value.authorities.length <= 1} onClick={() => onChange({ ...value,
        authorities: value.authorities.filter(item => item.id !== authority.id),
        applicability: { ...value.applicability, authorityIds: value.applicability.authorityIds.filter(id => id !== authority.id) } })}>Remove responsible body {index + 1}</Button>
    </fieldset>)}
    <Button type="button" variant="outline" disabled={value.authorities.length >= 30} onClick={() => onChange({ ...value, authorities: [...value.authorities, emptyPlanAuthority()] })}>Add responsible body</Button>
    <label className="block space-y-1 text-sm">Applicability assessment<select className="module-select mt-1 w-full" value={value.applicability.status} onChange={event => updateAssessment({ status: event.target.value as "unresolved" | "staff_assessed" })}>
      <option value="unresolved">Unresolved</option><option value="staff_assessed">Assessed by staff with sources</option>
    </select></label>
    <label className="block space-y-1 text-sm">Assessment reasons and unresolved questions<Textarea value={value.applicability.explanation} onChange={event => updateAssessment({ explanation: event.target.value })} rows={4} maxLength={6000} /></label>
    {value.applicability.status === "staff_assessed" ? <div className="space-y-3">
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Bodies covered by this checklist assessment</legend>
        {value.authorities.map((authority, index) => <label key={authority.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.applicability.authorityIds.includes(authority.id)} onChange={event => updateAssessment({ authorityIds: event.target.checked ? [...value.applicability.authorityIds, authority.id] : value.applicability.authorityIds.filter(id => id !== authority.id) })} />{authority.label || `Responsible body ${index + 1}`}</label>)}
      </fieldset>
      <label className="block space-y-1 text-sm">Applicability sources<Textarea aria-label="Applicability sources" aria-describedby={`${kindList}-assessment-sources`} value={value.applicability.sourceText} onChange={event => updateAssessment({ sourceText: event.target.value })} rows={3} maxLength={62000} /><span id={`${kindList}-assessment-sources`} className="text-xs text-muted-foreground">One source URL per line supporting using this checklist for the selected bodies.</span></label>
      <p className="max-w-prose text-sm text-muted-foreground">A saved staff assessment retains its author and sources. It does not establish counsel approval or complete legal compliance.</p>
    </div> : <p className="max-w-prose text-sm text-muted-foreground">Unresolved applicability can be retained with the neutral workflow. It cannot authorize a configured legal checklist.</p>}
  </fieldset>;
}
