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
