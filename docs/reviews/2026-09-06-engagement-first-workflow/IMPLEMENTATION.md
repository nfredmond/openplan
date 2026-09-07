# First engagement workflow

User-authorized implementation begins from `398d8f0d` in isolated branch `work/engagement-first-workflow`. Another OpenPlan session is open in main; do not change main or operate its processes while acceptance may be active.

## Required outcome

Complete project-specific setup with editable templates and blank setup, retained published definitions, dates, reviewed layers and preview. Complete point/route/area/non-map participation, durable draft/retry receipts, complete feeds/threads. Human review must retain restricted originals, reasons and immutable history, reject stale changes and ambiguous bulk selection. Reports must produce PDF/XLSX/portable companions from one immutable scoped snapshot through recoverable workers and authenticated storage.

## Verification still required

Two explicitly labelled demonstrations: complete streets and countywide wayfinding. Large multilingual campaign with historical definitions, repeated/missing answers, photos, threads, redactions and formula-like text. Retry/concurrency/privacy/restart/cancellation/revocation checks; independent export reconciliation, every PDF page viewed, LibreOffice workbook opening/recalculation; identified desktop/390px keyboard/non-map journeys and actual download. Changed guards require no-op survivors and targeted consequential failures. Applicable CI/live RLS/additive upgrade checks precede landing.

Human usability observation, competitive evidence, advanced synthesis, decision follow-through and the separate v0.44 release gate remain open unless separately proved.

## Initial findings

- Direction check passes; main CI, RLS and dispatched upgrade run are green at inspection.
- Public portal read caps approved contributions at 200.
- Item PATCH changes content/status without expected-version comparison or immutable originals/history.
- Submission endpoint returns an identifier but shared browser submit helper drops it; retry relies on recent duplicate detection.
- Existing templates, geometry controls, survey definition snapshots, Reports and document export worker will be extended.

## Recovery checkpoint, 2026-09-06 21:56 Pacific

Implementation remains **in progress**, not a completed acceptance or released version. All edits are in the isolated worktree `/home/nathaniel/.local/state/openplan/engagement-first-workflow-2026-09-06`; main has not been changed.

- Added six `2026090800000*` migrations for original/review custody, immutable configuration versions, public-copy guards, leased report snapshots/delivery and atomic survey receipts/review. They are installed only in `supabase_db_openplan-engagement-verification` (API 56321). Initial numbering conflicted with OWP; renamed before installation. A first empty-stack migration missed a runtime reference to nonexistent `place_bbox`; corrected to the actual four place columns and exercised on live campaigns.
- Existing document worker now also prepares immutable campaign PDF/XLSX/ZIP jobs, stores checksummed bytes and exposes authenticated streaming downloads through Campaign and Reports. Public copies are rechecked against current publication/redactions at download. Actual file delivery and worker interruption remain unverified.
- Campaign categories are editable; dates, retained published definitions and translations, submission retry IDs, local draft/receipt recovery, scoped feeds/threads, conditional moderation, immutable history and survey review are implemented. Remaining implementation review includes inherited map framing, reusable custom setup, multilingual receipts, read/filter pagination, and recovery edge cases.
- Focused integration suite: 9 files / 56 tests passed after fixing adapters and audit coverage. Earlier full suite: 1,171 files passed; 15 failed (32 tests). Several failures were subsequently fixed; **the full suite has not been rerun green**. Type checking passed before the latest UI recovery changes; rerun required. Schema subset: 4 passed, one stale column-ratchet entry subsequently removed; rerun required.
- SQL custody probe and harmless/targeted mutations are in `evidence/`. They established immutable originals/definitions/snapshots, mandatory review reasons, scoped public snapshot and anonymous/cross-workspace denial on a disposable rollback fixture. These do not establish all privacy routes, live upgrade or usable files.
- Two explicitly labelled demonstration projects/campaigns were created through normal project→Engagement navigation. Dates saved through the browser. Desktop setup inspected. No public participation or export journey is yet accepted. A selector initially matched the floating selection heading before navigation finished; corrected to wait for the detail URL and content. Earlier shell captures are not acceptance evidence.
- Private scratch evidence and browser scripts: `/home/nathaniel/.local/state/openplan/engagement-evidence` (contains disposable account credentials/auth; never commit). Chrome profile `~/.config/google-chrome-automation/engagement-first-workflow`. Dev server 3225 uses this checkout and isolated stack; Documents worker PID 4066929 was started by this session and needs restarting for latest source. Logs `/tmp/engagement-*.log`. Never print env files or Supabase status credentials. Initial startup log accidentally exposed disposable local-stack credentials; user informed; shared secrets unaffected.
- Next: complete demo setup/public participation/moderation and actual queued report delivery; large labelled multilingual fixture; privacy/concurrency/recovery mutations; PDF every-page inspection and LibreOffice recalculation; full required checks and honest roadmap/ledger/issues update. Preserve the separate human/comparative and v0.44 gates.
