import { formatCurrency as grantsCurrency } from "@/lib/grants/page-helpers";
import { readFileSync } from "node:fs";
import { blankComments } from "./migrations/read-migrations";
// Prepared source only. These pure controls cannot prove SQL/RLS/storage, routes or UI.
import { describe,it,expect } from "vitest";
import { assertCompleteFundingRead,AWARD_HANDOFF_BODY_LIMIT,serializeHandoffApply,comparableFundingText,awardTermsSchema,comparableAwardFunding,exactInvoiceAmounts,managedInvoiceTotals,storageMoney } from "@/lib/grants/award-handoff";
import { asPortfolioFundingSnapshot } from "@/app/(app)/reports/[reportId]/_components/_helpers";
import { buildPacketFundingReview } from "@/app/(app)/rtp/_components/_packet-state";
import { resolveRtpFundingFollowThrough } from "@/lib/operations/grants-links";
import { moneyCents } from "@/lib/money/optional-amount";
import { buildAwardDrawdownLedger } from "@/lib/invoicing/drawdown-ledger";
import { buildProjectFundingSnapshot } from "@/lib/projects/funding";
import {buildReimbursementWorksheetHtml} from "@/lib/invoicing/reimbursement-worksheet";
import {resolveReimbursementProfile} from "@/lib/invoicing/reimbursement-profile-binding";
import { summarizeAwardSubstantiation } from "@/lib/invoicing/invoice-records";
import { handoffId as id,awardTermsFixture } from "./fixtures/grants/award-handoff";
const award={id:id(1),current_handoff_revision_id:id(2),latest_handoff_revision_id:id(2),currency_code:'USD',awarded_amount:'100.01',match_amount:'0.00'};
const invoice={id:id(4),funding_award_id:id(1),award_handoff_revision_id:id(2),currency_code:'USD',status:'paid',amount:'100.01',retention_amount:'0.00',net_amount:'100.01'};
// Source shape only. Effective default/role/column grants require the registered live suite.
describe('award handoff relation privilege correction',()=>{
 it('revokes residual service privileges before granting only append-only tables and read-only views',()=>{
  const sql=blankComments(readFileSync('supabase/migrations/20261024200300_award_handoff_relation_privileges.sql','utf8'));
  const tables=['funding_award_handoff_revisions','funding_award_handoff_sources','funding_award_handoff_occurrences','funding_award_closure_receipts'];
  const views=['current_award_handoff_records','active_project_submittals','active_project_milestones','legacy_calendar_funding_awards','funding_award_handoff_fulfillment','funding_opportunity_issuance'];
  const relations=(names:string[])=>names.map(name=>`public.${name}`).join(', ');
  const normalize=(statement:string)=>statement.replace(/\s+/g,' ').trim();
  expect(sql.split(';').map(normalize).filter(Boolean)).toEqual([
   `REVOKE ALL PRIVILEGES ON TABLE ${relations(tables)} FROM service_role`,
   `GRANT SELECT, INSERT ON TABLE ${relations(tables)} TO service_role`,
   `REVOKE ALL PRIVILEGES ON TABLE ${relations(views)} FROM service_role`,
   `GRANT SELECT ON TABLE ${relations(views)} TO service_role`,
  ]);
 });
});
describe('source-confirmed award conditions',()=>{
 it('keeps two dates beneath one condition and rejects duplicate occurrence identity',()=>{
  const t=awardTermsFixture();expect(awardTermsSchema.safeParse(t).success).toBe(true);
  t.occurrences[1].occurrenceKey=t.occurrences[0].occurrenceKey;expect(awardTermsSchema.safeParse(t).success).toBe(false);
 });
 it('distinguishes unknown money, explicit zero and each independent storage range',()=>{
  expect(moneyCents(storageMoney('0.00','award'))).toBe(BigInt(0));
  expect(storageMoney('999999999999.99','award')).toBeDefined();
  expect(()=>storageMoney('1000000000000.00','award')).toThrow('storage range');
  expect(storageMoney('9999999999.99','invoice')).toBeDefined();
  expect(()=>storageMoney('10000000000.00','invoice')).toThrow('storage range');
  for(const v of ['', '1.001','n/a','-1','1x'])expect(()=>storageMoney(v,'award')).toThrow();
  expect(awardTermsSchema.safeParse({...awardTermsFixture(),match:null}).success).toBe(false);
 });
 it('keeps acceptance, authorization amount and typed controlling clock independent',()=>{
  const t=awardTermsFixture();expect(awardTermsSchema.parse(t).authorization.amount).toBeNull();
  t.occurrences[0].clock={kind:'instant',value:'2027-01-15T17:00:00-04:00',sourceZone:'Source-stated zone',calendarDate:'2027-01-15',calendarDateBasis:'Notice local reporting day'};
  expect(awardTermsSchema.parse(t).occurrences[0].clock).toEqual(t.occurrences[0].clock);
  expect(awardTermsSchema.safeParse({...t,authorization:{...t.authorization,state:'authorized'}}).success).toBe(false);
  expect(awardTermsSchema.safeParse({...t,acceptance:'accepted'}).success).toBe(false);
  expect(awardTermsSchema.safeParse({...t,currency:{...t.currency,code:'JPY'}}).success).toBe(false);
 });
 it('retains exact comparable aggregate cents and refuses mixed/unknown/unbound inputs',()=>{
  const facts=comparableAwardFunding([award,{...award,id:id(3),awarded_amount:'0.02'}]);
  expect(moneyCents(facts.ceiling!)).toBe(BigInt(10003));expect(moneyCents(facts.match!)).toBe(BigInt(0));
  expect(facts.versions).toHaveLength(2);
  for(const other of [{...award,currency_code:'EUR'},{...award,currency_code:null},{...award,current_handoff_revision_id:null}]){
   const result=comparableAwardFunding([award,other]);expect(result.state).toBe('unassessed');expect(result.ceiling).toBeNull();
  }
 });
 it('computes exact retention and applicable-version partitions without treating old/unbound rows as current',()=>{
  const amounts=exactInvoiceAmounts('9999999999.99','2.50');
  expect(moneyCents(amounts.retentionAmount)).toBe(BigInt('25000000000'));
  expect(moneyCents(amounts.netAmount)).toBe(BigInt('974999999999'));
  expect(managedInvoiceTotals([invoice],award).paid).toBe(100.01);
  expect(managedInvoiceTotals([{...invoice,award_handoff_revision_id:id(8)}],award).state).toBe('unassessed');
  expect(managedInvoiceTotals([{...invoice,award_handoff_revision_id:id(8),handoff_applicable_revision_id:id(2)}],award).state).toBe('exact');
  expect(managedInvoiceTotals([{...invoice,currency_code:null}],award).paid).toBeNull();
 });
 it('carries the same exact snapshot through project/RTP inputs while declining an unbound target comparison',()=>{
  const snapshot=buildProjectFundingSnapshot({profile:{funding_need_amount:'100.01'},awards:[award],invoices:[invoice]});
  expect(snapshot.comparableFunding?.ceiling).toBe(100.01);expect(snapshot.comparableFunding?.versions[0].revisionId).toBe(id(2));
  expect(snapshot.status).toBe('unknown');expect(snapshot.committedFundingAmount).toBeNull();
  const ledger=buildAwardDrawdownLedger({award,invoiceRead:{ok:true,invoices:[invoice]}});
  expect(ledger.ok && ledger.ledger.managed?.invoices.paid).toBe(100.01);
  expect(ledger.ok && ledger.ledger.recordedAwardCeiling).toBeNull();
 });
 it('renders issuance-only worksheet ceilings without an affirmative authorization amount',()=>{
  const built=buildAwardDrawdownLedger({award,invoiceRead:{ok:true,invoices:[invoice]}});
  const profile=resolveReimbursementProfile({workspaceJurisdiction:null});
  if(!built.ok || profile.kind!=="resolved")throw new Error("Synthetic worksheet input unavailable");
  const html=buildReimbursementWorksheetHtml({workspace:{name:"Synthetic workspace"},award:{title:"Synthetic award"},period:null,ledger:built.ledger,profile:profile.binding,currencyCode:"USD",costs:{ok:false,pending:false,message:"Cost currency/version unassessed"},assemblyNotices:["Actual authorization not_recorded. Authorization amount not recorded."]});
  expect(html).toContain("Recorded award ceiling");expect(html).toContain("100.01");expect(html).toContain("Authorization amount not recorded");expect(html).not.toContain("Authorized amount");expect(html).not.toContain("Remaining against the authorization");expect(html).toContain(id(2));
 });
 it('never counts generated drafts or another awards project-only evidence as managed fulfillment',()=>{
  const base={awards:[{...award,project_id:id(5)}],milestones:[{funding_award_id:id(1),status:'scheduled'}],submittals:[{project_id:id(5),submitted_at:'2026-10-18T12:00:00Z'}]};
  expect(summarizeAwardSubstantiation(base).get(id(1))?.readiness).toBe('unavailable');
  expect(summarizeAwardSubstantiation({...base,managedOccurrences:[]}).get(id(1))?.readiness).toBe('none');
  const outcome={award_id:id(1),revision_id:id(2),submittal_status:'accepted',submitted_at:'2026-10-18T12:00:00Z',fulfillment_evidence:'Recorded actual agency receipt'};
  expect(summarizeAwardSubstantiation({...base,managedOccurrences:[outcome]}).get(id(1))?.readiness).toBe('substantiated');
  expect(summarizeAwardSubstantiation({...base,managedOccurrences:[{...outcome,award_id:id(6)}]}).get(id(1))?.readiness).toBe('none');
 });
 it('bounds the complete apply transport in UTF-8 and retains exact review bytes',()=>{
  const review={reviewed:{proposal:'Ordinary retained proposal',terms:awardTermsFixture()},reviewHash:'a'.repeat(64)};
  const body=serializeHandoffApply(review);
  expect(JSON.parse(body)).toEqual({operation:'apply',...review});
  expect(new TextEncoder().encode(body).byteLength).toBeLessThan(AWARD_HANDOFF_BODY_LIMIT);
  expect(()=>serializeHandoffApply({...review,reviewed:{proposal:'é'.repeat(AWARD_HANDOFF_BODY_LIMIT/2)}})).toThrow('transport limit');
 });
 it('requires explicit legacy obligation adoption and applicability without clearing its fulfillment',()=>{
  const terms=awardTermsFixture();terms.occurrences=[{...terms.occurrences[0],kind:'obligation',disposition:'adopt_legacy',legacyObligationId:id(20),fulfillmentStillApplies:true}];
  expect(awardTermsSchema.safeParse(terms).success).toBe(true);
  expect(awardTermsSchema.safeParse({...terms,occurrences:[{...terms.occurrences[0],legacyObligationId:null}]}).success).toBe(false);
  expect(awardTermsSchema.safeParse({...terms,occurrences:[{...terms.occurrences[0],fulfillmentStillApplies:false}]}).success).toBe(false);
 });
 it('keeps exact zero distinct from unavailable after JSON round trip',()=>{
  const zero=buildProjectFundingSnapshot({profile:null,awards:[{...award,awarded_amount:'0.00'}]});
  const retained=JSON.parse(JSON.stringify(zero));
  expect(retained.committedFundingAmount).toBeNull();
  expect(comparableFundingText(retained.comparableFunding)).toBe('0 USD');
  expect(comparableFundingText(comparableAwardFunding([{...award,currency_code:null}]))).toContain('Unassessed');
  expect(JSON.stringify(retained)).not.toContain('NaN');
 });

 it('keeps unassessed stored RTP amounts and routes them to review rather than settled posture',()=>{
  const snapshot=asPortfolioFundingSnapshot({committedFundingAmount:null,unfundedAfterLikelyAmount:null,outstandingReimbursementAmount:null,uninvoicedAwardAmount:null,comparableFunding:comparableAwardFunding([award])});
  expect(snapshot?.committedFundingAmount).toBeNull();expect(snapshot?.comparableFunding?.ceiling).toBe(100.01);
  expect(resolveRtpFundingFollowThrough(snapshot)?.title).toContain('unassessed');
  const input={linkedProjectCount:2,fundedProjectCount:1,likelyCoveredProjectCount:0,unfundedProjectCount:0,reimbursementInFlightCount:0,outstandingReimbursementAmount:Number.NaN,uninvoicedAwardAmount:Number.NaN};
  expect(buildPacketFundingReview(input)).toMatchObject({label:'Funding comparability unassessed',needsAttention:true});
  expect(buildPacketFundingReview({...input,outstandingReimbursementAmount:0,uninvoicedAwardAmount:0})).toMatchObject({label:'Funding posture aligned',needsAttention:false});
 });

 it('renders unknown Grants card values as unassessed and preserves real zero and cents',()=>{
  expect(grantsCurrency(Number.NaN)).toBe('Unassessed');expect(grantsCurrency(null)).toBe('Unassessed');
  expect(grantsCurrency(0)).toBe('$0.00');expect(grantsCurrency('0.03')).toBe('$0.03');
 });

 it('accepts complete zero source sets and refuses truncated or unavailable financial sets',()=>{
  expect(()=>assertCompleteFundingRead({data:[],error:null,count:0})).not.toThrow();
  expect(()=>assertCompleteFundingRead({data:[{amount:'0.00'}],error:null,count:1})).not.toThrow();
  expect(()=>assertCompleteFundingRead({data:[{amount:'0.00'}],error:null,count:2})).toThrow('No partial');
  expect(()=>assertCompleteFundingRead({data:[],error:{message:'Unavailable'},count:0})).toThrow('unavailable');
 });

});
