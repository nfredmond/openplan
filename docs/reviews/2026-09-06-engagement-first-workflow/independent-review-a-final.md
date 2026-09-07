# Final independent Engagement source audit A

Reviewed 2026-09-07 UTC in `/home/nathaniel/.local/state/openplan/engagement-first-workflow-2026-09-06`, branch `work/engagement-first-workflow`, HEAD `f6c13d63`, plus the parent's uncommitted changes visible during this inspection. This report supplements the preserved initial direction review and follow-up. Their full contract, ten questions, nine perspectives and human/scientific claim boundaries remain applicable.

I inspected the source directly. I ran no repository tests, wrote no implementation, changed no databases/processes and did not inspect the other current reviewer's report. My only file is this scratch report. Parent assertions about live checks are not used as evidence here. This is a bounded audit of an evolving working tree, not final-build acceptance.

## Conclusion

The source addresses the three prior follow-up findings: staff can inspect current/historical survey photographs through a scoped authenticated route, saved-receipt lookup precedes closed/archived status rejection, and category/source API edits require a fresh reason. The new database update-intent guard strengthens stale-review protection beyond the API.

Two concrete issues remain in the inspected source. The new transient review fields are not cleared on INSERT, and legitimate campaign-targeted review artifacts cannot reach the project-bundle code because it requires a mutually exclusive project target. Correct these and demonstrate their specific failure cases before calling the first workflow complete. This recommendation preserves the current workflow and does not expand it into advanced synthesis or reduce v1.

## Final-A1. Review-only fields can persist on INSERT and enter a public snapshot

Priority: high, a concrete source-level privacy/custody defect at a direct database boundary. No live disclosure was performed.

`openplan/supabase/migrations/20260908000010_engagement_review_intent.sql` adds `review_expected_updated_at` and `review_reason` to `engagement_items`. Its comment says these inputs are consumed and never stored. The function clears both fields on UPDATE, but the trigger is only `BEFORE UPDATE`.

An authenticated direct insert can therefore supply nonnull values and retain them on the row. `20260908000004_engagement_report_jobs.sql:74` exports item rows using `to_jsonb(i)` minus a limited exclusion list. Neither new field is removed. `parseReviewSnapshot` in `review-export.ts` rejects private moderation/metadata fields on public rows but does not reject `review_reason`. Consequently, an approved inserted item can carry a private review reason into the public JSON/ZIP snapshot. The normal public API does not set these fields, which limits the demonstrated entry to direct/database integrations rather than ordinary anonymous form submission.

There is also an intent problem: if the inserted expected timestamp equals the initial stored `updated_at`, a later content/status update omitting new intent fields can inherit the preseeded reason and expected version. The update trigger cannot distinguish them from freshly submitted intent. This contradicts the claim that each direct update consumes a new review decision.

Smallest correction:

- Run the intent trigger on INSERT and UPDATE, with an INSERT branch that clears both fields without requiring a review of a nonexistent old row.
- Add a stored-row CHECK requiring both transient fields to be NULL. Because the BEFORE trigger consumes them, valid reviewed updates still satisfy the constraint.
- Exclude both fields from exported item JSON as defense in depth, and reject a public snapshot containing a nonnull private transient reason. Decide whether the field names should be absent entirely rather than exported as meaningless nulls.

Required evidence: a direct authenticated INSERT with nonnull review fields must leave both columns NULL or be refused. A later UPDATE without fresh intent must fail even when the original insert supplied a matching timestamp. A public export must contain neither the test reason nor usable intent fields. The harmless case is an insert/update with no substantive public-copy change and no retained intent. I did not run these tests.

## Final-A2. The project bundle path cannot include the new campaign review artifact

Priority: high for the promised project-to-engagement-to-retained-handoff outcome. Concrete source-level reachability defect, not a leak.

`queue_engagement_report` at `20260908000004_engagement_report_jobs.sql:81-82` inserts a Report with `engagement_campaign_id` and no `project_id`. That is correct for the existing Report target model. `20260823000006_land_use_plan_report_target.sql` requires exactly one of project, RTP cycle, engagement campaign or land-use plan.

The project evidence candidate inventory filters every report artifact by the document-library source's `projectFilterColumn`. For Reports, `openplan/src/lib/document-library/sources.ts:169` sets that field to `reports.project_id`, and `project-evidence-bundles/inventory.ts:388-394` applies the equality filter. This excludes every newly generated campaign-targeted review PDF from the actual project candidate list, even when its campaign belongs to or covers that project.

The byte reader repeats the same restriction at `project-evidence-bundles/bytes.ts:105-108`, before reaching the Engagement branch at 122-126. The new `engagementBundleFilesAvailable` helper also requires `.eq('reports.project_id', project.id)` before reading `engagementReviewJobId`. A legitimate campaign review cannot satisfy those predicates under the exact-one-target invariant. The helper is therefore incapable of checking the ordinary artifact this workflow generates.

The new bundle test uses a mocked returned artifact with an Engagement job ID but does not represent the joined Report's mutually exclusive target. Asserting the direct-project filter verifies the implementation while missing this domain contradiction. Existing lead/shared campaign coverage helpers already establish the relationship needed here: `campaign-projects.ts:212-249` and `253-280`.

Smallest correction: use one shared, caller-RLS-preserving project/report-coverage resolver for candidate discovery, byte resolution and download-time rechecks. Accept a directly project-targeted report or a campaign-targeted report whose campaign currently belongs to/covers the authorized project. Preserve workspace scope, source artifact identity and exact retained checksum. Deduplicate a campaign linked as both lead and covered project. Do not assign both target columns and do not disable the Report invariant.

Required evidence: generate a review normally for a campaign covering a lead and a second project. Find its actual artifact from each project's normal evidence-bundle UI, freeze/download the real bytes, then withdraw a contained public copy and confirm both containing bundles refuse download. Remove a project's campaign coverage or revoke membership and verify denial. An unrelated campaign must never appear. Use an actual campaign-targeted Report fixture; a fabricated report with both target columns populated cannot prove this path.

## Prior findings addressed in inspected source

| Earlier finding | Directly inspected correction | Remaining proof boundary |
|---|---|---|
| Survey photos unavailable for staff review | `attachments/route.ts` requires `engagement.write`, scopes current answer by campaign/session/answer and historical answer by campaign/session/history, validates the retained campaign path and sniffs image bytes. `SurveyReviewAttachments` renders unoptimized authenticated images and full-size links; review history renders historical originals. | Actual normal-navigation current/historical image use, failed image response, staff/viewer/cross-workspace/revocation cases. The unit tests were read, not run. |
| Closed/archived campaigns prevent receipt recovery | Both public submit routes now resolve by share token, perform narrow request-ID receipt lookup, then reject non-active status before accepting new work. | Lost-response replay on both statuses with exact row counts and changed-payload handling. Token rotation remains a separate explicit revocation boundary. |
| Category/source edits reuse old reasons through API | Item lookup now selects `source_type`; both fields join the public-copy comparison. API submits `review_expected_updated_at` and `review_reason`; database error 40001 is translated to a stale-review conflict. | The INSERT hole in Final-A1, direct stale concurrent updates, and normal fresh/no-op updates. |
| Staff item-photo URLs outlive immediate revocation | Current item and historical photograph controls now point to the authenticated attachment stream; previous page signing block is removed in the diff. | Actual revoked access and proof that no remaining caller mints an old signed link for the claimed paths. |
| Reuse drops language/assistance context | Current reuse copy names language/accessibility preservation; prior source already copied those fields. New campaigns remain drafts with reviewable question/layer settings. | Two contrasting actual setup/reuse journeys, including language, source/project framing and hidden-layer review. This audit adds no new setup blocker. |

## Remaining uncertainty and acceptance boundaries

The scoped attachment handler exposes no obvious anonymous or wrong-campaign path in this inspection. The public photo route checks approved item and parent before streaming. Public report downloads recheck reviewed copies and exact artifact bytes. These are source findings, not a certification of all privacy routes or race behavior.

The survey attachment history route reads `before_json`, matching the UI's historical-before display. The review queue still needs an actual file-open journey and a clear failed-image state; an `<img>` alone does not prove the image loaded. Whole-answer redaction removes the file-bearing answer JSON, and the current attachment route should then deny while the restricted historical route remains available to staff.

Optional demographic capture remains best effort after the comment commit; a crash/replay can preserve the comment without its optional demographic record. Photo reuse when browser storage is disabled remains a constrained-browser recovery limitation unless separately changed. Those were already recorded in the follow-up and are not reclassified as newly demonstrated privacy failures.

The final direction synthesis must retain independent reports and distinguish fixed source findings from verified outcomes. It still requires a final identified build, appropriate tests/live RLS and meaningful failure mutations, actual desktop/390px/non-map journeys, usable PDF/XLSX/ZIP files and restart/cancellation/revocation evidence. Human superiority/usability observation, nationwide planning substance, California depth and separate scientific model validation remain open unless independently established. None can be inferred from this bounded audit.
