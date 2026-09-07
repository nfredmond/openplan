# Independent Engagement source follow-up A

Reviewed 2026-09-07 UTC against isolated checkout `/home/nathaniel/.local/state/openplan/engagement-first-workflow-2026-09-06`, HEAD `f6c13d63`, plus the parent's uncommitted recovery changes. The initial independent report remains unchanged. This follow-up is a bounded source inspection, not another complete strategic review or live acceptance result.

I changed no implementation, database, browser, process or main-checkout file. My only output is this report. The parent owns live RLS, worker interruption/cancellation and project-bundle access validation. No other current reviewer's report was read.

## Disposition

The first workflow still has one consequential review gap and two bounded recovery/audit gaps in the inspected source. They fit the original requirements for reviewing attachments before release, durable receipts, and accountable moderation. They do not require advanced synthesis or a new module.

The earlier geometry, historical definition and reuse-language corrections are present in the newer source. This follow-up does not independently certify their runtime behavior, and does not reopen them merely because the preserved initial report still records the defects.

## F1. Survey photographs cannot be inspected in the survey review queue before approval

Priority: high for completing the review-before-publication workflow. Source-established missing interaction; no live leak is claimed.

`openplan/src/components/engagement/survey-review-queue.tsx:11` displays `answer_text || JSON.stringify(answer_json)`. It provides a reviewed-text replacement checkbox, but no photograph, attachment preview or download. `loadSurveyReviewPage` in `openplan/src/lib/engagement/survey-responses.ts` loads the file references inside `answer_json`; the review route returns those records after staff authorization. The bounded route inventory under `openplan/src/app/api/engagement` found the report download route but no staff survey-attachment route. This is distinct from ordinary mapped-item photographs, whose staff thumbnail is rendered by `engagement-item-registry.tsx:191-197`.

The approval button in `survey-review-queue.tsx:16` approves the whole survey response. `20260908000004_engagement_report_jobs.sql` includes approved sessions and their answers in a public snapshot. `review-export-worker.ts:42-48` then downloads every retained answer attachment and places it in the portable export. The planner can therefore approve a photograph for public export without seeing it in the response-review interface.

Smallest correction: add a staff-authorized attachment reader tied to the campaign, session, answer and validated file reference, and expose its preview/download in that answer's review detail. Stream bytes through the authenticated route rather than handing out a long-lived Storage URL. Keep viewer, wrong-workspace, wrong-campaign, wrong-answer and revoked-access denial explicit. A whole-answer redaction must make clear that it withholds the files as well as replacing the text. The existing report worker can continue to package the reviewed result.

Acceptance: submit a real labelled survey photograph, inspect it through normal staff review navigation, redact/withhold or approve deliberately, and compare the resulting public ZIP. A route mock must assert the selected reference and campaign/session/answer constraints. Removing a required membership or answer-scope condition must make the check fail; a harmless caption change should survive. This is a recommendation for the parent's checks, not a test I ran.

## F2. Saved receipts become unrecoverable when the campaign status is closed or archived

Priority: medium. Source-established control-flow gap.

The comment submit route looks up a campaign using `.eq('status', 'active')` before `retainedReceipt`: `openplan/src/app/api/engage/[shareToken]/submit/route.ts:181-213`. The survey route has the same order at `openplan/src/app/api/engage/[shareToken]/survey/submit/route.ts:115-132`. The status catalog explicitly supports `closed` and `archived`, and Campaign management exposes that status selection.

A submission can commit while its HTTP response is lost. If staff then set campaign status to closed or archived, retry with the exact stored request ID and payload returns 404 before receipt lookup. The row still exists, but the participant cannot recover its acknowledgement. Existing ordering does handle the separate submission-closed flag and elapsed participation dates, because those checks occur after receipt lookup. They are different states from the campaign status.

Smallest correction: resolve the campaign identity for a valid existing share token, then permit only the narrow receipt-capability check before evaluating whether a new submission may be accepted. Require the existing random request capability and preserve exact payload conflict handling. Return no participant content, private status or moderation history. New submissions to a non-active campaign must still fail. A revoked/rotated share token remains an explicit separate policy boundary; this recommendation does not require keeping revoked public links usable.

Acceptance: one comment and one survey commit with simulated lost responses, then campaign status becomes closed and archived. Exact retries return their original IDs without additional rows. Changed payloads identify the previously saved receipt without overwriting it. New request IDs remain refused. I did not run this scenario against the database.

## F3. API recategorization or source changes can reuse an old review reason

Priority: medium. Source-established API/audit gap; the normal item form is more restrictive.

`openplan/src/app/api/engagement/campaigns/[campaignId]/items/[itemId]/route.ts:116-123` requires a submitted review reason for changes to body/title/name/photo/geometry/coordinates or moderation state. It omits `categoryId` and `sourceType`. Those fields are nevertheless written at lines 150 and 155. If a caller omits `moderationNotes`, the existing note remains unchanged.

The database trigger in `20260908000003_engagement_public_copy_guards.sql:21-22` treats category and source as public-copy changes, but only requires that `NEW.moderation_notes` be nonblank. A previous reviewer already supplied such a note. Consequently, a subsequent API request can change category or source without supplying its own reason; `20260908000001_engagement_record_custody.sql:31-32` records the old note with the new actor in immutable review history.

The standard item form currently sends `moderationNotes: moderationNotes || null`, so an empty form reason is rejected by the database instead. That does not close the API path, and it also gives the normal category-only save a generic server failure rather than the useful request-level reason message.

Smallest correction: include category and source changes in the route's comparison against the existing row and require a nonblank reason in that request. Select `source_type` in the existing-row projection so comparison is based on the real row. Preserve the database guard. If direct authenticated table writes are also part of the supported moderation boundary, use an explicit review operation that receives the new reason; a stale preexisting note cannot prove a new human explanation.

Acceptance: begin with an item carrying an earlier nonblank note. A category-only or source-only API change without a newly supplied reason must fail, while an unchanged field remains a harmless no-op. A reasoned change must retain the new actor, reason and old/new record. Preserve the current expected-version condition and prove two stale concurrent API reviews cannot overwrite each other.

## F4. Remaining boundaries to record without claiming a demonstrated defect

- **Staff item-photo URLs:** campaign page lines 411-440 still create short-TTL signed Storage URLs for staff thumbnails. That differs from the newer public streaming-photo route, which rechecks publication and campaign on every request. An already issued staff URL can remain usable until expiry after membership revocation. The parent should state the accepted boundary or route these reads through authenticated streaming when proving immediate access revocation. I did not test a revoked URL or establish the TTL at runtime.
- **Optional demographic capture:** comment insert commits before the optional private demographic insert, and receipt replay returns before demographic capture. The existing code explicitly treats this as best effort. A crash in between can leave a saved comment without those optional answers. This is not a reason to deny the comment or fabricate missing demographics. Preserve the documented limit and unknown/missing distinction; a claim of complete original-response recovery would need transactional capture or an independently repairable receipt-bound follow-up. No demographic values were read during this review.
- **Photo retry with unavailable browser storage:** uploaded-photo reuse in `submit-portal-input.ts` currently depends on localStorage. Repeated in-memory submissions can upload new paths when that storage is unavailable. Exact receipt-conflict handling prevents silent overwrite, but it can label otherwise unchanged feedback as different because the path changed. An in-memory cached upload reference would make the stated recovery behavior more consistent. This is a lower-priority constrained-browser case than F1-F3.
- **Privacy claims:** the inspected public photo reader checks active campaign, approved item, approved top-level parent and campaign-scoped object path before streaming with no-store. Survey review requires `engagement.write`; survey history and reply originals retain separate restrictions. Those are observed code controls, not a full cross-route privacy proof. The parent's named live tests remain necessary.

## Recommendation to the parent

Complete F1-F3 within the existing first-workflow work. Record the disposition of F4 according to the actual acceptance boundary instead of treating every uncertainty as a release-blocking proven vulnerability. Retain exact source/build identity for the final browser and export evidence. Keep the independent human usefulness/comparative gate and the whole-v1 scientific/geography obligations unchanged.
