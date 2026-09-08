import { parse } from "csv-parse/sync";
import { actualCommandSchema, type ActualCommand } from "./reporting";
import { createHash, randomUUID } from "node:crypto";

export const importFields = ["sourceKey", "entryDate", "description", "hours", "amount", "staffId", "elementId", "taskId", "projectId"] as const;
export type ImportMapping = Partial<Record<typeof importFields[number], string>>;
/** Preview retains the file hash, row number and mapped source key. Importing uses these exact validated commands. */
export function previewActualCsv(csv: string, filename: string, mapping: ImportMapping, defaults: ActualCommand, existingKeys: string[]) {
 const records = parse(csv, { columns: true, bom: true, skip_empty_lines: true, max_record_size: 50_000 }) as Record<string, string>[];
 if (records.length > 2000) throw new Error("Import at most 2,000 rows per file; split larger files without changing source keys.");
 const hash = createHash("sha256").update(csv).digest("hex");
 const seen = new Set(existingKeys);
 const rows = records.map((record, index) => {
  const values = Object.fromEntries(importFields.filter(f => mapping[f]).map(f => [f, record[mapping[f]!] ?? ""]));
  const sourceKey = values.sourceKey?.trim();
  const candidate = { ...defaults, requestId: randomUUID(), entryId: randomUUID(), expectedVersion: 0,
   ...Object.fromEntries(Object.entries(values).filter(([key]) => !["elementId", "taskId"].includes(key)).map(([key, value]) => [key, value.trim() || null])),
   sourceKey, sourceReference: `${filename}; sha256:${hash}; CSV data row ${index + 1}; ${defaults.sourceReference}`,
   allocations: values.elementId ? [{ elementId: values.elementId, taskId: values.taskId || null, deliverableId: null, share: 10000 }] : defaults.allocations,
  };
  const parsed = actualCommandSchema.safeParse(candidate);
  const duplicate = !!sourceKey && seen.has(sourceKey);
  if (sourceKey) seen.add(sourceKey);
  return { row: index + 1, duplicate, errors: !sourceKey ? ["Map a stable source key from the originating system"] : !parsed.success ? parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) : [], command: parsed.success && !duplicate ? parsed.data : null };
 });
 return { filename, hash, columns: records.length ? Object.keys(records[0]) : [], rows };
}
