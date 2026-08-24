# Land Use Plans product contract

Land Use Plans shipped across OpenPlan 0.27.0 and 0.28.0. This contract defines
the durable product boundary; it is not an implementation backlog. The dated
0.27 correction remains in `docs/ops/2026-08-23-v027-land-use-plan-correction.md`.

## Planner outcome

A planner can maintain an adopted policy record for a place, connect it to work
managed elsewhere in OpenPlan, conduct traceable review and amendment cycles,
and publish readable plan and implementation records without re-entering
projects, engagement, maps, evidence, or delivery status.

The product supports general, comprehensive, specific, area, community,
neighborhood, tribal, and equivalent plans through neutral shared types. These
familiar names are registry content, not a fixed global taxonomy.

## Durable guarantees

- Plan kinds, elements, requirements, findings, adoption bodies, amendment
  rules, and public terminology are configured by jurisdiction registries.
- The existing place resolver is the only geography front door.
- Plans retain parent, child, overlap, supersession, version, review, adoption,
  amendment, implementation, evidence, and mapped-designation provenance.
- Public review releases and adopted packets freeze exact content and map
  hashes. Later edits cannot rewrite a closed record.
- Confidential consultation notes and sensitive locations are excluded from
  publication.
- AI may draft grounded text for planner review. It may not adopt, make legal
  findings, select designations or evidence, publish a draft, or answer public
  comments on its own.
- Missing jurisdiction rules are disclosed as unsupported. A neutral workflow
  is never represented as local legal compliance.

## Jurisdiction support

California is the first configured legal bundle. Other jurisdiction examples
used to prove neutral types remain fixtures until current primary-source review
supports a configured bundle. Adding a jurisdiction means adding registry data
and sources, not editing shared call sites.

The primary-source basis for the first implementation is recorded in
`openplan/docs/research/LAND_USE_PLAN_JURISDICTION_RESEARCH_2026-08-23.md`.
Future legal bundles require a new, current source review.
