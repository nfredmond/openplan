import type { WorkProgramDraft, WorkProgramStructuredPreparation } from "./schema";

export type WorkProgramDiscrepancy = { code: string; message: string; rowIds: string[] };
const cents = (value: number) => Math.round(value * 100);
const sum = (values: (number | null)[]) => {
  if (!values.length || values.some((value) => value === null)) return null;
  const value = values.reduce<number>((total, item) => total + cents(item!), 0);
  return Number.isSafeInteger(value) ? value / 100 : null;
};
const difference = (a: number | null, b: number | null) => a === null || b === null ? null : (cents(a) - cents(b)) / 100;

/** Multiply decimal input quantities as rationals, then round once to the nearest cent. */
function laborCost(quantity: number, hoursPerUnit: number, rateCents: number) {
  if (![quantity, hoursPerUnit, rateCents].every((value) => Number.isFinite(value) && value >= 0) || !Number.isSafeInteger(rateCents)) return null;
  let numerator = BigInt(rateCents), denominator = BigInt(1);
  for (const value of [quantity,hoursPerUnit]) {
    const [mantissa, exponentText = "0"] = value.toString().toLowerCase().split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    const exponent = Number(exponentText) - fraction.length;
    numerator *= BigInt(whole + fraction);
    if (exponent >= 0) numerator *= BigInt(10) ** BigInt(exponent); else denominator *= BigInt(10) ** BigInt(-exponent);
  }
  const rounded = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) / 100 : null;
}


/** Keep the percent divisor exact until the final cent rounding. */
function percentageMatch(base: number, percent: number, shareOfTotal: boolean) {
  if (![base, percent].every((value) => Number.isFinite(value) && value >= 0) || !Number.isSafeInteger(cents(base))) return null;
  const [mantissa, exponentText = "0"] = percent.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const exponent = Number(exponentText) - fraction.length;
  let numerator = BigInt(whole + fraction), denominator = BigInt(1);
  if (exponent >= 0) numerator *= BigInt(10) ** BigInt(exponent); else denominator = BigInt(10) ** BigInt(-exponent);
  const divisor = BigInt(100) * denominator - (shareOfTotal ? numerator : BigInt(0));
  if (divisor <= BigInt(0)) return null;
  const value = BigInt(cents(base)) * numerator;
  const rounded = (value * BigInt(2) + divisor) / (divisor * BigInt(2));
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) / 100 : null;
}

export function emptyStructuredPreparation(): WorkProgramStructuredPreparation {
  return { formatVersion: 2, referenceFigures: [], extractionSelections: [], funds: [], allocations: [], costs: [], staffing: [], indirectPools: [], mappings: [], sourceSections: [], amendments: [], conflicts: [] };
}

/** Allocation rows span this proposal cycle; partial fund periods need an explicit unresolved review. */
export function fundCoversWorkProgram(fund: WorkProgramStructuredPreparation["funds"][number], draft: WorkProgramDraft) {
  return fund.periodStart <= draft.periodStart && fund.periodEnd >= draft.periodEnd && fund.periodStart <= fund.periodEnd;
}

/** All views consume these same proposal rows. Reference authority and pool totals are never revenue/cost. */
export function reconcileStructuredWorkProgram(draft: WorkProgramDraft) {
  const p = draft.preparation ?? emptyStructuredPreparation();
  const issues: WorkProgramDiscrepancy[] = [];
  const issue = (code: string, message: string, ...rowIds: string[]) => issues.push({ code, message, rowIds });
  const active = draft.elements.filter((element) => element.disposition !== "completed" && element.budgetTreatment !== "informational");
  const activeIds = new Set(active.map((element) => element.id));
  const funds = new Map(p.funds.map((fund) => [fund.id, fund]));
  const elements = new Map(draft.elements.map((element) => [element.id, element]));
  const allRows = [...(p.referenceFigures ?? []), ...p.funds, ...p.allocations, ...p.costs, ...p.staffing, ...p.indirectPools, ...p.mappings, ...p.sourceSections, ...p.amendments, ...p.conflicts];
  const ids = new Set<string>();
  for (const row of allRows) {
    if (ids.has(row.id)) issue("duplicate_id", "Repeated row identifier.", row.id);
    ids.add(row.id);
    if (!row.sourceRefs.length) issue("missing_source", "No supporting source passage is recorded.", row.id);
  }
  for (const row of [...p.allocations, ...p.costs, ...p.staffing]) {
    const element = elements.get(row.elementId);
    if (!element || (row.taskId && !element.tasks.some((task) => task.id === row.taskId))) issue("invalid_target", "The work element or task does not exist in this proposal.", row.id);
    if (element && !activeIds.has(element.id)) issue("excluded_target", "This row targets completed or informational work and is excluded from program totals.", row.id, element.id);
  }
  const allocationKeys = new Map<string, string>();
  for (const row of p.allocations) {
    const key = `${row.fundId}:${row.elementId}:${row.taskId ?? ""}`;
    const previous = allocationKeys.get(key);
    if (previous) issue("duplicate_allocation", "A funding vintage is allocated to the same work element/task twice. Resolve the duplicate.", previous, row.id);
    allocationKeys.set(key, row.id);
    const fund = funds.get(row.fundId);
    if (!fund) issue("missing_fund", "Allocation has no funding-source row.", row.id);
    else if (["prior_authority", "prior_balance"].includes(fund.kind) || fund.basis !== "proposed") issue("reference_allocation", "Prior authority, reference balances and unresolved funding cannot fund proposed work.", row.id, fund.id);
    if (row.amount === null) issue("missing_amount", "Proposed allocation amount is unresolved.", row.id);
    if (row.matchForFundId && (!funds.has(row.matchForFundId) || row.matchForFundId === row.fundId)) issue("invalid_match", "Match must identify a different retained funding source.", row.id);
  }
  const staff = p.staffing.map((row) => {
    const capacityKnown = row.capacityHours !== null && Boolean(row.capacityBasis.trim());
    const hours = row.quantity === null ? null : row.unit === "hours" ? row.quantity : row.hoursPerUnit != null && Boolean(row.capacityBasis.trim()) ? row.quantity * row.hoursPerUnit : null;
    if (hours === null || !capacityKnown) issue("staff_capacity", "Staff hours or the explicit capacity basis are unresolved. No FTE/hour conversion was assumed.", row.id);
    if (!row.staffId && !row.role.trim()) issue("staff_identity", "Choose an existing person or name an unfilled role.", row.id);
    if (row.periodStart < draft.periodStart || row.periodEnd > draft.periodEnd || row.periodEnd < row.periodStart) issue("staff_period", "Staff allocation period falls outside the proposed cycle or is reversed.", row.id);
    let cost: number | null = null;
    if (row.costTreatment === "calculate") {
      if (row.rate === null || row.rateBasis !== "labor_cost" || !row.rateNote.trim() || !row.sourceRefs.length || row.rateStart > row.periodStart || row.rateEnd < row.periodEnd) issue("labor_rate", "An explicit labor-cost rate, source and effective period are required. Billing rates are not labor costs.", row.id);
      else if (hours !== null) {
        const value = laborCost(row.quantity!, row.unit === "hours" ? 1 : row.hoursPerUnit!, cents(row.rate));
        if (value !== null) cost = value;
        else issue("unsafe_precision", "Labor calculation exceeds exact cent arithmetic.", row.id);
      }
      if (row.includesIndirect && p.costs.some((costRow) => costRow.elementId === row.elementId && costRow.category === "indirect")) issue("double_indirect", "The labor rate includes indirect costs also allocated in the expenditure table.", row.id);
      if (p.costs.some((costRow) => costRow.elementId === row.elementId && costRow.category === "labor_summary")) issue("double_labor", "Calculated staff costs overlap the salary/benefit summary for this work element.", row.id);
    }
    return { id: row.id, elementId: row.elementId, hours, cost };
  });
  const staffGroups = new Map<string, typeof p.staffing>();
  for (const row of p.staffing) {
    const key = `${row.staffId ?? row.role}:${row.periodStart}:${row.periodEnd}`;
    staffGroups.set(key, [...(staffGroups.get(key) ?? []), row]);
  }
  for (const rows of staffGroups.values()) {
    const capacity = rows[0].capacityHours;
    if (rows.some((row) => row.capacityHours !== capacity || row.capacityBasis !== rows[0].capacityBasis)) issue("capacity_conflict", "The same person's period has conflicting capacity assumptions.", ...rows.map((row) => row.id));
    const hours = rows.map((row) => staff.find((item) => item.id === row.id)!.hours);
    if (hours.some((value) => value === null)) issue("capacity_unresolved", "Combined staff capacity cannot be assessed while a contributing allocation has unknown hours.", ...rows.map((row) => row.id));
    if (capacity !== null && hours.every((value) => value !== null) && hours.reduce<number>((total, value) => total + value!, 0) > capacity + 0.000001) issue("staff_overallocated", "Planned staff hours exceed the stated period capacity.", ...rows.map((row) => row.id));
  }
  for (let i = 0; i < p.staffing.length; i++) for (let j = i + 1; j < p.staffing.length; j++) {
    const a = p.staffing[i], b = p.staffing[j];
    if ((a.staffId ?? a.role) === (b.staffId ?? b.role) && (a.periodStart !== b.periodStart || a.periodEnd !== b.periodEnd) && a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd) issue("staff_overlap_unresolved", "The same person's allocations use overlapping, different periods. Align periods before assessing combined capacity; no daily proration was assumed.", a.id, b.id);
  }
  for (const row of p.costs) {
    if (row.amount === null) issue("missing_amount", "Expenditure amount is unresolved.", row.id);
    if (row.category === "indirect" && !p.indirectPools.some((pool) => pool.id === row.indirectPoolId)) issue("indirect_basis", "Indirect allocation needs an identified pool so its costs are counted once.", row.id);
  }
  const byElement = active.map((element) => {
    const allocationRows = p.allocations.filter((row) => row.elementId === element.id);
    const costRows = p.costs.filter((row) => row.elementId === element.id);
    const labor = p.staffing.filter((row) => row.elementId === element.id && row.costTreatment === "calculate").map((row) => staff.find((item) => item.id === row.id)!.cost);
    const revenue = sum(allocationRows.map((row) => {
      const fund = funds.get(row.fundId);
      return fund?.basis === "proposed" && !["prior_authority", "prior_balance"].includes(fund.kind) && fundCoversWorkProgram(fund, draft) ? row.amount : null;
    }));
    const cost = sum([...costRows.map((row) => row.amount), ...labor]);
    const delta = difference(revenue, cost);
    if (revenue === null || cost === null) issue("element_unresolved", "Work-element funding or expenditure totals are unresolved.", element.id, ...allocationRows.map((row) => row.id), ...costRows.map((row) => row.id));
    else if (delta !== 0) issue("funding_gap", `Work-element revenue less cost is ${delta!.toFixed(2)} ${draft.currency}.`, element.id, ...allocationRows.map((row) => row.id), ...costRows.map((row) => row.id));
    if (element.budgetTreatment === "unresolved") issue("budget_treatment", "Decide whether this element belongs in program totals.", element.id);
    return { id: element.id, code: element.code, revenue, cost, difference: delta };
  });
  const byFund = p.funds.map((fund) => {
    const rows = p.allocations.filter((row) => row.fundId === fund.id && activeIds.has(row.elementId));
    const allocated = rows.length ? sum(rows.map((row) => row.amount)) : 0;
    if (fund.basis === "proposed" && !["prior_authority", "prior_balance"].includes(fund.kind) && !fundCoversWorkProgram(fund, draft)) issue("fund_period", "Funding dates do not cover this proposal cycle or are reversed. Availability remains unresolved; no partial-period allocation was assumed.", fund.id, ...rows.map((row) => row.id));
    const available = fund.basis === "proposed" && !["prior_authority", "prior_balance"].includes(fund.kind) && fundCoversWorkProgram(fund, draft) ? fund.amount : null;
    const remainder = difference(available, allocated);
    if (available === null && !["prior_authority", "prior_balance"].includes(fund.kind)) issue("fund_unresolved", "Proposed funding availability is unresolved.", fund.id);
    if (remainder !== null && remainder !== 0) issue(remainder < 0 ? "fund_overallocated" : "fund_unallocated", `Funding vintage has ${remainder.toFixed(2)} ${draft.currency} remaining after allocations.`, fund.id, ...rows.map((row) => row.id));
    const matchRows = p.allocations.filter((row) => row.matchForFundId === fund.id && activeIds.has(row.elementId));
    const providedMatch = matchRows.length ? sum(matchRows.map((row) => { const source = funds.get(row.fundId); return source?.basis === "proposed" && !["prior_authority", "prior_balance"].includes(source.kind) && source.id !== fund.id && fundCoversWorkProgram(source, draft) ? row.amount : null; })) : 0;
    let requiredMatch: number | null = null;
    if (fund.matchNote?.trim() && fund.sourceRefs.length) {
      if (fund.matchBasis === "not_required") requiredMatch = 0;
      else if (fund.matchValue != null && fund.matchValue >= 0) {
        if (fund.matchBasis === "amount") requiredMatch = Number.isSafeInteger(cents(fund.matchValue)) ? cents(fund.matchValue) / 100 : null;
        else if (allocated !== null && fund.matchBasis === "percent_funded_amount") requiredMatch = percentageMatch(allocated, fund.matchValue, false);
        else if (allocated !== null && fund.matchBasis === "percent_total_cost" && fund.matchValue < 100) requiredMatch = percentageMatch(allocated, fund.matchValue, true);
      }
    }
    const matchDifference = difference(providedMatch, requiredMatch);
    if (fund.basis === "proposed" && !["prior_authority", "prior_balance"].includes(fund.kind)) {
      if (requiredMatch === null || providedMatch === null) issue("match_unresolved", "Match requirement, applicability or contributing match amount is unresolved.", fund.id, ...matchRows.map((row) => row.id));
      else if (matchDifference! < 0) issue("match_gap", `Proposed match is short by ${(-matchDifference!).toFixed(2)} ${draft.currency}.`, fund.id, ...matchRows.map((row) => row.id));
    }
    return { id: fund.id, name: fund.name, vintage: fund.vintage, available, allocated, remainder, requiredMatch, providedMatch, matchDifference };
  });
  for (const pool of p.indirectPools) {
    const rows = p.costs.filter((row) => row.indirectPoolId === pool.id && row.category === "indirect" && activeIds.has(row.elementId));
    const allocated = rows.length ? sum(rows.map((row) => row.amount)) : 0;
    const delta = difference(pool.amount, allocated);
    if (delta === null || delta !== 0) issue("indirect_reconciliation", `Indirect pool less allocated costs: ${delta === null ? "unresolved" : delta.toFixed(2)}. The pool itself is excluded from expenditure totals.`, pool.id, ...rows.map((row) => row.id));
  }
  for (const row of p.conflicts) if (row.status === "unresolved" || !row.resolution.trim()) issue("source_conflict", row.description || "Conflicting source passages need an explicit resolution.", row.id);
  for (const row of p.amendments) if (row.status === "unresolved" || !row.note.trim() || row.amendmentSourceId === row.modifiesSourceId) issue("amendment_unresolved", "Record which source this amendment changes and explain its applicability. Dates do not establish precedence.", row.id);
  for (const row of p.sourceSections) if (row.status === "unresolved" || !row.note.trim()) issue("section_unresolved", `Material source section requires a decision: ${row.title}`, row.id);
  for (const row of p.mappings) {
    if (row.disposition === "unresolved" || !row.note.trim()) issue("mapping_unresolved", "Explain the mapping or retain it as unresolved.", row.id);
    if (row.targetIds.some((id) => !elements.has(id))) issue("mapping_target", "Mapped target does not exist in this proposal.", row.id);
    if (row.disposition === "split" && row.targetIds.length < 2) issue("split_targets", "Split work needs at least two proposed targets.", row.id);
    if (row.disposition === "merged" && row.sourceRefs.length < 2) issue("merge_sources", "Merged work needs multiple source references.", row.id);
  }
  const revenue = sum(byElement.map((row) => row.revenue)), cost = sum(byElement.map((row) => row.cost));
  if ((revenue === null && byElement.every((row) => row.revenue !== null) && byElement.length) || (cost === null && byElement.every((row) => row.cost !== null) && byElement.length)) issue("unsafe_precision", "Program totals exceed exact cent arithmetic.");
  const knownRevenue = sum(byElement.flatMap((row) => row.revenue === null ? [] : [row.revenue]));
  const knownCost = sum(byElement.flatMap((row) => row.cost === null ? [] : [row.cost]));
  return { revenue, cost, knownRevenue, knownCost, difference: difference(revenue, cost), byElement, byFund, staff, issues };
}
