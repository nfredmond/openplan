import type { JurisdictionPlanDescriptor } from "./contracts";

/** Select one kind without borrowing rules from an unknown or mismatched family. */
export function selectPlanKindRules(
  family: JurisdictionPlanDescriptor,
  planKindKey: string,
  variants: Readonly<Record<string, JurisdictionPlanDescriptor>> = {},
): JurisdictionPlanDescriptor | null {
  const selected = family.planKinds.find(kind => kind.key === planKindKey);
  if (!selected) return null;
  const rules = variants[planKindKey] ?? family;
  if (rules.id !== family.id || !rules.planKinds.some(kind => kind.key === planKindKey)) return null;
  // Return a detached selection. A caller must not rewrite installed source data.
  return structuredClone({ ...rules, planKinds: [selected] });
}

/** Tuple encoding avoids collisions between family and kind identifiers. */
export function planDescriptorSelectionKey(descriptorId: string, planKindKey: string): string {
  return JSON.stringify([descriptorId, planKindKey]);
}
