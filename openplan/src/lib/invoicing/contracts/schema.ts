import { deliveryCommandSchemas, type DeliveryState } from "./delivery-schema";
import { z } from "zod";
import { decimal } from "@/lib/programs/work-program/reporting";
import { date } from "@/lib/programs/work-program/schema";
const id = z.string().uuid();
const optionalId = id.nullable();
const text = z.string().trim().max(12000);
const amount = decimal.nullable();
export const taskSchema = z.object({ id, title: text.min(1).max(300), scope: text, fee: amount, cost: amount, hours: amount, deadline: date.nullable(), deliverableId: optionalId, staff: z.array(z.object({ staffId: id, hours: amount, cost: amount }).strict()).max(100) }).strict();
export const authorizationSchema = z.object({startsOn:date, endsOn:date, beneficiary:text.min(1), funding:text, costBasis:text.min(1), eligibility:z.enum(["unassessed","eligible","ineligible"]), eligibilityEvidence:text}).strict();
export const baselineSchema = z.object({ authorization: authorizationSchema.optional(), title: text.min(1).max(300), scope: text.min(1), currency: z.string().regex(/^[A-Z]{3}$/), fee: amount, cost: amount, hours: amount, feeBasis: z.enum(["gross_fee", "unassessed"]), feeTerms: text, sourceDocuments: z.array(id).min(1).max(100), approvalEvidence: text, tasks: z.array(taskSchema).min(1).max(1000) }).strict();
export const allocationSchema = z.object({ taskId: id, deliverableId: optionalId, share: z.number().int().positive().max(10000) }).strict();
const base = { requestId: id, expectedVersion: z.number().int().nonnegative() };
export const contractActualSchema = z.object({
 kind: z.literal("actual"), ...base, entryId: id, sourceKey: text.min(1).max(500), sourceReference: text.min(1), entryDate: date,
 category: z.enum(["labor", "expense", "opening", "commitment", "payment", "credit"]), status: z.enum(["draft", "approved", "excluded"]), description: text.min(1), staffId: optionalId,
 hours: amount, amount, valuationBasis: z.enum(["recorded", "cost_rate", "unvalued"]), rateId: optionalId, billable: z.boolean(),
 timeEntryId: optionalId, spendEntryId: optionalId, owpVersionId: optionalId, invoiceId: optionalId,
 allocations: z.array(allocationSchema).max(100), correctionNote: text, openingStart: date.nullable(), openingEnd: date.nullable(), openingBasis: text,
 reconciliationNote: text,
}).strict();
export const receivedLineSchema=z.object({description:text.min(1),amount:decimal,treatment:z.enum(["direct","indirect","fixed_fee"]),basis:text.min(1)}).strict();
export const receivedContentSchema=z.object({number:text.min(1).max(120),date,currency:z.string().regex(/^[A-Z]{3}$/),lines:z.array(receivedLineSchema).min(1).max(200)}).strict();
export const accountingFields=["externalId","sourceKey","amount","hours","currency"] as const;
export const accountingRowSchema=z.object({externalId:text.min(1),sourceKey:text.min(1),amount:decimal,hours:amount,currency:z.string().regex(/^[A-Z]{3}$/)}).strict();
export const contractCommandSchema = z.discriminatedUnion("kind", [
 ...deliveryCommandSchemas,
 z.object({kind:z.literal("order_period"),...base,baselineId:id,authorization:authorizationSchema,sourceDocumentId:id,evidence:text.min(1)}).strict(),
 z.object({kind:z.literal("accounting_import"),requestId:id,filename:text.min(1).max(240),csv:z.string().min(1).max(1000000),mapping:z.record(z.enum(accountingFields),z.string())}).strict(),
 z.object({kind:z.literal("accounting_review"),...base,importId:id,rowIndex:z.number().int().nonnegative(),actualVersionId:optionalId,state:z.enum(["reconciled","unresolved"]),evidence:text.min(1)}).strict(),
 z.object({kind:z.literal("access"),...base,email:z.string().email(),role:z.enum(["pm","finance","consultant"]),active:z.boolean(),evidence:text.min(1)}).strict(),
 z.object({kind:z.literal("received_invoice"),...base,invoiceId:id,content:receivedContentSchema,file:z.object({filename:text.min(1).max(240),contentType:z.enum(["application/pdf","text/csv"]),base64:z.string().min(1).max(1400000)}).strict()}).strict(),
 z.object({kind:z.literal("received_review"),...base,invoiceId:id,state:z.enum(["returned","reviewed","approved"]),note:text.min(1),matches:z.array(z.object({entryId:id,versionId:id,amount:decimal}).strict()).max(200)}).strict(),
 z.object({kind:z.literal("task_order"), requestId:id, engagementId:id, projectId:id, title:text.min(1).max(300)}).strict(),
 z.object({kind:z.literal("master_terms"), ...base, termsId:id, currency:z.string().regex(/^[A-Z]{3}$/), ceiling:decimal, startsOn:date, endsOn:date, terms:text.min(1), sourceDocumentId:id}).strict(),
 z.object({kind:z.literal("approve_master_terms"), ...base, termsId:id, approvalEvidence:text.min(1)}).strict(),
 z.object({ kind: z.literal("baseline"), ...base, baselineId: id, content: baselineSchema }).strict(),
 z.object({ kind: z.literal("approve"), ...base, baselineId: id, approvalEvidence: text.min(1) }).strict(),
 contractActualSchema,
 z.object({ kind: z.literal("rate"), requestId: id, rateId: id, staffId: id, basis: z.enum(["cost", "billing"]), startsOn: date, endsOn: date, hourlyRate: decimal, sourceReference: text.min(1) }).strict(),
 z.object({ kind: z.literal("estimate"), ...base, taskId: id, asOf: date, hours: amount, cost: amount, basis: text.min(1), progress: z.number().min(0).max(100).nullable(), progressNote: text }).strict(),
 z.object({ kind: z.literal("bill"), requestId: id, invoiceNumber: text.min(1).max(120), invoiceDate: date, dueDate: date.nullable(), retentionPercent: decimal, entryIds: z.array(id).min(1).max(500) }).strict(),
 z.object({ kind: z.literal("snapshot"), requestId: id, title: text.min(1).max(300), asOf: date, sourceCutoff: z.string().datetime({ offset: true }), coverageComplete: z.boolean(), coverageEvidence: text.min(1) }).strict(),
]);
export type ContractCommand = z.infer<typeof contractCommandSchema>;
export type ContractActual = z.infer<typeof contractActualSchema>;
export type ContractBaseline = z.infer<typeof baselineSchema>;
export type ContractAllocation = z.infer<typeof allocationSchema> & { amount: string | null; hours: string | null };
export type ActualVersion = { shared_source_stale?: boolean; id: string; entry_id: string; version: number; command: ContractActual; amount: string | null; hours: string | null; allocations: ContractAllocation[]; time_entry_id: string | null; spend_entry_id: string | null; created_at: string };
export type BaselineVersion = { source_receipts?: {id:string;title:string;checksum:string;storageRef:string;bytes:number|null}[]; id: string; version: number; state: "proposed" | "approved"; content: ContractBaseline; content_hash: string; approval_evidence: string; created_at: string; approved_at: string | null };
export type Estimate = { id: string; task_id: string; version: number; command: Extract<ContractCommand, { kind: "estimate" }>; created_at: string };
export type SharedOwpSource = {id:string;category:"labor"|"expense";timeEntryId:string|null;spendEntryId:string|null;staffId:string|null;hours:string|null;amount:string|null;entryDate:string;status:"draft"|"approved"|"excluded";sourceKey:string;sourceReference:string;description:string;billable:boolean};
export type MasterTerms = {source_receipt?:{id:string;checksum:string;storageRef:string;bytes:number|null};id:string; version:number; state:"proposed"|"approved"; currency:string; ceiling:string; starts_on:string; ends_on:string; terms:string; approval_evidence:string; source_document_id:string};
export type ReceivedInvoice = {id:string;invoice_id:string;version:number;state:"submitted"|"returned"|"reviewed"|"approved";content:z.infer<typeof receivedContentSchema>&{total:string;fileId:string};matches?:{entryId:string;versionId:string;amount:string}[];review_note:string;created_at:string};
export type AccountingImport={id:string;filename:string;source_hash:string;rows:z.infer<typeof accountingRowSchema>[];created_at:string};
export type AccountingReview={id:string;import_id:string;row_index:number;version:number;actual_version_id:string|null;state:"reconciled"|"unresolved";evidence:string;created_at:string};
export type ContractState = {unmappedSpendCount?:number;delivery?:DeliveryState;schemaVersion?:2|3;orderPeriods?:{id:string;baseline_id:string;version:number;authorization:z.infer<typeof authorizationSchema>;evidence:string;source_document_id:string}[];accountingImports?:AccountingImport[];accountingReviews?:AccountingReview[];access?:{id:string;email:string;user_id:string;version:number;role:"pm"|"finance"|"consultant";active:boolean;evidence:string}[];receivedInvoices?:ReceivedInvoice[]; taskOrders?:{id:string;title:string;project_id:string}[]; masterTerms?:MasterTerms[]; parentMasterTerms?:MasterTerms|null; owpSources?:SharedOwpSource[]; imports?: {id:string;filename:string;source_hash:string;created_at:string}[]; engagement: { id: string; workspace_id: string; project_id: string; title: string; parent_engagement_id: string | null; engagement_kind: string }; role: string; baselines: BaselineVersion[]; actuals: ActualVersion[]; estimates: Estimate[]; rates: { id: string; staff_id: string; basis: "cost" | "billing"; starts_on: string; ends_on: string; hourly_rate: string; source_reference: string }[]; staff: { id: string; name: string; active: boolean; user_id: string | null }[]; deliverables: { id: string; title: string }[]; documents: { id: string; title: string; checksum: string | null }[]; invoices: { id: string; invoice_number: string; status: string; subtotal_amount: string; retention_amount: string; currency_code: string; invoice_date: string | null; sent_date: string | null; updated_at: string }[]; billingSources: { id: string; entry_id: string; actual_version_id: string; invoice_id: string; billing_rate_id: string | null; lines: { lineId: string; taskId: string; deliverableId: string | null; amount: string; hours: string | null; share: number }[] }[]; unmappedTime: { id: string; hours: string; entry_date: string; staff_id: string; notes?:string|null; billable?:boolean }[]; unmappedSpend: { id: string; amount: string; entry_date: string; description?:string }[]; snapshots: { id: string; title: string; created_at: string; snapshot_hash: string }[] };
export type ContractSnapshot = { id: string; title: string; created_at: string; snapshot_hash: string; snapshot: ContractState & { asOf: string; sourceCutoff: string; coverageComplete: boolean; coverageEvidence: string; baselineId: string; originalBaselineId: string } };
