# Plan-owned geography, authority and applicability

This is an implementation design for roadmap M1, not a new queue or a claim
that the workflow exists. It starts at `d6b5eb37`, after preservation of frozen
identity and descriptor editions. The October 6 direction review and current
M1 definition govern the work. The direction check passes with its dated
registry and candidate-version reminders intact.

## Reproduced ownership problem

The create API reads the workspace home jurisdiction and refuses a different
configured descriptor. The creator filters its available descriptors using that
same recommendation. Its study-area picker retains a resolved place's label,
but discards the resolver identity. A free-text authority label cannot establish
legal applicability. These are separate defects; allowing every descriptor in
the select control would not resolve them.

The existing `PlaceOfRecord` is owner-neutral. Project place handling already
re-fetches a selected boundary on the server and distinguishes resolved, drawn
and uploaded sources. Reuse that handling through a shared geography helper,
rather than copying a project-prefixed row or adding another geocoder. The
existing `StudyAreaPicker` remains the geographic entry point. Country-specific
identifier interpretation stays in its adapter.

## Facts and responsible actions

1. **Study area:** retain the exact validated geometry and its capture source.
   A resolved place also retains the resolver, kind, reference, label and
   jurisdiction codes returned by the server. A drawn/uploaded boundary has no
   inferred legal identity. Preserve explicit unknown values and antimeridian
   geometry; a bounding box does not replace the boundary.
2. **Responsible bodies:** the plan owns its adopting and other responsible
   authorities, their stated roles and supporting references. Multiple bodies,
   sovereign governments and overlapping responsibilities remain representable.
   A Census boundary is not evidence of an adopting body's power. Do not place
   confidential consultation records in this public context.
3. **Applicability assessment:** an authorized planner identifies the checklist
   selected for this plan, its applicable scope, supporting sources, unresolved
   questions and basis for selection. Server-authenticated actor and time record
   who saved the assessment. A saved staff assessment is not counsel approval,
   statutory completeness or agency adoption. Neither office location nor a
   point-in-polygon result can fill this assessment.
4. **Version history:** freeze the study area, responsible bodies, assessment
   and descriptor edition with the version. Public, internal and exported
   derivatives use that frozen context. Historical absence remains explicit;
   there is no automatic backfill from the current draft. An amendment carries
   forward prior context as a starting point and identifies subsequent changes.

Use additive, data-safe persistence. Validate the same context on the create and
update routes, and preserve complete values when a write fails or a reply is
uncertain. Read failures remain different from an unset assessment. Plan reads
must select every field used by the validation; database doubles must honor
those projections. Existing roles and action refusals remain in force.

A configured checklist needs an explicit supported applicability assessment.
The adapter must define its supported scope. Generic core code must not encode
California authority names, US state lists or a rule that every authority in a
state follows the same law. Neutral work remains available when scope is
unresolved or not configured. Preserve the full stated authority context in
those cases. A future adapter must be able to support overlapping rules without
changing the shared concept of an authority or a place.

## California plan-kind source review, October 7

The installed California descriptor gives general and specific plans the same
requirements and terminology. Article 8 establishes distinct specific-plan
content: land uses, supporting facilities, development/resource standards,
implementation measures and a relationship to the general plan. Sections
65453 and 65454 also distinguish adoption instruments and require general-plan
consistency. These distinctions belong in sourced plan-kind rules, with their
exact edition retained at freeze. This review does not establish the complete
set of applicable local, environmental, tribal or housing duties.
[Government Code, Article 8](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=GOV&division=1.&title=7.&part=&chapter=3.&article=8.)

LCI's guidelines page describes the 2017 comprehensive guidelines and later
technical advisories. Its current tribal-guidelines project is an ongoing
update; it is not a newly adopted replacement for the existing guidance. Keep
binding statutory text, issued guidance and draft/update activity distinct.
[LCI guidelines](https://lci.ca.gov/planning/general-plan/guidelines/),
[LCI tribal-guidelines update](https://planningupdate.lci.ca.gov/tribal-consultation-guidelines/).

The direct section endpoint for Government Code 65300 returned 403 during this
pass. Do not treat that failed fetch as a verified current section. Article 8
was retrieved successfully. No registry dates or legal rules were changed by
this research note.

## Required evidence before claiming M1 complete

Exercise a California client plan in an Oregon workspace, an Oregon plan in a
California workspace, missing workspace home, uploaded geometry, a multistate
body and a sovereign authority. Workspace-home changes must not change plan
applicability. Study-area edits must not silently change responsible bodies.
An unsupported or incomplete assessment must remain visible and must not gain
a configured-law claim through labels, client-supplied codes or a default.

Challenge general, specific, revision and amendment selection against their
actual source rules. Verify retained records and public/exported context before
and after current-draft edits and registry changes. Keep harmless and failing
mutation controls, native ownership/RLS evidence, recovery after uncertain
writes, identified desktop/390px navigation, console review and usable files.
Practitioner and counsel acceptance of the claimed scope remains separate from
engineering checks. The full v1 contract and other M1 requirements remain open.
