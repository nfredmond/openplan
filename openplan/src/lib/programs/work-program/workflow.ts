import { z } from "zod";
import { date, type WorkProgramDraft } from "./schema";

export const workflowKinds = ["submit", "comment", "resolve_comment", "return", "approve", "adoption", "external_acceptance", "spending_authorization", "withdraw_authority", "start_amendment"] as const;
export const workflowLabels: Record<typeof workflowKinds[number], string> = {
  submit: "Submit for review", comment: "Request a change or comment", resolve_comment: "Resolve a comment", return: "Return for changes", approve: "Approve internally", adoption: "Record board adoption", external_acceptance: "Record external acceptance", spending_authorization: "Record spending authorization evidence", withdraw_authority: "Withdraw authority record", start_amendment: "Start amendment",
};
export const workflowCommandSchema = z.object({
  requestId: z.string().uuid(), expectedSequence: z.number().int().nonnegative(), expectedRevision: z.number().int().positive(),
  revisionId: z.string().uuid(), revisionHash: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(workflowKinds),
  note: z.string().trim().min(1).max(12000), visibility: z.enum(["internal", "public"]),
  reviewerIds: z.array(z.string().uuid()).max(50).default([]), dueOn: date.nullable().default(null),
  documentIds: z.array(z.string().uuid()).max(50).default([]), evidenceDate: date.nullable().default(null),
  authority: z.string().trim().max(240).default(""), scope: z.string().trim().max(12000).default(""),
  targetEventId: z.string().uuid().nullable().default(null),
}).strict();
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;
export type WorkflowEvent = { id: string; sequence: number; revision_id: string; revision_hash: string; kind: WorkflowCommand["kind"]; actor_id: string; created_at: string; payload: WorkflowCommand; evidence: { id: string; title: string; checksum: string }[] };
export type WorkflowAssignment = { id: string; revision_id: string; submission_id: string; assignee_user_id: string; due_on: string | null; status: "pending" | "approved" | "returned" | "superseded"; };
export type WorkflowState = { sequence: number; effective_revision_id: string | null; submission_revision_id: string | null; submission_id: string | null; status: string };
export type WorkflowData = { state: WorkflowState; events: WorkflowEvent[]; assignments: WorkflowAssignment[]; members: { id: string; label: string }[]; comparison?: { baselineRevision: number; changes: { path: string; before: unknown; after: unknown }[] } | null; effective?: { revision: number; revenue: number | null; cost: number | null; currency: string } | null };
export const emptyWorkflow: WorkflowState = { sequence: 0, effective_revision_id: null, submission_revision_id: null, submission_id: null, status: "draft" };

/** Compare stable identities recursively; additions, removals and unknown values remain explicit. */
export function workProgramDifferences(before: WorkProgramDraft, after: WorkProgramDraft): { path: string; before: unknown; after: unknown }[] {
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  function walk(a: unknown, b: unknown, path: string) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every(row => row && typeof row === "object" && "id" in row)) {
      const left = new Map(a.map(row => [row.id, row])), right = new Map(b.map(row => [row.id, row]));
      if (left.size !== a.length || right.size !== b.length) {
        for (let index = 0; index < Math.max(a.length, b.length); index++) walk(a[index], b[index], `${path}[row ${index + 1}; duplicate identity]`);
        return;
      }
      for (const id of new Set([...left.keys(), ...right.keys()])) {
        const row = right.get(id) ?? left.get(id);
        const label = [row.code, row.title ?? row.description ?? row.label ?? row.name].filter(Boolean).join(" ");
        walk(left.get(id), right.get(id), `${path}[${label || id}]`);
      }
    } else if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === "object" && typeof b === "object") {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], path ? `${path}.${key}` : key);
    } else changes.push({ path, before: a, after: b });
  }
  walk(before, after, "");
  return changes;
}

const differenceNames: Record<string, string> = {
  elements: "Work element", products: "Product", tasks: "Task", preparation: "Financial preparation",
  costs: "Expenditure", funds: "Funding source", fundingSources: "Funding source", allocations: "Allocation", staffing: "Staffing",
  sourceFigures: "Source figure", indirectPools: "Indirect pool", mappings: "Work mapping",
  materialSections: "Source section", amendmentRelationships: "Amendment relationship", conflicts: "Source conflict",
  amount: "Amount", description: "Description", schedule: "Schedule", title: "Title", code: "Code",
  introduction: "Program narrative", priorBalance: "Prior-year balance", sourceRefs: "Source references",
};
const differenceFieldName = (field: string) => differenceNames[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());

/** Display stable-row differences in the terminology a planner uses in the editor. */
export function workProgramDifferenceLabel(path: string): string {
  return path.split(/\.(?![^\[]*\])/).map(part => {
    const match = part.match(/^([^[]+)(.*)$/);
    return match ? `${differenceFieldName(match[1])}${match[2].replace(/\[([^\]]*)\]/g, " — $1")}` : part;
  }).join(" / ");
}

/** Preserve unknown and absent values without presenting either as zero. */
export function workProgramDifferenceValue(value: unknown): string {
  if (value === null) return "Unresolved";
  if (value === undefined) return "Not present in this version";
  if (value === "") return "Not recorded";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 20 });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(workProgramDifferenceValue).join("\n") : "No entries";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${differenceFieldName(key)}: ${workProgramDifferenceValue(item)}`).join("\n");
  return String(value);
}
