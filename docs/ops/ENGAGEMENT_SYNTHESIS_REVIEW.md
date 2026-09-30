# Retained engagement sources and staff reviews

Source preparation and staff review are available in v0.62.0. Version 0.63.0 adds private staff approval and withdrawal for exact saved revisions. Version 0.64.0 connects reviewed groups to responses and decisions, and retains that chain in private review files. These workflows do not generate AI themes or publish participant text. Staff approval does not confer agency authority or establish representative support. No AI key is needed.

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

## Approve an exact saved revision

Open the current saved review. Save or preserve any unfinished correction first. In **Exact revision approval**, inspect the version and its history, enter a **Reason for approval or withdrawal**, then choose **Approve revision**. The confirmation names the exact revision that was approved.

A correction remains unapproved until staff explicitly approve that version. Earlier approval stays attached to its own immutable revision. To withdraw the latest approval, open the version it names, enter a reason and choose **Withdraw approval of revision**. The earlier approval and the withdrawal both remain in private history. A historical version cannot receive a new approval while a newer correction exists.

Approval does not edit the review, publish findings or authorize a public derivative. Only current campaign staff can read or change this approval history. Account and access changes clear the private inspector.

## Recover an interrupted save

A retained request has a fixed identity and payload. If its acknowledgement is interrupted, use **Retry retained source request**, **Retry retained review request** or **Retry retained approval request**. Retrying the same request recovers its saved result when it already succeeded. Starting an unrelated new request is not a substitute for checking the pending one.

Unfinished correction text is kept in browser storage when storage is available. If storage fails, transport is blocked and the newest text remains on screen. Use the preservation controls or copy the text before leaving or reloading. A copy held only in memory is not durable.

**Preserve edit and start another correction** keeps a recovery copy; **Restore preserved edit** can restore a compatible copy. Preserving a request does not undo a server save. Check saved history before creating another draft. Changing accounts or losing staff access clears private inspection; sign back in with authorized access before reopening it.

Approval reasons use separate recovery copies. **Preserve approval reason and start another** keeps the displayed reason or exact pending request; **Restore preserved approval copy** restores a compatible copy when no current draft/request would be overwritten. A recovered approval can name an earlier revision after a correction. That receipt does not approve the corrected version. Inspect the full history before starting another operation.

## Connect a reviewed group to a response

Create or edit a staff response under **Setup**, in **You said / We did**. Then return to **Analysis**, open the retained source and its saved review, and inspect the current approved revision. In **Response links for this staff review**, choose the response and reviewed group, then choose **Inspect response link**. Inspect the source membership, review, approval and response versions before entering a reason and choosing **Save response link**.

A saved link retains those exact versions. After a reasoned review correction and approval, open the link, inspect its updated preview and choose **Save updated response link**. **Withdraw response link** keeps the original and every correction in history. Removed current groups or responses do not erase retained events. Historical approval remains historical evidence; it does not approve a later correction or publish a response.

If an acknowledgement is interrupted, choose **Retry exact response-link request**. Keep a held reason or pending command with **Preserve response-link copy and start another** before switching work. **Restore preserved response-link copy** restores a compatible copy. Storage refusal blocks sending and preserves the newest text on screen until it can be retained; do not reload a copy held only in memory.

## Retain the chain with a project decision

Record the project decision under **Projects**, the project and **Record**. In the consultation's **Setup** tab, choose **Connect responses to decisions**. Choose the staff response and project decision, then **Review current sources**. The preview includes direct contribution references and the complete retained synthesis actions for that response. Expand **Retained synthesis evidence** to inspect original wording, corrections, withdrawals and exact packets.

Enter a reason and choose **Save decision link**. Later response or decision changes require another reviewed preview and **Save reviewed correction**. A correction adds retained evidence; it does not replace the original context. **Withdraw link, keep history** preserves the earlier packet. An interrupted save offers **Download retained request** and **Retry exact request**. A current preview difference may reflect a changed format or source; inspect the evidence before deciding what the difference means.

Earlier decision packets did not capture synthesis history. They remain readable and explicitly identify that missing evidence. They must not be treated as an observed history with zero actions.

## Download reviewed files

Open the consultation's **Record** tab. In **Engagement review files**, choose **Internal staff review** and the participation filters, then **Prepare PDF, XLSX and ZIP**. The existing local Documents export worker prepares the saved snapshot. **Open retained report** leads to the retained report and its download links. **Open consultation** returns to the consultation.

The internal PDF includes retained decision actions and a shared source appendix. Source links lead to the exact captured words. The workbook adds **Synthesis coverage**, **Synthesis actions** and **Synthesis sources**. Use sheet filters and the ordered **Long text** rows for full packet text; the **Read me** sheet explains reconstruction. The portable ZIP retains the original snapshot, open CSV registers, HTML review and a file checksum manifest. The PDF is the paginated report; spreadsheet default printing is not its replacement.

Participation dates, categories and review-status filters do not exclude private decision history. Public review copies exclude the private synthesis chain. Earlier saved report files stay unchanged after corrections. Prepare a new internal snapshot when later evidence belongs in the report.

## Earlier summaries and remaining work

The earlier generator is retired. Its old endpoint returns HTTP 410 and does not regenerate, charge a provider or change stored summaries. Previously saved summaries remain readable as limited historical output. They could omit survey answers, comments beyond 300 and portions of long text. Citation markers and historical neutral labels do not establish accuracy or sentiment assessment.

Optional complete resumable model generation and the wider M9b workflow remain unfinished. Saving a draft, approving a review or linking a decision does not establish publication, adoption, representative support or agency authority. Exported approval evidence records the retained version; it is not a current approval certification.

For source/review evidence, see [v0.62.0 verification](../reviews/2026-09-14-m9b-synthesis-custody/RELEASE_VERIFICATION.md). The [v0.63.0 approval verification](../reviews/2026-09-27-synthesis-approval-recovery/RELEASE_VERIFICATION.md) covers approval and recovery. The [v0.64.0 verification](../reviews/2026-09-27-synthesis-response-links/RELEASE_VERIFICATION.md) covers response links, decision evidence and reviewed files. Apply all pending additive migrations, through `20261014000032_application_temporary_schema_order.sql`, before restarting the app. No new worker or provider key is required. The existing Documents export worker must run to prepare queued files.
