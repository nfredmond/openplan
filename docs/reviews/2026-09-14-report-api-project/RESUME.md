# Report API without a project: development checkpoint

v0.61.0 is published at b3514277. This follow-up is outside that tag and is not released. Use the isolated translation-command-workflow-2026-09-13 checkout; main publication record is 3cd87d4a. No PR or human release gate is required.

Real navigation on identified v0.61 build b35142774503 opened a retained consultation report normally, but generic GET /api/reports/[id] returned 500 Failed to load report project. Its saved report has project_id:null; the API unconditionally queried a UUID column with null. Private evidence is decision-context/browser/report-project-api-before-1440-1789406731580.json and PNG.

The handler now skips only the absent project lookup, returning project:null with the existing sections, citations and artifacts. Named-project lookup and failure behavior remain. Seventeen focused route tests and changed-file ESLint pass. The native-shaped baseline previously failed the consultation case with 500. The first unit fixture used invented type labels, corrected to the actual producer's board_packet before the retained failing/passing proof; the independently observed live failure remains valid.

[Mutation proof](mutation-results.json) has a surviving baseline/harmless control and four detected faults: unconditional lookup, missing real project, swallowed lookup error and missing projected project_id. Real handler and shared access resolver run, but database is mocked; actual RLS and native after-check remain distinct. All source mutations were restored. The source and test hashes bind this evidence.

Next: build this committed checkout, identify it, repeat the real report-page/API journey at desktop and 390px, confirm GET200/project:null and original file hashes, and deny anonymous access. Add a real named-project control if an existing scoped report is available; do not hand-seed a new fixture. Run applicable QA and final CI, then land directly on main and release a patch increment with aligned metadata. No migration or worker source changed. Continue the full V1 roadmap afterward.

Own server session37176 on port3262 may still serve the prior release; stop only that identified process before building. No document worker is running. Use the explicit restore-target stack API29821/DB29822; do not reset/drop it or disturb the demo. All raw logs and credentials remain in /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context and the established private account file. The pending reminder constraint remains untouched.
