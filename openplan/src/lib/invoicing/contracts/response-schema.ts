import { z } from "zod";
import { decimal } from "@/lib/programs/work-program/reporting";
import { scheduleSchema, workUpdateSchema, type ForecastResult } from "./delivery-schema";
const id=z.string().uuid(), note=z.string().trim().min(1).max(12000);
export const responseCommandSchemas=[
 z.object({kind:z.literal("response"),requestId:id,forecastId:id,recordType:z.enum(["risk","issue","decision"]),recordId:id,recordUpdatedAt:z.string().datetime({offset:true}),recordHash:z.string().regex(/^[a-f0-9]{64}$/),schedule:scheduleSchema,workAssumptions:z.array(z.object({update:workUpdateSchema,remainingCost:decimal.nullable(),remainingGrossBilling:decimal.nullable(),valuationEvidence:note}).strict()).max(200),evidence:note}).strict(),
 z.object({kind:z.literal("apply_response"),requestId:id,responseId:id,expectedVersion:z.number().int().nonnegative(),evidence:note}).strict(),
] as const;
export type ResponseCommand=z.infer<typeof responseCommandSchemas[0]>;
export type ManagementResponse={id:string;forecast_id:string;input_hash:string;content:{request:ResponseCommand;record:ProjectResponseRecord;inputs:unknown;before:ForecastResult;after:ForecastResult};created_at:string};
export type ProjectResponseRecord={id:string;recordType:"risk"|"issue"|"decision";title:string;status:string;updated_at:string;recordHash:string};
export type ResponseState={records:ProjectResponseRecord[];responses:ManagementResponse[];applications:{id:string;response_id:string;schedule_id:string;evidence:string;created_at:string}[]};
