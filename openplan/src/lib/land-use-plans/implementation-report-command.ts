import { z } from "zod";

const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const date = z.string().date().refine(value => !value.startsWith("0000-"));
const reportText = z.string().refine(value => !value.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(value));
export const IMPLEMENTATION_REPORT_COMMAND_LIMIT = 98_304;
export const implementationReportScopeSchema = z.object({ actorId: uuid, workspaceId: uuid, planId: uuid }).strict();
export type ImplementationReportScope = z.infer<typeof implementationReportScopeSchema>;
export const implementationReportCommandSchema = z.object({
  operation: z.literal("generate"), commandId: uuid, versionId: uuid, expectedVersionHash: hash,
  reportingPeriodStart: date, reportingPeriodEnd: date,
  title: reportText.refine(value => value === value.trim() && [...value].length >= 1 && [...value].length <= 180),
  summary: reportText.refine(value => [...value].length <= 20_000).nullable(),
}).strict().refine(value => value.reportingPeriodEnd >= value.reportingPeriodStart);
export type ImplementationReportCommand = z.infer<typeof implementationReportCommandSchema>;
export const implementationReportResultSchema = implementationReportScopeSchema.extend({
  replayed: z.boolean(), commandId: uuid, commandSha256: hash, versionId: uuid, adoptedVersionContentHash: hash,
  reportId: uuid, artifactId: uuid, implementationReportId: uuid, contentHash: hash,
  reportingPeriodStart: date, reportingPeriodEnd: date, title: z.string(), summary: z.string().nullable(),
  generatedAt: z.iso.datetime({ offset: true }),
}).strict();
export type ImplementationReportResult = z.infer<typeof implementationReportResultSchema>;

/** A receipt must describe the original command and its authenticated plan scope. */
export function matchesImplementationReport(result: ImplementationReportResult, scope: ImplementationReportScope, command: ImplementationReportCommand) {
  return result.actorId === scope.actorId && result.workspaceId === scope.workspaceId && result.planId === scope.planId
    && result.commandId === command.commandId && result.versionId === command.versionId
    && result.adoptedVersionContentHash === command.expectedVersionHash
    && result.reportingPeriodStart === command.reportingPeriodStart && result.reportingPeriodEnd === command.reportingPeriodEnd
    && result.title === command.title && result.summary === command.summary;
}
