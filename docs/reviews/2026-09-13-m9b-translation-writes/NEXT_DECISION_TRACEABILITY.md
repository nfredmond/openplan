# Next M9b boundary: responses connected to project decisions

Read-only source assessment on September 14, 2026, while final v0.59.0 CI runs.
This is the next existing-roadmap boundary, not a new module or a completed claim.
Finish v0.59.0 publication before starting its implementation.

The active M9b row requires source-to-theme-to-response-to-decision traceability.
The existing `close-loop.ts` response schema retains source contribution IDs,
theme, participant summary, staff response, publication status and timestamps.
`response-write.ts` supports those fields with exact-version request receipts.
Neither contract contains a project decision reference. The `close-loop-builder`
lets staff select contributions and write a response, but has no decision picker.

Projects already have `project_decisions`, created through
`api/projects/[projectId]/records/route.ts`. They store a title, rationale,
proposed/approved/rejected status, impact summary and date. The project risk and
decision log displays them. Campaign/project relationships already exist through
`engagement_campaign_projects` with same-workspace checks. Extend these systems;
do not create another decision module or duplicate the project decision record.

The useful next implementation is an explicit link from a saved response to an
existing decision on one of the campaign's projects, with the exact response and
decision versions retained and a reason explaining their relationship. A later
edit, removal, project unlink or permission loss must retain the old evidence and
show that the current source differs or is unavailable. Linking must not approve
a proposed decision or silently publish internal rationale. Existing public
response publication is a distinct action; design its public explanation without
exposing private project records by default. Investigate existing project evidence
bundle source adapters before adding another snapshot format.

Acceptance needs real navigation in both modules and the public explanation,
desktop/390px keyboard and console inspection, retained originals after correction,
interrupted exact retries, current-source conflict, cross-workspace/viewer refusal,
private decision contents and changed campaign/project relationships. Use additive
SQL and native isolation/concurrency checks. Agent writes use the existing action
registry or an executable refusal. No new provider, paid service or external
outreach is needed.

This does not cover every remaining M9b boundary, comparative field usefulness,
the wider planning obligations or separate nationwide model validation. Preserve
the complete V1 contract and the roadmap's other early priorities.
