"use client";
import type { z } from "zod";
import type { workProgramSourceRefSchema } from "@/lib/programs/work-program/schema";
import type { WorkProgramSource } from "@/lib/programs/work-program/types";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "./fields";

export type SourceReference = z.infer<typeof workProgramSourceRefSchema>;
export function WorkProgramReferences({ value, sources, onChange }: { value: SourceReference[]; sources: WorkProgramSource[]; onChange: (value: SourceReference[]) => void }) {
  return <details className="rounded border p-2"><summary className="cursor-pointer text-sm">Source passages ({value.length})</summary><div className="mt-3 space-y-3">
    {value.map((ref, index) => {
      const source = sources.find((row) => row.id === ref.sourceId);
      const update = (patch: Partial<SourceReference>) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row));
      return <div key={index} className="space-y-2 rounded border p-2">
        <SelectField label="Source document" value={ref.sourceId} onChange={(sourceId) => update({ sourceId, extractionVersionId: null, elementKey: null })}>{sources.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</SelectField>
        <SelectField label="Extraction version" value={ref.extractionVersionId ?? ""} onChange={(id) => update({ extractionVersionId: id || null, elementKey: null })}><option value="">Original attachment</option>{source?.versions?.map((row) => <option key={row.id} value={row.id}>{row.created_at} · {row.extraction_json.parser}</option>)}</SelectField>
        <div className="grid grid-cols-2 gap-2"><Field label="First PDF page" type="number" value={String(ref.pageFrom)} onChange={(value) => update({ pageFrom: Number(value), elementKey: null })} /><Field label="Last PDF page" type="number" value={String(ref.pageTo)} onChange={(value) => update({ pageTo: Number(value), elementKey: null })} /></div>
        <Field label="Table or passage" value={ref.tableLabel} onChange={(tableLabel) => update({ tableLabel })} /><Field label="Figure, assumption or field supported" value={ref.purpose ?? ""} onChange={(purpose) => update({ purpose })} />
        {source && <a className="block text-sm underline" href={`/api/knowledge-base/documents/${source.document_id}/download?disposition=inline#page=${ref.pageFrom}`} target="_blank" rel="noreferrer">Open original at PDF page {ref.pageFrom}</a>}
        <Button type="button" variant="outline" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove passage</Button>
      </div>;
    })}
    <Button type="button" variant="outline" disabled={!sources.length} onClick={() => onChange([...value, { sourceId: sources[0].id, extractionVersionId: sources[0].selectedVersionId ?? null, elementKey: null, pageFrom: 1, pageTo: 1, tableLabel: "", purpose: "" }])}>Add source passage</Button>
  </div></details>;
}
