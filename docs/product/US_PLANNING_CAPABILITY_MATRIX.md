# US planning capability matrix

<!-- openplan-planning-capability-matrix
review_date: 2026-09-05
review_by: 2026-10-05
current_release: v0.44.0
capabilities:
- long-range-transportation-and-regional-planning
- land-use-comprehensive-and-community-planning
- travel-demand-corridor-scenario-and-performance-analysis
- transit-active-transportation-freight-and-safety-planning
- environmental-review-climate-resilience-and-equity
- community-engagement-title-vi-and-public-decisions
- capital-programming-prioritization-grants-delivery-and-reimbursement
- gis-data-stewardship-documents-reports-and-public-records
- development-review-implementation-and-interdepartmental-handoff
organizations:
- local-and-county-government
- regional-and-metropolitan-organizations
- state-agencies
- tribal-governments
- transit-and-multimodal-providers
- consultancies
- nonprofits-community-groups-and-independent-planners
geographies:
- all-fifty-states-and-dc
- us-territories-explicitly-assessed
- california-gold-standard
- metropolitan-suburban-rural-and-remote
- tribal-border-island-mountain-and-coastal
statuses:
- proven
- partial
- missing
- not-assessed
-->

This is the coverage ledger for the [v1 product contract](V1_PRODUCT_CONTRACT.md).
It prevents a polished national average or one strong module from standing in
for the whole product. The current inventory is deliberately conservative:
documentation, code, or a green unit test is not enough to mark a cell
`proven`.

The executable source of this inventory is
[`US_PLANNING_CAPABILITY_REGISTRY.json`](US_PLANNING_CAPABILITY_REGISTRY.json).
This page explains the current gaps; the direction check reads the registry and
fails when a required planner, organization, state, capability, artifact,
accessibility, or operations cell disappears or the review expires.

## Status rules

- **Proven:** a representative planner reached the intended outcome from a
  visible entry point, produced and reused the required artifact, and the
  applicable evidence, accessibility, permission, geography, recovery, and
  export checks can fail.
- **Partial:** real reachable capability exists, but one or more required
  journeys, geographies, artifacts, roles, or proof dimensions remain open.
- **Missing:** the required capability or handoff does not exist.
- **Not assessed:** current evidence is insufficient to distinguish partial
  from missing. This fails the v1 gate just as `missing` does.

Only `proven` passes v1. An evidence link and review date are required when a
cell changes to `proven`; prose confidence is not evidence.

## Practice coverage at v0.44.0

| Core planning practice | Current status | Existing foundation | Principal proof gap |
|---|---|---|---|
| Long-range transportation and regional planning | Partial | RTP workflow, fiscal and performance surfaces, projects, reports | Full statutory journey, public draft/comment-response, cycle artifacts, nationwide legal/source depth |
| Land-use, comprehensive, and community planning | Partial | Land Use Plans, exact-hash review/adoption, GIS designations | Nationwide jurisdiction bundles and full plan-production journeys beyond California |
| Travel demand, corridor, scenario, and performance analysis | Partial | AequilibraE, ActivitySim, common assignment, agreement map, rules-v5 comparable observations, full-geometry pre-volume matching, separate dual-method diagnoses, structural demand/loading audits, source-bound LODES8 work-endpoint distribution, and immutable custody | Untouched use-specific California and nationwide acceptance evidence; exact external and non-work through-trip sources; correction and validation of remaining diagnosed defects |
| Transit, active transportation, freight, and safety planning | Partial | GTFS, accessibility, freight, project and safety foundations | End-to-end multimodal journeys; complete injury coverage and state-specific source proof |
| Environmental review, climate, resilience, and equity | Not assessed | Environmental and equity-adjacent evidence exists | Coherent statutory workflows, nationwide applicability, public artifacts, and validation by use |
| Community engagement, Title VI, and public decisions | Partial | Public maps, surveys, comments, translation boundaries, exact-hash agency package review | Campaign-to-decision journey, response record, statutory decision proof, accessibility and multi-project proof |
| Capital programming, prioritization, grants, delivery, and reimbursement | Partial | Portfolio, grants, LAPM reimbursement, reports | One traceable project/funding spine through authorization, obligation, delivery, amendment, and closeout |
| GIS, data stewardship, documents, reports, and public records | Partial | Imports, v2 project GeoPackage handoff, literal-value XLSX portfolio round-trip, frozen governed evidence bundles, evidence custody, reports, provenance | Broader designation/model-link GIS geometry, records lifecycle, and complete cross-module source reuse |
| Development review, implementation, and interdepartmental handoff | Not assessed | Project/land-use primitives and immutable submit/return/approve custody | Product home, full development-review workflow, statutory responsibility, and jurisdiction proof |

## Organization coverage at v0.44.0

| Organization context | Current status | Principal proof gap |
|---|---|---|
| Local and county governments | Partial | Small-town through major-city journeys, departments, statutory variance, deployment |
| Regional and metropolitan organizations | Partial | Complete RTP/MTP, programming, modeling, public review, and partner handoff |
| State agencies | Not assessed | Statewide scale, governance, multimodal programs, records, and distributed teams |
| Tribal governments | Not assessed | Sovereignty-aware sources, boundaries, governance, rural connectivity, and data control |
| Transit and multimodal providers | Partial | Service planning through capital/operations decision journey and GTFS round-trip |
| Consultancies | Partial | Multi-client separation, deliverable review, records transfer, and client acceptance |
| Non-profits, community groups, and independent planners | Not assessed | Accessible self-service workflows, limited-capacity operations, and durable handoff |

## Geography coverage at v0.44.0

No state is yet `proven` against the complete v1 contract. California has the
deepest configured legal and data support and is still `partial`. The other
forty-nine states and the District of Columbia have national foundations but
have not been assessed journey-by-journey, so they are `not assessed` rather
than optimistically marked partial. Territories are also `not assessed`.

The state ledger is maintained in the machine-readable capability registry,
not a hardcoded Markdown list. v0.42 adds a second, sparse job-by-jurisdiction
readiness registry for California, Oregon, and Puerto Rico. It exposes exact
sources, adapter lineage, authorities, limitations, and honest unavailable or
unassessed states before reliance. Those three exemplars are release evidence,
not national completeness. The ledger must still grow to cover state and
territory sources, laws, agencies, identifiers, model strata, journeys, and
artifacts; the release gate may not infer the remaining cells from an
aggregate.

California proof must separately cover statewide, major metropolitan,
suburban, rural, mountain, coastal, border, and tribal contexts. Nationwide
proof must add the archetypes that California cannot represent.

## Cross-cutting proof dimensions

Every practice-by-organization-by-geography journey also needs evidence for:

- visible entry and completion without Nathaniel;
- role and approval boundaries, including adoption and money;
- source provenance, observation uncertainty, claim tier, and limitations;
- cross-module context and artifact reuse without re-entry;
- interoperable import and export with custody preserved;
- keyboard, screen-reader, responsive, print, and public accessibility;
- long-job resumption, failure recovery, backup, restore, and upgrade;
- free, self-hosted operation without required paid infrastructure.

## How this becomes executable

The recurring product-direction check preserves the matrix's required practice,
organization, geography, and status vocabularies. Program work must replace
this initial narrative inventory with data-backed cells and evidence references.
The v1 release gate then requires every applicable cell to be `proven`; it may
not infer completion from this document or from a national score.
