# Next M9b report work after v0.60 publication

Implementation notes from September 14, 2026. The first v0.60 candidate,
28be41642bd39f41bea6ddaac7a7325419cbd8a0, passed shuffled tests, RLS and
populated upgrade but failed CI's TypeScript build with an exhausted Node heap.
Finish the build-memory correction and final CI, then tag/publish v0.60 before
starting this report work. See RELEASE_VERIFICATION.md and build-heap-results.json.

The actual photo runner's mistaken same-title navigation reached a report and
revealed the context problem. Corrected runner waits for the Engagement catalog
then selects the campaign href. Failure capture public-photo-390-1789394373692
shows a report with a project-read warning and unrelated grant panels. Source:
- queue_engagement_report inserts reports(workspace_id,engagement_campaign_id,...)
  without project_id. This is deliberate campaign ownership, not a missing source
  that should be filled by guessing a project.
- reports/[reportId]/page.tsx unconditionally queries projects id=report.project_id
  and registers its read error. LandUsePlanReportPage already supplies a distinct
  report-body path; extend this established page organization for saved engagement
  review jobs, preserving generic project/legacy handoff reports.
- Do not classify every engagement_campaign_id report as a frozen review job:
  older generic handoff reports can also have campaign sources. Identify the actual
  engagement_report_jobs record for that report, preserve error vs absent, and use
  EngagementReviewFiles with reportId to scope files. Preserve campaign/project
  navigation when actually readable and explain absence without unrelated grants.

Private decision lineage belongs in the existing review-export.ts schema/worker.
Current snapshots are schema 1 and items/sessions/answers/responses/definitions.
The queue's current internal response selection still includes only published
responses. Choose and document complete private history scope before claiming
portable decision records; a contribution filter must not silently erase withdrawn
or removed-response decision links. A separate explicitly campaign-wide retained
history section may be clearest. Inspect the full report contract before finalizing.

Retain exact context_text and context_sha256 for every link revision; derive
readable PDF/workbook summaries from those frozen contexts, never current mutable
project rows. Root/predecessor/refresh/withdraw identity, actor, time and reason
remain distinct from decision approval or explanation publication. Add a versioned
snapshot format and keep schema-1 originals readable with explicit unavailable
lineage. Public snapshots must contain no private lineage, including unexpected
fields in decoded inputs. Existing PDF/XLSX/ZIP worker services remain the home.

Privacy already has the needed staff-only internal boundary: migration
20260908000004 engagement_export_read restricts internal jobs to owner/admin/member;
public-format jobs permit workspace viewers. The same staff roles protect private
engagement_response_decision_links. Report and artifact restrictive policies plus
route-only Storage access are in 20260908000008. downloadEngagementReview uses an
authenticated job read before service-role bytes; the generic report artifact
route delegates to it when engagementReviewJobId is present. Prove these actual
paths again for the new private lineage; do not assume a filename makes it private.

Keep native snapshot coherence and existing locks. The current queue locks the
campaign then captures all data in one SQL statement; link writers use the response
advisory lock. Do not introduce opposing lock order without a concurrency proof.
No new provider, module or paid infrastructure is required. Preserve legacy bytes,
complete history and the full V1 scope. Apply any-place if touching geography.
