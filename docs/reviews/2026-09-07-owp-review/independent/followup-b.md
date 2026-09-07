# Independent follow-up B, September 7, 2026

The original review is unchanged. This follow-up accepts bounded source/component corrections, records additional export defects, and inspects the six actual internal/public files for revision 7 through event 9. Those files preserve their snapshot faithfully, including a newly discovered hidden-field mistake in the saved history. Corrective history and fresh files remain pending at this point.

## Ownership and method

The initial follow-up was read-only except for this report and `/tmp/owp-review-b`. After I reproduced native workbook clipping, root explicitly assigned `workflow-export.ts` and the new `work-program-packet-layout.test.ts` to me. I implemented and tested that bounded correction. No service, database or browser mutations were made. Mutation tests run against source copies in scratch using repository dependencies. The PDF and spreadsheet skills guide file inspection. Root owns the real browser exercise and actual delivered files. No current other-reviewer report was read.

## Original findings

| Finding | Follow-up evidence | Disposition |
|---|---|---|
| B1: stale public attestation | The component compares an attested revision ID/hash/history sequence with current identity. Independent component test changes selected revision after checking disclosure and observes the checkbox clear. | Corrected for this tested transition. New event/save and actual browser behavior still need the parent acceptance case. |
| B2: baseline authority during amendments | Current SQL exempts external acceptance and spending authorization from latest-only enforcement, retaining exact effective-baseline validation. | Source condition corrected. This reviewer did not execute database writes or its live SQL case. |
| B3: PDF-only evidence list | Page query now reads source kind/checksum/storage reference for all workspace Documents. Preparation retains the PDF subset; workflow receives retained files with checksum and storage reference. | Source caller/filter mismatch corrected. Non-PDF selection and byte delivery remain browser/artifact evidence. |
| B4: lost unsent review | The first correction persisted form fields but omitted revision identity. I reported the new risk of restoring an old-version note against latest content. The next correction saves revision ID/hash with the form and restores the selected revision only when its saved hash matches. | Independent remount test restores both old-revision note and selection. Corrupt/unavailable recovery, storage denial, changed users/programs and actual browser navigation are outside that test. |

The current My Work source includes returned work and SQL creates a returned correction assignment for the preparation author. The original pending-only disappearance has a source correction. This reviewer has not exercised the full return/save/resubmit queue in a browser or database.

A further recovery check found an unresolved failure after the normal-remount correction. A valid saved draft whose revision/hash does not match loaded history is skipped, then overwritten by the new form. An independent component test seeded a note under a mismatched saved hash and observed that no sessionStorage value retained the note after mount. The two ordinary tests still passed. Evidence is `/tmp/owp-review-b/component-unavailable-draft.json`. Preserve the raw draft under a separate recovery key and show the problem; never silently retarget it or replace it. Malformed schema/JSON needs the same preservation boundary.

Subsequent correction retains unmatched or malformed form text under `:unreadable` and presents it separately. All three independent component cases now pass. Removing the raw archive write fails only the new preservation test; the harmless-comment copy still passes all three. This accepts the mismatched-hash preservation case, while storage denial and broader account transitions remain outside the test.

## Additional export findings and correction

The initial `workflow-export.ts` split long rows at 2,000 UTF-16 code units. A note with 1,999 ordinary characters followed by a bicycle emoji produced isolated surrogate halves in adjacent Note rows. Converting HTML to UTF-8 produced two replacement characters. Another copy of the same note in the unresolved summary still contained the emoji, so checking whether the whole file contains an emoji would miss the damage. The corrected code splits Unicode code points. The same probe now produces zero replacement characters, preserves the reconstructed complete note, and each individual row survives UTF-8 conversion.

The initial `workProgramDifferences` collapsed rows into a Map keyed by ID. Duplicate structured fund identities pass the current draft schema, although reconciliation identifies the duplicate. With fund amounts `[100, 200]` under one repeated ID, changing the first amount to 900 originally returned no differences. The corrected comparator falls back to positional comparison with an explicit duplicate-identity label. The probe now reports `preparation.funds[row 1; duplicate identity].amount`, before 100, after 900. This correction preserves visible uncertainty instead of silently hiding the changed row.

These are synthetic function inputs, not invented agency evidence. Initial failed outputs were reported immediately in the review conversation. Latest probe outputs are `/tmp/owp-review-b/export-probes.json` and `/tmp/owp-review-b/difference-probes.json`.

## Verification that can reject failure

The final isolated component harness has three tests. Baseline and harmless-comment copy both pass all three. Reintroducing stale boolean consent fails only the disclosure test with expected false versus actual true. Removing recovered revision selection fails only the restoration test with expected old revision versus actual latest revision. Removing unreadable raw preservation fails only the unmatched-draft test. The source copy was restored; repository source was never mutated. Full results are `/tmp/owp-review-b/component-mutations.json` with per-case JSON beside it.

The pure-function harness has a baseline and harmless-comment survivor. Splitting code units instead of code points fails `Each row must survive UTF-8: Note`. Disabling duplicate-identity fallback fails `Duplicate identities cannot hide changes`. Scratch copies were restored. Evidence is `/tmp/owp-review-b/pure-mutations.json`.

Blind categories are explicit. The component test mocks server history and exports, so it does not establish SQL permissions, real artifact rendering, browser geometry, download delivery or actual authority. The pure-function test does not establish native PDF/XLSX rendering, exact database snapshot identity or complete source interpretation. Harmless/targeted mutation outcomes support only the named behaviors. Reviewed source hashes are retained at `/tmp/owp-review-b/source-hashes.json`.

## Delivered artifacts

Root supplied six actual browser-delivered files at `/home/nathaniel/.local/state/openplan/owp-review-verification/delivered/work-program-revision-7-review-9-{internal,public}.{html,pdf,xlsx}`, plus `expected-snapshots.json` and `expected-revisions.json`. I independently reproduced the stored revision and packet hashes using PostgreSQL JSONB's textual representation. Revision 7 is `bcf4a2173a5e1c61aa568b29d71fbfc73f6e913b2a5875436e77b784aa1722bd`; baseline revision 5 is `a693ee7e7dcc64116feb8cb12064ac218ee48edc1d33db970b7ee0efa7ad865f`.

Internal snapshot hash is `19e37fcfd364fb4767843dbf0a8e8fbdff602a7152db2174a26e74b5d83d91c9`, with all events 1-9. Public snapshot hash is `6f9016acf8804a445cc4c76a7897c9e4b57e503eca50dd0696cdb40b8366b43b`, with events 5, 6, 8 and 9. Both HTML and XLSX carry the exact same review rows, all included notes and those independently recomputed hashes. PDF extraction preserves all included notes and hashes. The internal marker `INTERNAL_ENGINEERING_REVIEW_ONLY` is absent from public HTML, PDF and all parsed workbook cells. The public copy explicitly limits the unresolved-comment statement to its included records.

All copies retain three differences: product description, product schedule and the expenditure change from 76,641.63 to null. The actual XLSX expenditure input remains blank, its included amount says `Unresolved`, and reconciliation remains unresolved. The known baseline amount has not become the pending amendment's budget. The 24-sheet workbook's added review sheet contains text cells and no formulas. This review does not repeat the full M2d.1 financial formula campaign.

I visually inspected all nine internal PDF pages and all eight public PDF pages. Authority disclaimers, amendment differences, unresolved amounts and preparation-source caveats are legible. I also opened both delivered workbooks through isolated native LibreOffice conversion and inspected the two internal and one public review pages. Their content fits without the stress-case clipping described below. Native rendering places the short cost Before/After text closely together, but both labels and values remain readable. Microsoft Excel and a full accessibility assessment were not performed. HTML identity/content were parsed independently; this reviewer did not conduct a separate browser interaction with the HTML viewer.

| File | SHA-256 |
|---|---|
| Internal HTML | `28f6c71610e8b1e7444bd5230a71bf392a2bbdcfe0b8959d70de727b4409e699` |
| Internal PDF | `336b4ea500d731342167fb114bf41be19ebdff2c4f1fc2b089b0abec7c68f3ec` |
| Internal XLSX | `bd5c840210bf27e2d35b1af6f0f24fb3bdf40fc234de2de930b5badfef905283` |
| Public HTML | `8e417e19bafd9249ba2d5bf28a047e7552a091a363ff7c946aff62a4c167c403` |
| Public PDF | `b0578f8b1d22ae6ce7402071bbae74ce2d41c1791bd6f422364eeb8e428d4fe0` |
| Public XLSX | `bc4bdd2e0d2e9c412049a45fbb901c747677efe25d18886f2202fdc219553379` |

The artifact reconciliation check passes a baseline and harmless HTML-comment control. An altered review note fails exact HTML/XLSX row comparison, an injected internal marker fails the public-copy exclusion, and changing the blank expenditure input to zero fails the numeric-state assertion. All mutations were confined to scratch copies. Evidence is `delivered-reconciliation.json` and `artifact-mutations.json` under `/tmp/owp-review-b`. The check can reject those failures but cannot determine whether the recorded human decision actually occurred.

The actual files revealed another consequential meaning defect: Start amendment and the internal comment carried hidden authority/scope/date fields from the preceding adoption form. The UI hid those controls for non-authority actions but still submitted their retained values. The exporter faithfully rendered the stale fields as Authority and scope. I reported this immediately. Root confirms source command normalization and SQL rejection were added, with legacy exact retries preserved. Existing history must remain unchanged; an explicit correction record and newly generated packet should explain the retained error. Those later files have not yet been inspected here.

Supporting document IDs/titles/checksums are present, including the synthetic TXT reference. The actual TXT bytes have been requested for separate verification. No agency signature, approval, spending authority or completeness of the retained EDCTC comparison is established by these engineering files.

## Adversarial native workbook inspection

While awaiting delivered files, I generated a synthetic workbook through the real preparation/review exporter with 90 uniquely marked newline-separated review-scope lines. An isolated LibreOffice profile opened the workbook and exported a PDF without modifying the workbook. The first 2,000-character Note cell exceeded one printed page. Visual inspection of pages 25-26 shows `UNIQUE_LINE_064` clipped at the bottom of page 25, while the next page starts only with its remaining words `required scope`. Extracted text contains 89 of the 90 complete unique line markers. This is a reproduced long-note native layout failure. Unicode-safe character chunking alone is insufficient; split by newline/estimated row height as well. This finding does not say the parent's not-yet-received artifact has the same long note.

Failed workbook/PDF/text are retained under `/tmp/owp-review-b/synthetic-long-review-failed.*`; inspected page images are `long-page-25.png` and `long-page-26.png`. The probe uses no real agency authority or source facts. Its full-workbook render is a deliberate stress inspection, not a claim that all preparation worksheets are designed for printing.

Under the explicit file assignment, I replaced character-only splitting with Unicode-safe chunks bounded by twelve conservatively estimated wrapped lines. Long amendment-path labels move into the wider bounded content column; the full path remains intact. Joining continuation values preserves the exact source text, including newline boundaries. This affects the common review rows used by HTML/PDF and XLSX, without changing the saved program or history.

The new permanent layout suite covers multiline scope, unbroken wide/Unicode text and long amendment labels. The new suite plus existing workflow suite passed seven tests; focused ESLint exited 0. In scratch, baseline and harmless-comment copies pass all three layout tests. Removing the newline bound, removing the wrap bound, restoring long labels to the narrow column, or splitting Unicode code units each fails its relevant test. Full results are `/tmp/owp-review-b/layout-mutations.json`; no repository mutation was used for these probes.

Native LibreOffice rerendering now preserves all 90 unique line markers. I inspected the two review pages, including the previously clipped line 064 and final line 089; both are fully visible, and content remains inside the page. Corrected output is `synthetic-long-review.xlsx/.pdf`, with `corrected-page-24.png`, `corrected-page-25.png` and `native-layout-result.json` under the same scratch folder. LibreOffice is an actual native renderer; this does not claim Microsoft Excel or every font/print setting was tested. This agent authored the fix, so this portion is implementation verification rather than a separate author's acceptance review.

## Subsequent readable differences and corrected history

The revision 9/history 12 files retain the original erroneous events and add public correction event 10. New amendment event 11 and comment 12 have empty authority/scope/date fields. Independent JSONB hash and file reconciliation accepts those exact states. The actual supporting TXT download hashes to `26dc210abaa756a379150eb172609c8dd71aa0f0cca0d16701fe13703dec2e93`, matching the decision reference. Its text plainly states a synthetic engineering exercise, no actual official decision/signature/receipt, no spending and unresolved actual requirements. Revision 9's pending amount remains null; the separately delivered revision 5/history 12 workbook retains 76,641.63 as its known cost. The before/after distinction survives the added history.

The history 12 PDF exposed a cosmetic side effect of the initial height correction: a word could split across continuation rows. Under renewed explicit ownership I made the chunker prefer nearby whitespace while retaining a hard bound for unbroken text and exact joined bytes. Root added shared human field/value labels; the exporter now uses them so readers see Funding source/Expenditure/Product/Schedule and `Unresolved` instead of code paths and null. Missing values remain distinct from literal source strings and zero under the shared helper.

Final focused tests passed ten cases across the layout and workflow suites. The four layout tests pass both baseline and harmless-comment copies. Six targeted mutations fail: unbounded newlines, unbounded wrapping, long identities returned to the narrow column, raw field labels, word-splitting continuations and Unicode code-unit splitting. Native rerendering still retains all 90 numbered scope lines. Source/test ownership was returned to root for its final checkpoint. New history 13 files will receive the final delivery disposition; earlier artifact hashes remain their immutable historical results.


## Final history 14 delivery disposition

The final checkpoint is history **14**, superseding the anticipated history 13 delivery above. All nine actual browser-delivered files were inspected: revision 9 internal/public HTML, PDF and XLSX, plus revision 5 internal HTML, PDF and XLSX. Independent reconciliation reproduced all three saved snapshot hashes and compared exact HTML/workbook review rows, PDF notes and hashes, public exclusions and financial states. Full file SHA-256 values and outcomes are retained in [reviewer B evidence](evidence-b/README.md).

| Copy | Independently reproduced snapshot SHA-256 | Included events |
|---|---|---|
| Revision 9 internal | `f504333868edc13b2a38aa70dea371354ca0639b3a0718f834d81e4c623401da` | 1–14 |
| Revision 9 public | `1ecaa77e2eb31316f7ce0b414f9e1723b77cf9e61a4ca47ca1bf47af058f0212` | 5, 6, 8, 9, 10, 11, 13 |
| Revision 5 internal | `6f15c9a3fe279a84f4bb9b3ad0d606e53b8ced551851c29689f1bdb6d1a8edc5` | 1–14 |

Revision 9 has the same content hash recorded for revision 7 above; revision identity remains separately visible. Pending revision 9 expenditure is null/blank and explicitly Unresolved; the baseline revision 5 workbook retains 76,641.63. Human-readable product, schedule and financial differences show the distinction. Public history retains correction event 10, excludes the internal marker, and labels its unresolved list as limited to the included copy. Internal event 14 resolves the old revision-7 comment while retaining its historical bytes; the current revision-9 unresolved item remains. Newly corrected amendment/comment records carry no hidden authority/scope/date fields. Supporting TXT download bytes match the checksum recorded above.

The final PDFs have 11 internal pending pages, 9 public pending pages and 11 baseline pages. I extracted/reconciled the complete documents and visually inspected the changed review/difference/correction pages: revision 9 internal pages 5–7, revision 9 public pages 3–4 and revision 5 internal page 1. This supplements the earlier complete visual pass on the initial delivered PDFs; it is not a claim that all 31 final pages received another visual pass. I separately opened all three final XLSX files in native LibreOffice, inspected pending internal review pages 24–25, public review page 25 and baseline review page 25. No clipped review text or broken continuation word was visible. Native short cost Before/After values remain tightly adjacent but readable; the delivered HTML/PDF has separate lines. Microsoft Excel and full accessibility remain untested.

At this bounded engineering artifact boundary, no blocking defect remains from the reported disclosure, duplicate-difference, draft-recovery, hidden-field, Unicode or row-height findings. Original failed records and this report's earlier conclusions remain intact. The final files demonstrate synthetic workflow custody and usable artifacts, not actual agency approval, adoption, signature, external acceptance or spending permission. Full OWP/UPWP administration, all-50-state/DC capability and full v1 remain the binding destination; this review does not declare them complete or release v0.44. Live authorization, RLS environment custody, full QA and production/browser acceptance are separately owned by root and are not established by these artifact checks.


## Generic Documents download follow-up

After the artifact disposition, root added authenticated streaming to the ordinary Documents download route for packet files and documents referenced by review events. A bounded source review confirms the document lookup includes `work_program_packet_id`, the evidence lookup uses the caller's RLS client with workspace and document-identity containment filters, and a reference-query failure returns 503 before signing. The corresponding SQL event SELECT policy is workspace-member scoped. Both packet and referenced-evidence paths enter the no-store streaming response, which exposes no storage bearer Location. Tests assert the required projection, reference query and both streaming cases.

During the first read the guard was temporarily disabled by `false && references.error`; I reported that exact text immediately. A subsequent read confirmed restoration to `if (references.error)`. This is not recorded as an unresolved shipped defect. I did not run or endorse root's concurrent mutation campaign. No additional flaw was found in the restored bounded source path. Previously issued signed URLs and already downloaded bytes are outside this new-link safeguard. Live authenticated revocation, unavailable/corrupt storage and production retry remain root's acceptance tests. No database writes, service changes or source edits were performed by this reviewer during this follow-up.
