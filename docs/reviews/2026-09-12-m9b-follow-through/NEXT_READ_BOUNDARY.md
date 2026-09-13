# Next M9b read boundary inspected during v0.55.1 gates

The staff and public loaders in src/lib/engagement/close-loop.ts each issue one ordered table request. Sort order and created_at have no unique ID tie-breaker. Campaign translations independently reads the same published table once. This establishes a capped-read implementation, not a measured production undercount.

Reuse src/lib/supabase/paged-read.ts for complete offset retrieval if the caller can tolerate a changing set. It advances by returned rows, requires an empty page to establish exhaustion and exposes an incomplete flag on its ceiling. Every caller must refuse partial results and impose a unique total order. It cannot establish one snapshot across concurrent edits; do not claim that property merely from stable ordering.

Existing queue_engagement_report in migration 20260908000004_engagement_report_jobs.sql already aggregates related rows in one SQL statement and retains a checksummed immutable report snapshot. Follow its database snapshot approach for a retained/publication-history collection when needed rather than inventing a second report engine. The public report snapshot response query is aggregated and is not itself a table-page truncation case. publicReviewStillCurrent rechecks the captured public sources before delivery.

Current mutation route writes the same narrative row, has a prior-status read before publish notification and does not provide an expected revision. Database guards already check source scope/approval and unpublish linked responses when input is corrected. Do not claim those publication controls are absent. Response history and decision/commitment links remain distinct work beyond the v0.55.1 retry repair.

No code, database, worker or fixture was changed by this inspection. Need an actual capped dataset/read and concurrent-change experiment before claiming the next implementation complete. Preserve existing Reports, Engagement and project decisions as the owning homes.
