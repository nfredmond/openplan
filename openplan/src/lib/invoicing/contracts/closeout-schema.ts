import { z } from "zod";
import { date } from "@/lib/programs/work-program/schema";
import { decimal } from "@/lib/programs/work-program/reporting";
const id=z.string().uuid(),note=z.string().trim().max(12000),required=note.min(1),base={requestId:id,expectedVersion:z.number().int().nonnegative()};
export const settlementEventSchema=z.object({eventId:id,sourceKey:required.max(500),direction:z.enum(["outgoing","received"]),invoiceId:id,invoiceVersion:required,date,kind:z.enum(["payment","credit","refund","retention_hold","retention_release","dispute_open","dispute_resolve","adjustment_debit","adjustment_credit"]),amount:decimal,currency:z.string().regex(/^[A-Z]{3}$/),state:z.enum(["recorded","excluded"]),documentId:id,sourceReference:required,correctionEvidence:note,legacyActualId:id.nullable()}).strict();
export const obligationSchema=z.object({id,title:required,owner:required,dueOn:date.nullable(),status:z.enum(["open","satisfied"]),basis:required}).strict();
export const closeoutCommandSchemas=[
 z.object({kind:z.literal("settlement"),...base,content:settlementEventSchema}).strict(),
 z.object({kind:z.literal("deliverable_event"),...base,deliverableId:id,state:z.enum(["submitted","returned","resubmitted","accepted"]),date,documentId:id,authority:required,evidence:required}).strict(),
 z.object({kind:z.literal("closeout"),...base,title:required.max(300),asOf:date,coverageComplete:z.boolean(),coverageEvidence:required,workAccepted:z.boolean(),workAuthority:required,financialSettled:z.boolean(),financeAuthority:required,obligations:z.array(obligationSchema).max(200),evidence:required}).strict(),
 z.object({kind:z.literal("reopen"),...base,closeoutId:id,evidence:required}).strict(),
] as const;
export type SettlementEvent=z.infer<typeof settlementEventSchema>;
export type SettlementVersion={id:string;version:number;content:SettlementEvent;source_receipt:{id:string;checksum:string;storageRef:string;bytes:number|null};created_at:string};
export type DeliverableEvent={id:string;version:number;deliverable_id:string;state:"submitted"|"returned"|"resubmitted"|"accepted";date:string;authority:string;evidence:string;source_receipt:{id:string;checksum:string;storageRef:string;bytes:number|null};created_at:string};
export type CloseoutCommand=z.infer<typeof closeoutCommandSchemas[2]>;
export type CloseoutVersion={id:string;version:number;state:"closed"|"reopened";previous_id:string|null;input_hash:string;content:{request:CloseoutCommand;evidence?:string;package?:unknown;position?:CloseoutPosition};content_hash:string;created_at:string};
export type CloseoutState={settlements:SettlementVersion[];deliverableEvents:DeliverableEvent[];versions:CloseoutVersion[];inputHash:string};
export type InvoicePosition={id:string;direction:"outgoing"|"received";number:string;currency:string;version:string;gross:string;payments:string;credits:string;refunds:string;adjustments:string;retention:string;disputed:string;open:string;currentlyDue:string;warnings:string[]};
export type CloseoutPosition={invoices:InvoicePosition[];workAccepted:boolean;financialSettled:boolean;incurred:string;authorizedCost:string|null;underspend:string|null;commitments:string;warnings:string[];openObligations:number};
