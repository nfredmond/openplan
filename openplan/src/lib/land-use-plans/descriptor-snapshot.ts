import { z } from "zod";
import type { JurisdictionPlanDescriptor } from "./contracts";

const text = z.string().min(1);
const sources = z.array(z.url({ protocol: /^https?$/ }));
const descriptorSchema = z.object({
  id: text, jurisdictionLabel: text, authorityScope: text, configured: z.boolean(),
  jurisdictionCoverage: z.object({ country: text, subdivision: text.optional() }).strict().optional(),
  verifiedAt: z.string().date(), reviewDueAt: z.string().date(),
  terminology: z.object({ plan: text, section: text, adoptionInstrument: text, implementationReport: text }).strict(),
  planKinds: z.array(z.object({ key: text, label: text }).strict()).min(1),
  requirements: z.array(z.object({ key: text, label: text,
    applicability: z.enum(["required", "conditional", "locally_defined"]), condition: text.optional(), sourceUrls: sources }).strict()),
  processSteps: z.array(z.object({ key: text, label: text, required: z.boolean(), decisionBody: text.optional(),
    deadline: text.optional(), reviewPrerequisite: z.boolean().optional(), adoptionPrerequisite: z.boolean().optional(), sourceUrls: sources }).strict()),
  disclosure: text, sourceUrls: sources,
}).strict();

/** Copy the complete descriptor used for this plan kind into the frozen record. */
export function snapshotPlanDescriptor(descriptor: JurisdictionPlanDescriptor, planKindKey: string): JurisdictionPlanDescriptor {
  const parsed = descriptorSchema.parse(descriptor);
  if (!parsed.planKinds.some(kind => kind.key === planKindKey)) throw new Error("Descriptor does not cover this plan kind");
  return parsed;
}

/** Absence is a legacy boundary. Malformed or mismatched saved rules never fall back. */
export function readFrozenPlanDescriptor(snapshot: Record<string, unknown>, descriptorId: string, planKindKey: string):
  { status: "retained"; descriptor: JurisdictionPlanDescriptor } | { status: "legacy" | "invalid" } {
  if (!Object.hasOwn(snapshot, "descriptorSnapshot")) return { status: "legacy" };
  const parsed = descriptorSchema.safeParse(snapshot.descriptorSnapshot);
  if (!parsed.success || parsed.data.id !== descriptorId || !parsed.data.planKinds.some(kind => kind.key === planKindKey)) return { status: "invalid" };
  return { status: "retained", descriptor: parsed.data };
}

export function describeDescriptorCustody(custody: "frozen" | "not_retained"): string {
  return custody === "frozen"
    ? "The checklist, terminology and source-review dates were saved with this version. This does not establish that the law remains current."
    : "This version did not retain its checklist or source-review dates. Any descriptor reference shown comes from the installed registry and may differ from what reviewers saw.";
}
