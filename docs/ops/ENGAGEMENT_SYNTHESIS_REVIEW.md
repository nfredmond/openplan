# Retained engagement sources and staff reviews

This workflow is available in v0.62.0. It prepares private staff drafts from a saved selection of contributions. It does not generate AI themes, approve findings or publish participant text. No AI key is needed.

## Save the source first

1. Sign in, open **Engagement**, select the consultation and open **Analysis**.
2. In **Retained synthesis sources**, choose the included statuses, comments/replies, survey responses, category and received-date range. Approved contributions are the initial selection. Dates use the browser's local time zone.
3. Choose **Save selected sources**, then open the saved source from history. Check its selection, comment/answer counts and retained definitions before preparing a review.

A saved source preserves the selected text and historical definitions. It does not change when newer contributions arrive or a current category is renamed. Save another source when the intended selection changes. A category filter can exclude answers whose historical definition is unavailable. Contribution and answer counts are not counts of distinct people.

The source inspector exposes full retained text and complete membership. It does not inspect attachment contents or assess sentiment, representativeness or legal sufficiency. Missing historical context is shown as unavailable rather than replaced with a current definition.

## Prepare and correct a review

Open a saved source and choose **Create staff review**. The initial groups follow historical categories; their interpretation starts unassessed. A saved review belongs to that exact source.

Under **Reasoned correction**, choose the correction type. You can edit the review title/notes, change a group's wording and membership, add a group or remove one. Search finds contributions across the retained source. Record a **Reason for correction**, then choose **Save reasoned correction**.

Every saved correction creates another version. Removing a group preserves its source contributions; those without another group become explicitly unassigned. Contributions in several groups are disclosed as overlapping. Neither group counts nor a staff sentiment label proves representative community support.

Use **Revision history** to inspect earlier versions. Earlier versions are read-only. Open the current version before making another correction. Original source, preparation and revision checksums remain available for comparison.

## Recover an interrupted save

A retained request has a fixed identity and payload. If its acknowledgement is interrupted, use **Retry retained source request** or **Retry retained review request**. Retrying the same request recovers its saved result when it already succeeded. Starting an unrelated new request is not a substitute for checking the pending one.

Unfinished correction text is kept in browser storage when storage is available. If storage fails, transport is blocked and the newest text remains on screen. Use the preservation controls or copy the text before leaving or reloading. A copy held only in memory is not durable.

**Preserve edit and start another correction** keeps a recovery copy; **Restore preserved edit** can restore a compatible copy. Preserving a request does not undo a server save. Check saved history before creating another draft. Changing accounts or losing staff access clears private inspection; sign back in with authorized access before reopening it.

## Earlier summaries and remaining work

The earlier generator is retired. Its old endpoint returns HTTP 410 and does not regenerate, charge a provider or change stored summaries. Previously saved summaries remain readable as limited historical output. They could omit survey answers, comments beyond 300 and portions of long text. Citation markers and historical neutral labels do not establish accuracy or sentiment assessment.

Exact-output staff approval, optional complete resumable model generation, response/decision links from reviewed groups and retained reviewed synthesis exports remain unfinished. Saving a draft is not agency approval. The existing report workflow is separate and must not be described as exporting these approved reviews.

For engineering evidence and installation requirements, see [v0.62.0 verification](../reviews/2026-09-14-m9b-synthesis-custody/RELEASE_VERIFICATION.md). Apply the release's three additive migrations before restarting the app.
