# M9b response follow-through, initial inspection

Read-only inspection while v0.55 release checks ran. Implementation has not
started. Current contract, roadmap, capability matrix, September 7 direction
review, architecture and retained first engagement workflow were read. The
product-direction check passed with historical review reminders. No whole-product
status or scientific claim was promoted. No external competitor comparison ran.

After v0.55 publication, continue M9b in the existing Engagement module. A0/A1
remain partial; capital delivery, RTP updates, recipient reporting, procurement
and separate nationwide modeling remain required. This returns to the roadmap's
early engagement response/decision outcome after the scoped provider increment.

A concrete prerequisite defect is reproduced in src/lib/engagement/close-loop.ts:
loadCloseLoopEntries returns [] both for {data:[],error:null} and for a synthetic
Postgres-style read failure {data:null,error:{message:... ,code:'08006'}}. The real
function was executed via Node/tsx with a query-chain double. No database writes
or browser claims follow from that probe. Its explicit comment acknowledges the
swallowed error. The authenticated GET route returns that empty array as success;
the campaign page passes it to the builder, which displays counts and allows
creation. This can make existing responses appear absent. The public reader
already has a {rows,error} result and should not be regressed.

First repair the authenticated read, its route and page/builder recovery. Prove
real successful empty state separately from temporary read failure, retain drafts
across recovery and prevent a failed refresh from hiding previous answers. Check
pagination as part of complete response retrieval. Use the existing error/result
and read-failure patterns, with harmless and targeted controls, actual navigation,
desktop/390px, keyboard and console evidence. Do not rewrite the response module.
Then deepen source-to-response-to-decision/commitment traceability and retained
correction/publication history. Current narrative rows can be edited/deleted and
lack an explicit decision link; establish current schema and caller behavior
before designing the extension. Preserve public/internal report boundaries.

Publication already has a database guard in
20260908000003_engagement_public_copy_guards.sql, which rejects sources outside
the campaign or not approved, and a source correction unpublishes linked
responses. The initial route-only absence of validation therefore does NOT prove
a publication leak. Retain that contrary evidence. No notification/reminder
constraint or pending reminder approval was changed. Browser fixtures must remain
local/synthetic, with no live subscriber messages.

Relevant files: lib/engagement/close-loop.ts; API campaigns/[campaignId]/closeloop;
app engagement/[campaignId]/page.tsx; components/engagement/close-loop-builder.tsx;
close-loop, close-loop-route, engagement-closeloop-route,
engagement-campaign-detail-page and close-loop-builder tests. The existing
public-close-loop reader/components and export snapshots are separate consumers.
