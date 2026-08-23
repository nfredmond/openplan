# Land Use Plans module backlog

Status: approved future module, not scheduled ahead of the active 0.26.0 milestone.

Nathaniel approved this as a deliberate exception to OpenPlan's usual rule against adding modules
on 2026-08-23. OpenPlan needs a plan-authoring and administration module for cities, counties,
tribes, and other local or regional land-use authorities. The familiar United States examples are
general plans and comprehensive plans, along with specific, area, community, neighborhood, and
similar subordinate plans. Those names are examples, not core type names.

## Product job

A planner should be able to maintain the adopted policy record for a place, connect it to the work
already managed elsewhere in OpenPlan, carry amendments and public review through a durable process,
and produce a traceable plan document without re-entering projects, engagement, maps, evidence, or
implementation status.

The RTP module is the closest existing pattern, but land-use plans need their own module. They have
different legal authority, plan hierarchies, required content, amendment rules, findings, adoption
bodies, geographic relationships, and implementation programs. Reusing the RTP database model as
though the two plan types were interchangeable would hide those differences.

## Intended scope

- A neutral plan registry with jurisdiction-configured public names and plan kinds.
- Parent, child, overlapping, and superseding plan relationships.
- Elements or chapters, goals, policies, implementation actions, programs, and measurable status.
- Plan geography and mapped designations through OpenPlan's existing geography and GIS paths.
- Alternatives, environmental and technical evidence, public drafts, hearings, comments, responses,
  findings, adoption, amendments, and append-only version history.
- Direct connections to Projects, Engagement, Safety, Models, Reports, Grants, Documents, GIS,
  Programs, and My Work.
- Published plan packets and implementation reporting with frozen evidence and explicit provenance.

## Constraints already decided

- Country and jurisdiction rules live in registries or adapters. Core types do not contain a FIPS
  code, a state-specific element list, or a hardcoded legal procedure.
- The existing place resolver remains the only geography front door.
- A jurisdiction bundle may supply required elements, review steps, terminology, and templates, but
  adding a jurisdiction must not require editing shared call sites.
- AI may draft grounded text for planner review. It may not adopt a plan, make findings, choose a
  designation, select evidence, publish a public draft, or answer public comments on its own.
- OpenPlan remains useful without AI and without a jurisdiction-specific bundle. Missing local rules
  must be disclosed as unsupported, never replaced with generic requirements presented as law.

## Decisions to research before implementation

- The smallest shared plan model that can express general, comprehensive, specific, area, community,
  neighborhood, and tribal plans without flattening their differences.
- Which requirements belong in a general registry and which require jurisdiction-specific adapters.
- How land-use designations relate to zoning without turning the module into a permitting system.
- Versioning and amendment semantics, including partial amendments and concurrent subordinate plans.
- The first complete jurisdiction bundle and the evidence required to claim that bundle is complete.

Do not begin schema or UI work from this brief alone. Start with a current review of primary legal
and planning sources across several jurisdictions, then write and approve a staged implementation
plan. The module is approved; its detailed product model is not yet settled.
