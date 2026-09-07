# Complete OWP preparation

Status: implementation in progress; no preparation or release pass.

User direction removes mandatory Nathaniel or external finance-review dependency for engineering acceptance. Independent agent reconstruction, implementation review, calculation/recovery/access tests and inspected browser-delivered artifacts are required. Actual agency adoption, spending and submissions remain separate human decisions.

Isolated checkout: `~/.local/state/openplan/owp-preparation-2026-09-06`, branch `work/owp-preparation`, base `86cb4aa0`. Existing main services and workers are not owned by this work. Public reference originals remain in the retained housekeeping source directory.

Order: durable Documents/OCR intake and immutable extraction versions; complete source/amendment mapping; structured funding/staffing reconciliation; revision-bound retained exports; independent review and identified-build desktop/390px delivery verification; main integration and CI.

Baseline findings: PDF extraction precedes the document database insert; OCR jobs live in worker memory; undelivered results and downloaded bytes are deleted; callback receipts precede nontransactional application and can acknowledge a retry whose result was never applied. Source attachment re-extracts synchronously and requires indexed page count. Local draft recovery only checks schemaVersion and the elements array.

v0.44 remains separate: retain nine complete and three partial journeys. Reassess safety, model comparison and validation-evidence outcomes before any twelve-journey rerun. No tag authorized by preparation success alone.

## Checkpoint at 2026-09-06 17:47 local

Six standalone OCR worker suites pass. Durable acceptance, retained originals, exact result replay and request identity tests include subprocess interruption. Independent review found and reproduced a terminal-result delivery race; terminal assignment and commit now share the registry lock, and concurrent delivery is serialized per job. Delivery rechecks persistence before HTTP. Independent mutation evidence is in the review scratch directory pending final report.

The isolated application has four additive development migrations applied, with corrected unpublished function bodies reapplied without a reset. Thirteen live work-program/recovery tests pass; 118 related unit tests pass. This is not full acceptance. Remaining work includes full mutation coverage, reference reconstruction through the application, actual exports/LibreOffice comparison/PDF inspection, browser recovery/access/download journeys, comprehensive gates and main integration.

Owned runtime: application port 3217, OCR worker 8587 and the local document-export worker. Isolated Supabase project `openplan_owp_preparation` uses ports 56321 onward. Its files and private logs are under `~/.local/state/openplan/owp-preparation-db-2026-09-06`. A startup-log mistake exposed temporary test credentials in tool output; stop this isolated stack after verification. No other stack or production configuration was changed.

Browser selected through the supported Chrome extension. Landing and signup navigation reached the isolated checkout. No account or preparation workflow verified yet. Generated Next development route types contain a duplicated tail, so the latest type check fails in generated output; investigate/regenerate before reporting a pass.
