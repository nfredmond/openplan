import { comparableAwardFunding, type ComparableAward, type ComparableFunding } from "@/lib/grants/award-handoff";
import { formatMoney } from "@/lib/money/format";
export function AwardFundingFacts({ awards, snapshot }: { awards?: ComparableAward[]; snapshot?: ComparableFunding }) {
  const facts = snapshot ?? comparableAwardFunding(awards ?? []);
  return <div className="space-y-1 text-sm"><p>Recorded award ceilings: {facts.ceiling === null ? "Unassessed" : formatMoney(facts.ceiling,{ precision:'cents',currency:facts.currency, currencyDisplay:'code' })}</p><p>Recorded match: {facts.match === null ? "Unassessed" : formatMoney(facts.match,{ precision:'cents',currency:facts.currency, currencyDisplay:'code' })}</p>{facts.reasons.map((reason) => <p key={reason}>{reason}</p>)}<p>These ceilings do not establish spending authorization or available cash. Funding-gap comparisons require a compatible target currency and cost basis.</p></div>;
}
