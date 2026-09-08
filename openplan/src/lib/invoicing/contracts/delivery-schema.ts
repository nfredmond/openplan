import { z } from "zod";
import { date } from "@/lib/programs/work-program/schema";
import { decimal } from "@/lib/programs/work-program/reporting";
const id=z.string().uuid(), note=z.string().trim().max(12000), amount=decimal.nullable();
const base={requestId:id,expectedVersion:z.number().int().nonnegative()};
export const workingCalendarSchema=z.object({name:note.min(1),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),exceptions:z.array(z.object({date,working:z.boolean(),reason:note.min(1)}).strict()).max(730)}).strict();
export const capacitySchema=z.object({staffId:id,startsOn:date,endsOn:date,hoursPerDay:decimal,calendar:workingCalendarSchema,evidence:note.min(1)}).strict();
export const scheduleNodeSchema=z.object({id,taskId:id,title:note.min(1).max(300),kind:z.enum(["work","client_review","agency_review","public_review"]),notBefore:date,reserveThrough:date,predecessors:z.array(id).max(200),calendar:workingCalendarSchema,durationDays:z.number().int().min(0).max(730).nullable(),durationKind:z.enum(["working","calendar"]),reviewEvidence:note,reviewStatus:z.enum(["available","unavailable","unassessed"]),staff:z.array(z.object({staffId:id,hoursPerDay:decimal}).strict()).max(100)}).strict();
export const scheduleSchema=z.object({nodes:z.array(scheduleNodeSchema).max(200),updateDueOn:date,billingTreatment:z.enum(["unassessed","fixed_fee","time_materials"]),billingSourceId:id.nullable(),billingEvidence:note,assumptions:note.min(1)}).strict();
export const workUpdateSchema=z.object({taskId:id,staffId:id,asOf:date,hours:amount,availableHoursPerDay:amount,status:z.enum(["not_started","in_progress","blocked","reported_complete"]),actualStart:date.nullable(),actualFinish:date.nullable(),blockers:note,evidence:note.min(1)}).strict();
export const deliveryCommandSchemas=[
 z.object({kind:z.literal("capacity"),...base,content:capacitySchema}).strict(),
 z.object({kind:z.literal("schedule"),...base,content:scheduleSchema}).strict(),
 z.object({kind:z.literal("work_update"),...base,content:workUpdateSchema}).strict(),
 z.object({kind:z.literal("work_review"),...base,updateId:id,state:z.enum(["accepted","returned"]),remainingCost:amount,remainingGrossBilling:amount,valuationEvidence:note,evidence:note.min(1)}).strict(),
 z.object({kind:z.literal("forecast"),requestId:id,asOf:date,horizonEnd:date,coverageComplete:z.boolean(),coverageEvidence:note.min(1),reviewEvidence:note.min(1)}).strict(),
] as const;
export const deliveryCommandSchema=z.discriminatedUnion("kind",deliveryCommandSchemas);
export type WorkingCalendar=z.infer<typeof workingCalendarSchema>;
export type Capacity=z.infer<typeof capacitySchema>;
export type Schedule=z.infer<typeof scheduleSchema>;
export type WorkUpdate=z.infer<typeof workUpdateSchema>;
export type DeliveryCommand=z.infer<typeof deliveryCommandSchema>;
export type ScheduleVersion={id:string;version:number;content:Schedule;created_at:string};
export type WorkUpdateVersion={reviewed_update_id?:string|null;id:string;version:number;task_id:string;staff_id:string;state:"submitted"|"accepted"|"returned";content:WorkUpdate;remaining_cost:string|null;remaining_gross_billing:string|null;valuation_evidence:string;evidence:string;created_at:string};
export type CapacityVersion={id:string;version:number;staff_id:string;content:Capacity;created_at:string};
export type OutsideReservation={staffId:string;date:string;hours:string};
export type DeliveryState={scheduleVersions:ScheduleVersion[];workUpdates:WorkUpdateVersion[];capacityVersions:CapacityVersion[];outsideReservations:OutsideReservation[];inputHash:string;forecasts:ForecastVersion[]};
export type ForecastWarning={code:string;nodeId:string|null;staffId:string|null;date:string|null;message:string};
export type ForecastResult={formatVersion:1;asOf:string;horizonEnd:string;finish:string|null;remainingCost:string|null;actualPlusRemaining:string|null;remainingGrossBilling:string|null;coverageComplete:boolean;warnings:ForecastWarning[];nodes:{id:string;title:string;taskId:string;start:string|null;finish:string|null;originalApprovedFinish:string|null;currentApprovedFinish:string|null;actualStart:string|null;actualFinish:string|null}[];reservations:OutsideReservation[]};
export type ForecastVersion={id:string;version:number;input_hash:string;content:{inputs:unknown;result:ForecastResult;reviewEvidence:string;coverageEvidence:string};created_at:string};
