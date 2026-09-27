# Following M9b boundary after v0.63.0

September 27, 2026. Read-only source investigation while final release checks run. This is an implementation starting point, not accepted behavior or a change to the roadmap.

The retained review and approval workflow now carries complete item:<uuid> and answer:<uuid> membership. The existing close-loop response writer accepts only sourceItemIds and caps the array at 300 in both TypeScript (response-write.ts) and SQL (migration20261014000003). Existing response-to-decision context schema1 gathers current engagement_items from response.source_item_ids (decision-links.ts and migration20261014000021). A direct conversion from review groups into that old field would drop survey answers or reject large groups. Do not truncate or pretend complete provenance.

The next implementation should deepen the existing Analysis, staff response and decision inspector workflows. Reuse exact review/approval history, response history, decision context custody and their shared privacy/retry conventions. An additive private link can bind complete reviewed groups/membership to an exact response history version and approval event, instead of coercing answer IDs into item IDs. Keep earlier context schema1 and its original bytes readable. Any newer context version must independently verify its full source inventory and exact historical definitions.

A new link or refresh must compare the current approved revision, approval head and exact response version under a consistent lock order. Old links retain their original evidence after correction, withdrawal or a later response edit; the interface must disclose changed/withdrawn/unavailable states. A link is not new approval, public publication or agency adoption. Exact old requests recover before stale-state checks; changed retries conflict. Assistant writes remain executable refusals until supported by the action registry.

Publication needs an explicit design before connecting this provenance to public responses. Current automatic source withdrawal finds only response.source_item_ids and their reply parents. A private reviewed-source link must not create a path that bypasses that protection for comments, replies or survey input. Inspect current survey deletion/withdrawal and public-derivative rules. Keep private respondent text and internal reasons out of public payloads. Public derived wording requires an authorized staff action; source/review approval alone does not publish it.

Acceptance must include answer-only and mixed groups, more than300 comments, complete retained source definitions, overlapping/unassigned membership, stale or withdrawn approvals, corrected/removed responses, old immutable contexts, current staff revocation and cross-workspace denial, interrupted exact retries, and actual competing writers. Harmless controls and targeted failures must reach the intended guard. Full connected browser journeys at desktop and390px must navigate from the actual app and inspect resulting private/public artifacts. Continue through reviewed synthesis exports and optional complete resumable generation without marking M9b complete from the bridge alone.

## Source pointers for implementation

- `openplan/src/lib/engagement/response-write.ts`: item-only source IDs and the 300-item limit.
- `openplan/supabase/migrations/20261014000003_engagement_response_recovery.sql`: response receipts and automatic withdrawal under the campaign response lock.
- `openplan/supabase/migrations/20261014000007_engagement_conflicts_without_transaction_retry.sql`: later response writer definition retains the same source limit.
- `openplan/supabase/migrations/20261014000021_engagement_response_decision_links.sql` and `20261014000022_engagement_decision_request_resolution.sql`: retained response decision contexts and source locks.
- `openplan/supabase/migrations/20261014000023_engagement_public_copy_privacy.sql`: current public-copy eligibility checks.
- `openplan/src/lib/engagement/public-portal-data.ts`: public response filtering currently checks the legacy item inventory.

These are code findings, not proof that a new bridge is safe. Inspect the latest function definitions and all public readers before editing. Survey answer lifecycle, retention and withdrawal behavior still require investigation. Do not expose answer text merely because a response has no legacy item IDs. Keep the existing complete retained source and approval bytes as the evidence boundary.
