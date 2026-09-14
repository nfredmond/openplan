# Source findings while v0.60 final CI runs

September 14, 2026, read-only application inspection on 29c5f7ab.

Migration 20261014000021 already retains each link/refresh/withdrawal in
engagement_response_decision_links. It has no response/decision foreign key that
would erase the context when those sources disappear. Fields include id,
workspace_id, campaign_id, response_id, decision_id, project_id, predecessor_id,
operation, actor_id, reason, payload_json, payload_sha256, context_text,
context_sha256 and created_at. Native readers already expose payload_text as
payload_json::text. Reuse that exact text for portable hash verification; JavaScript
JSON.stringify of payload_json does not reconstruct PostgreSQL canonical bytes.
Context text already includes retained response/history, decision, project,
campaign relationship, original contribution snapshots and configurations.

A schema-2 internal report should declare its retained decision-link history
scope explicitly, separate from contribution/date/category filters. Campaign-wide
private history is a viable choice because withdrawn/deleted responses must not
vanish from export when current published-response filters change. Disclose that
scope before queueing and in PDF/XLSX/JSON, not only in developer notes. Do not
silently imply a filtered contribution selection also filters the audit archive.
Keep legacy schema-1 internal files readable and say their saved format lacks
this history; do not present missing history as zero links. Public snapshots must
reject private-lineage fields and must never include these contexts.

Queueing locks the campaign FOR UPDATE and captures contents in a single SQL
statement. The existing link command first locks that campaign FOR SHARE NOWAIT,
then membership/workspace, before request/source locks. Therefore existing campaign
serialization supplies a useful seam for snapshot consistency. Prove overlap;
do not introduce an opposite lock order without evidence.

The actual saved public original ZIP was inspected for response field names.
It has id/status/we_did/you_said/created_at/sort_order/updated_at/ai_assisted/
campaign_id/category_id/theme_title/published_at/source_item_ids. It does not
contain the private link context or a response review_reason field. This check
found no new release privacy defect; it does not audit every possible snapshot.

The current PDF/XLSX/ZIP renderer uses snapshot text verbatim in snapshot.json.
A parser that merely ignores an unexpected private field would still ship that
field in the ZIP; reject it before rendering. Extend the existing long-text
handling for readable workbook fields, and verify exact context/payload hashes
and complete predecessor chains separately from their readable summaries.

Report-page seam: before generic project/grant reads, use an authenticated query
for the actual engagement_report_jobs row scoped by report_id, campaign_id and
workspace_id. A failed lookup must show an unreadable state; a successful absent
lookup must preserve legacy campaign-linked project reports. Only a proven saved
review job selects the campaign-report body. No service-role lookup is needed.
Load campaign id/title/project_id with workspace scope. Load the current project
only if it has an ID. Missing and failed current context remain distinguishable;
neither should remove otherwise-authorized retained file controls. Keep current
navigation context distinct from frozen report content.

Verification should assert actual query projections and filters, cover absent
campaign/project, failed job/campaign/project reads, and prove that ordinary
legacy campaign/project reports retain their route. Browser follow-up should reuse
UI-created retained reports, enter from Engagement Record and Reports, exercise
keyboard navigation at desktop/390, and download/check all three retained file
formats. Preserve the before-warning evidence and original bytes. A real report
page must not offer unrelated grant/model generation controls for this job type.
