import { z } from "zod";
import { moneyCents, moneyFromCents, type ExactMoneyAmount } from "@/lib/money/optional-amount";

// Preview and apply share this deliberate UTF-8 JSON transport limit. Never truncate review data.
export const AWARD_HANDOFF_BODY_LIMIT = 2 * 1024 * 1024;
export function serializeHandoffApply(review: { reviewed: Record<string, unknown>; reviewHash: string }): string {
  const body = JSON.stringify({ operation: "apply", reviewed: review.reviewed, reviewHash: review.reviewHash });
  if (new TextEncoder().encode(body).byteLength > AWARD_HANDOFF_BODY_LIMIT) throw new Error("The complete reviewed handoff exceeds the 2 MiB transport limit. No ready review or partial handoff is available.");
  return body;
}

export const AWARD_HANDOFF_MIGRATION = "20261018000003_award_condition_handoff";
export const HANDOFF_AWARD_SELECT = "id, workspace_id, project_id, funding_opportunity_id, title, awarded_amount, match_amount, currency_code, latest_handoff_revision_id, current_handoff_revision_id, has_source_backed_issuance, spending_status";
export const HANDOFF_INVOICE_FIELDS = "award_handoff_revision_id, currency_code, handoff_applicable_revision_id";
const text = z.string().trim().min(1).max(12000);
const id = z.string().uuid();
export const exactAmountSchema = z.union([z.number(), z.string()]).superRefine((value, ctx) => {
  try { storageMoney(value, "award"); } catch (error) { ctx.addIssue({ code: "custom", message: String(error) }); }
});

/** Validate the storage column independently. Never round money into range. */
export function storageMoney(value: ExactMoneyAmount, kind: "award" | "invoice"): ExactMoneyAmount {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error("Enter a nonnegative amount with at most two decimal places");
  const cents = moneyCents(value);
  if (cents > BigInt(kind === "award" ? "99999999999999" : "999999999999")) throw new Error(`${kind} amount exceeds its storage range`);
  return moneyFromCents(cents);
}

// A currency descriptor confirms cent precision explicitly. Geography supplies no currency.
export const currencySchema = z.object({ code: z.string().regex(/^[A-Z]{3}$/), minorUnits: z.literal(2), source: text }).strict().refine((c)=>{try{return new Intl.NumberFormat("en",{style:"currency",currency:c.code}).resolvedOptions().maximumFractionDigits===2;}catch{return false;}},"This currency requires unsupported precision; no rounding or exchange is available");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}, "Invalid calendar date");
export const awardClockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date_only"), date: dateOnly }).strict(),
  z.object({ kind: z.literal("instant"), value: z.string().datetime({ offset: true }), sourceZone: text, calendarDate: dateOnly, calendarDateBasis: text }).strict(),
  z.object({ kind: z.literal("unresolved_trigger"), trigger: text }).strict(),
]);
const sourceSchema = z.object({ family: z.enum(["kb_pdf", "application_pdf"]), id, version: text, sourceDate: text, citation: text }).strict();
export const occurrenceSchema = z.object({
  conditionKey: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/), occurrenceKey: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  requirement: text, responsibleParty: text, citation: text,
  kind: z.enum(["report", "obligation", "expenditure"]), clock: awardClockSchema,
  disposition: z.enum(["new", "carry", "reschedule", "replace", "reopen", "withdraw", "adopt_legacy"]),
  legacyObligationId: id.nullable().default(null),
  priorOccurrenceId: id.nullable(), reason: text, distinctSourceIdentity: text,
  fulfillmentStillApplies: z.boolean(),
}).strict();
export const awardTermsSchema = z.object({
  ceiling: exactAmountSchema, match: exactAmountSchema, currency: currencySchema,
  issued: z.literal(true), issuanceDisposition:z.object({state:z.enum(["issued","rescinded","corrected"]),evidence:text,priorRevisionId:id.nullable()}).strict(), recipient: text, funder: text, scope: text, differences: text, commitments: text,
  applicability: text, submissionReceipt: text, scheduleCoverage: text,
  acceptance: z.enum(["not_recorded", "pending", "accepted", "declined"]), acceptanceEvidence: text, acceptanceSourceId:id.nullable(),
  authorization: z.object({ state: z.enum(["not_recorded", "not_authorized", "authorized"]), amount: exactAmountSchema.nullable(), amountCurrencyCode:z.string().regex(/^[A-Z]{3}$/).nullable(), unknownReason: text, sourceId:id.nullable(), authority: text, scope: text, period: text, evidence: text }).strict(),
  effective: z.boolean(), effectiveEvidence: text, sources: z.array(sourceSchema).min(1).max(40), noticeSourceId: id,
  occurrences: z.array(occurrenceSchema).max(200),
  invoiceApplicability: z.array(z.object({ invoiceId: id, reason: text })).max(500),
}).strict().superRefine((terms, ctx) => {
  if (!terms.sources.some((source) => source.id === terms.noticeSourceId && source.family === "kb_pdf")) ctx.addIssue({ code: "custom", message: "Select an uploaded actual notice PDF" });
  const sourced=(sourceId:string|null)=>terms.sources.some((s)=>s.id===sourceId);
  const actual=(value:string)=>value.trim().length>0 && !/not recorded|unresolved|unknown/i.test(value);
  if(['accepted','declined'].includes(terms.acceptance) && (!sourced(terms.acceptanceSourceId)||!actual(terms.acceptanceEvidence)))ctx.addIssue({code:"custom",message:"Recipient acceptance/decline requires its actual retained source and provision"});
  if((terms.authorization.state!=='not_recorded'||terms.authorization.amount!==null) && (!sourced(terms.authorization.sourceId)||![terms.authorization.authority,terms.authorization.scope,terms.authorization.period,terms.authorization.evidence].every(actual)))ctx.addIssue({code:"custom",message:"Actual authorization state/amount requires retained source, authority, scope, period and provision"});
  if(terms.authorization.amount!==null && (!terms.authorization.amountCurrencyCode || !currencySchema.safeParse({code:terms.authorization.amountCurrencyCode,minorUnits:2,source:terms.authorization.evidence}).success))ctx.addIssue({code:"custom",message:"Independently sourced authorization amount needs its own supported currency"});
  if(new Set(terms.sources.map((s)=>`${s.family}/${s.id}`)).size!==terms.sources.length)ctx.addIssue({code:"custom",message:"Select each retained PDF source once"});
  const keys = new Set<string>();
  for (const occurrence of terms.occurrences) {
    const key = `${occurrence.conditionKey}/${occurrence.occurrenceKey}`;
    if (keys.has(key)) ctx.addIssue({ code: "custom", message: "Occurrence keys must be distinct beneath each condition" });
    keys.add(key);
    if (occurrence.disposition === "adopt_legacy" && (occurrence.kind !== "obligation" || !occurrence.legacyObligationId || occurrence.priorOccurrenceId || !occurrence.fulfillmentStillApplies)) ctx.addIssue({code:"custom",message:"Legacy adoption requires the selected obligation, explicit fulfillment applicability and no prior managed occurrence"});
    if (occurrence.disposition !== "adopt_legacy" && occurrence.legacyObligationId) ctx.addIssue({code:"custom",message:"Legacy target selection belongs only to explicit adoption"});
    if (!["new", "adopt_legacy"].includes(occurrence.disposition) && !occurrence.priorOccurrenceId) ctx.addIssue({ code: "custom", message: "Reconciliation requires its prior occurrence" });
  }
});
export type AwardTerms = z.infer<typeof awardTermsSchema>;
export type AwardOccurrence = z.infer<typeof occurrenceSchema>;
export const handoffRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("preview"), opportunityId: id, requestKey: id, terms: awardTermsSchema }).strict(),
  z.object({ operation: z.literal("apply"), reviewed: z.record(z.string(), z.unknown()), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export type ComparableAward = {
  id?: string; current_handoff_revision_id?: string | null; latest_handoff_revision_id?: string | null;
  currency_code?: string | null; awarded_amount?: ExactMoneyAmount | null; match_amount?: ExactMoneyAmount | null;
};
export type ComparableFunding = {
  state: "exact" | "unassessed"; amountMeaning: "recorded_award_ceiling"; currency: string | null;
  ceiling: ExactMoneyAmount | null; match: ExactMoneyAmount | null; reasons: string[];
  versions: Array<{ awardId: string; revisionId: string }>;
};
/** An incomplete or mixed stack has no combined total. Individual records remain readable. */
export function comparableAwardFunding(awards: ComparableAward[]): ComparableFunding {
  const reasons: string[] = []; const currencies = new Set<string>(); let ceiling = BigInt(0); let match = BigInt(0);
  const versions: ComparableFunding["versions"] = [];
  for (const award of awards) {
    if (!award.id || !award.current_handoff_revision_id || !award.currency_code) { reasons.push("Award currency or applicable terms version is unassessed"); continue; }
    currencies.add(award.currency_code); versions.push({ awardId: award.id, revisionId: award.current_handoff_revision_id });
    try { ceiling += moneyCents(storageMoney(award.awarded_amount!, "award")); match += moneyCents(storageMoney(award.match_amount!, "award")); }
    catch { reasons.push("Award money is unavailable or invalid"); }
  }
  if (currencies.size !== 1) reasons.push("A single comparable currency is not established");
  return { state: reasons.length ? "unassessed" : "exact", amountMeaning: "recorded_award_ceiling", currency: currencies.size === 1 ? [...currencies][0] : null, ceiling: reasons.length ? null : moneyFromCents(ceiling), match: reasons.length ? null : moneyFromCents(match), reasons: [...new Set(reasons)], versions };
}

/** Keep retention and net exact, with each NUMERIC(12,2) bound checked separately. */
export function exactInvoiceAmounts(amount: ExactMoneyAmount, percent: ExactMoneyAmount) {
  const gross = moneyCents(storageMoney(amount, "invoice")); const basisPoints = moneyCents(percent);
  if (basisPoints < BigInt(0) || basisPoints > BigInt(10000)) throw new Error("Invalid retention percentage");
  const retention = (gross * basisPoints + BigInt(5000)) / BigInt(10000);
  return { amount: storageMoney(amount, "invoice"), retentionAmount: storageMoney(moneyFromCents(retention), "invoice"), netAmount: storageMoney(moneyFromCents(gross - retention), "invoice") };
}

export type ManagedInvoice = {
  id?: string | null; funding_award_id?: string | null; award_handoff_revision_id?: string | null;
  handoff_applicable_revision_id?: string | null; currency_code?: string | null;
  status?: string | null; amount?: ExactMoneyAmount | null; retention_amount?: ExactMoneyAmount | null; net_amount?: ExactMoneyAmount | null;
};
export type ManagedInvoiceTotals = { state: "exact" | "unassessed"; currency: string | null; reasons: string[]; grossClaimed: ExactMoneyAmount | null; paid: ExactMoneyAmount | null; outstanding: ExactMoneyAmount | null; draft: ExactMoneyAmount | null; rejected: ExactMoneyAmount | null; retentionHeld: ExactMoneyAmount | null; retentionPending: ExactMoneyAmount | null; rows: ManagedInvoice[] };
export function managedInvoiceTotals(rows: ManagedInvoice[], award?: ComparableAward): ManagedInvoiceTotals {
  const currencies = new Set<string>(); const reasons: string[] = [];
  let claimed = BigInt(0), paid = BigInt(0), outstanding = BigInt(0), draft = BigInt(0), rejected = BigInt(0), held = BigInt(0), pending = BigInt(0);
  for (const row of rows) {
    if (!row.currency_code || !row.award_handoff_revision_id) reasons.push("Unbound or unknown-currency invoice coverage remains unassessed");
    else currencies.add(row.currency_code);
    if (award && (row.funding_award_id !== award.id || row.currency_code !== award.currency_code || !(row.award_handoff_revision_id === award.current_handoff_revision_id || row.handoff_applicable_revision_id === award.current_handoff_revision_id))) reasons.push("Invoice applicability to current award terms is unresolved");
    try {
      const gross = moneyCents(storageMoney(row.amount!, "invoice")); const retention = moneyCents(storageMoney(row.retention_amount!, "invoice")); const net = moneyCents(storageMoney(row.net_amount!, "invoice"));
      if (gross - retention !== net) throw new Error("Invoice gross/retention/net disagree");
      const isClaimed = ['internal_review','submitted','approved_for_payment','paid'].includes(row.status ?? '');
      if (isClaimed) claimed += gross;
      if (row.status === 'paid') { paid += net; held += retention; }
      else if (isClaimed) { outstanding += net; pending += retention; }
      if (row.status === 'draft') draft += net;
      if (row.status === 'rejected') rejected += gross;
    } catch { reasons.push("Invalid or unavailable invoice money"); }
  }
  if (award?.currency_code) currencies.add(award.currency_code);
  if (currencies.size !== 1) reasons.push("One comparable invoice currency is not established");
  const exact = (v: bigint) => reasons.length ? null : moneyFromCents(v);
  return { state: reasons.length ? 'unassessed' : 'exact', currency: currencies.size === 1 ? [...currencies][0] : null, reasons: [...new Set(reasons)], grossClaimed:exact(claimed),paid:exact(paid),outstanding:exact(outstanding),draft:exact(draft),rejected:exact(rejected),retentionHeld:exact(held),retentionPending:exact(pending),rows };
}

/** A serialized funding snapshot uses null deliberately, never JSON's NaN coercion. */
export function assessedFundingNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
export function sumAssessedFunding(values: Array<number | null | undefined>): number | null {
  return values.some((v)=>v===null || v===undefined || !Number.isFinite(v)) ? null : values.reduce<number>((sum,v)=>sum+v!,0);
}
export function comparableFundingText(facts: ComparableFunding, field: "ceiling" | "match" = "ceiling"): string {
  const amount=facts[field];
  return facts.state==='exact' && amount!==null && facts.currency ? `${amount} ${facts.currency}` : `Unassessed: ${facts.reasons.join('; ') || 'Comparable currency and terms are not established'}`;
}
export function comparableFundingDisclosure(facts: ComparableFunding): string {
  return `Recorded award ceilings ${comparableFundingText(facts)}; match ${comparableFundingText(facts,'match')}. Terms ${facts.versions.map((v)=>`${v.awardId}/${v.revisionId}`).join(', ')}. Target coverage and spending authorization remain unassessed.`;
}
export function readComparableFunding(value: unknown): ComparableFunding | undefined {
  const parsed=z.object({state:z.enum(['exact','unassessed']),amountMeaning:z.literal('recorded_award_ceiling'),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),ceiling:z.union([z.number(),z.string()]).nullable(),match:z.union([z.number(),z.string()]).nullable(),reasons:z.array(z.string()),versions:z.array(z.object({awardId:id,revisionId:id}))}).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Refuse finite Data API truncation before a financial snapshot becomes an artifact. */
export function assertCompleteFundingRead(...reads: Array<{data:unknown;error?:unknown;count?:unknown}>): void {
  for (const read of reads) if (read.error || !Array.isArray(read.data) || read.count!==read.data.length) throw new Error("Complete funding currency/version source sets are unavailable. No partial financial snapshot is accepted.");
}
