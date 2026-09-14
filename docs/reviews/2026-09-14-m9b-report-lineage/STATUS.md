# Engagement report context and private decision lineage

September 14, 2026. v0.60.0 is published; this is the next M9b development work.

The saved engagement report page now selects its view from an authenticated,
report/campaign/workspace-scoped export-job lookup. It shows current campaign and
available project navigation alongside retained file controls. A null project ID
does not trigger a failed project query. Job read failures stop that routing;
a successful absent job preserves legacy report behavior. Campaign and project
read failures remain distinct from unavailable context. The generic grant/model
controls are not relevant to a saved consultation snapshot.

The three focused page suites passed 42 tests. The new eleven-test suite runs the
real route and loader with projected-query assertions. Its baseline and harmless
comment survive; eleven targeted faults fail for the intended tests. The file list
component is replaced in these unit tests; they do not prove actual downloads,
real RLS, layout or browser navigation. [Browser acceptance](report-page-browser-results.json) passed on fec3ed7f at desktop and 390px: real Engagement Record navigation, retained report and return links, keyboard activation, all six original-hash downloads, anonymous report redirect and file denial, empty consoles and no horizontal overflow. Both context and download screenshots were inspected.
The previous report warning/download evidence is retained in the v0.60 review.

Private decision-link history in internal PDF/XLSX/ZIP is not implemented yet.
[Source notes](IMPLEMENTATION_NOTES.md) preserve the exact payload/context text,
predecessor history, format compatibility, public privacy and concurrency seams
for that work. Complete it within existing Engagement/Reports/Documents owners;
no new module, paid service or human release gate is required. Full M9b and V1
scope remain open.

The existing route was at its lint size limit. Specialized report selection now
owns the unchanged land-use branch as well as the new engagement branch; a
separate test and targeted fault protect that precedence. Final changed-file
lint and TypeScript passed. One lint invocation from the repository root could
not find the app configuration; the corrected app-directory invocation passed.

Full QA on fec3ed7f finished with 15,325 passing tests, 523 skips and one failure: the plain-language copy guard found increased campaign/record wording. This is an unfinished development checkpoint, not main-ready evidence. The subsequent metadata-editor restoration has 27 passing tests and one remaining copy-guard failure, campaign count 72 versus baseline 71. Do not raise the baseline to hide the failure.

The initial specialized view accidentally omitted the existing title, summary and status editor. The follow-up restores it using ReportDetailControls in metadataOnly mode, with a workspace/user-scoped reports.write role check. This correction is saved but still needs refreshed mutation proof, lint, TypeScript, identified-build browser metadata-save acceptance and full QA. The earlier browser evidence and eleven-fault proof apply only to fec3ed7f, not this follow-up. The saved browser runner still expects the old Open campaign label and must be updated before reuse.

See [restart checkpoint](RESUME.md) for the exact continuation. No v0.61 release is claimed.


## Metadata follow-up

The remaining campaign count was a scanner false positive on the JSX expression `: !campaign.data ?`, not visible copy. Renaming the local result to consultation removes the false positive without changing the guard or its baseline. Metadata-only status and unsaved-edit help now describe retained files. The focused page/editor/copy run passes 28 tests. The updated mutation runner has a 24-test baseline, a surviving harmless comment and 20 targeted failures, including viewer permissions, user/workspace filters, missing role projection, exposed model/generation controls and accidentally cleared citations. The first runner attempt caught a JSX syntax mistake before tests could collect; it was corrected and the complete runner rerun. See report-page-metadata-mutations.json. Final browser acceptance and full QA remain pending.


## Main landing evidence

Full local QA on d6b0a4fc passed: 1,307 test files, 15,332 tests, 523 skipped tests, lint, configured deadcode check, provider connectors, zero dependency vulnerabilities and production webpack/TypeScript build. Local QA did not run live RLS; final GitHub isolation remains a separate check. No migrations, worker sources or upgrade workflows changed.

The identified d6b0a4fc build passed desktop and 390px journeys from sign-in through Engagement, Record and the retained report. Each journey saved title/summary, deliberately lost the successful PATCH response, retained the edits for retry, successfully retried, reloaded the saved values and restored the original metadata. The three PATCH requests contain only title, summary and status; no generation request occurred. All PDF/XLSX/ZIP bytes match the original retained hashes after editing. Anonymous report/file access was refused. Each console has exactly one expected injected network failure and no other errors. The editor, controls and context screenshots were inspected at both widths. The acceptance server was stopped afterward. See report-page-metadata-browser-results.json.

The original server start supplied an eight-character SHA and the identity check correctly refused a match. Restarting our server with the full commit produced MATCH before browser acceptance. Initial editor captures missed controls after the asynchronous file list expanded; the runner now waits for file links and captures the save controls explicitly. These were acceptance setup/capture corrections, with no application changes after full QA.

This fix is ready for direct main landing and final CI, with no PR or new release tag. Continue internal decision-history exports. The generic report GET API still assumes a project ID; the specialized page and metadata PATCH avoid that path, so do not claim that API coherence gap is fixed.
