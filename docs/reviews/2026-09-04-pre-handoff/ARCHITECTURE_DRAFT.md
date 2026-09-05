# OpenPlan architecture

Working description from the 2026-09-04 review. Confirm final source/release identity before publishing this as current documentation. The product contract defines the destination; this document describes the implemented structure and its important unfinished boundaries.

## Runtime and repository map

| Location | Responsibility |
|---|---|
| `openplan/` | Next.js/React/TypeScript web application, API routes, app scripts and Supabase migrations |
| `openplan/src/app/` | Authenticated planner pages, public/embedded portals, authentication and HTTP routes |
| `openplan/src/components/`, `src/lib/` | User controls, domain logic, source adapters, evidence and role/approval policies |
| `openplan/supabase/` | Local development stack configuration and forward migrations |
| `workers/` | AequilibraE, ActivitySim, county-onramp, OCR and ODM execution services |
| `scripts/modeling/`, `scripts/research/` | Offline scientific preparation, diagnosis, experiments and custody verification |
| `data/modeling/`, `schemas/` | Versioned published scientific evidence and its contracts; frozen studies are historical records |
| `qa-harness/` | Real-browser journeys, evidence checks, regression scripts and local-target protections |
| `.github/workflows/` | App, worker/script, RLS, browser, upgrade, recovery and source-contract checks with different triggers |
| `docs/` | Product contract, single roadmap, capability ledger, architecture, ADRs and dated research/reviews |

App commands run inside the nested `openplan/` package. Python and browser commands use their own declared roots/environments. A copied runtime is not identified by port alone; compare process working directory, source commit and reported deployment identity.

```mermaid
flowchart LR
    Planner[Planner browser] --> App[Next.js pages and API]
    Public[Public and embedded portals] --> App
    App --> Auth[Supabase Auth]
    App --> DB[Postgres and PostGIS with RLS]
    App --> Storage[Supabase Storage]
    App --> Sources[Configured external data and map providers]
    App --> AI[Current optional Anthropic API]
    Workers[Modeling, county, OCR and imagery workers] --> DB
    Workers --> Storage
    Workers --> Local[Local model and imagery files]
    Scheduler[Operator scheduler] --> App
    DB --> Exports[Approved reports and evidence packages]
    Storage --> Exports
```

The diagram is a responsibility map, not a deployment or security certification. Worker-specific APIs and callbacks differ; read the relevant DEPLOY document before operating them.

## The planning record

Projects and statutory plans are the intended durable owners of context. Projects already connect delivery milestones, decisions, meetings, issues, funding and selected evidence. Generic Plans, Land Use Plans and RTP cycles have different structures. Generic linked-plan readiness must not be mistaken for the versioned legal/review/adoption process of a statutory plan.

Data Hub/workspace GIS owns source datasets and layers. Documents/Knowledge Base owns uploaded source documents and extraction. Analysis, Models/Scenarios and Safety produce evidence. Engagement owns campaigns, submissions, moderation and public-response records. Programs, Grants and Invoicing carry programming, award and reimbursement work. Reports and project evidence packages assemble selected records. My Work exposes assigned work and approvals. Aerial connects missions and processing outputs to planning evidence.

The implementation is not yet one seamless record. The review identifies independent translations at plan creation, workbook import, direct versus governed GIS export and source-to-report handoff. Extend existing owners and shared evidence builders rather than create another project registry, GIS stack or approval implementation.

## Geography and authority

`src/lib/geographies/place-resolver.ts`, the geography routes and StudyAreaPicker form the main place-selection path. `PlaceOfRecord` separates identity from exact geometry and deliberately leaves drawn areas without invented administrative identity. US-specific concepts belong in adapters/registries rather than shared core types.

Study extent, place identity, workspace home, adopting authority and legal applicability are different facts. At the reviewed commit, land-use legal descriptors are restricted by workspace home; that is a known semantic defect for client/overlapping/sovereign work. The roadmap extends plan-owned authority and plan-kind/version-specific rules. It does not claim those changes already exist.

All states/DC, California depth and explicit territory coverage remain governed by the product contract. Tribal and regional authorities cannot be inferred solely from enclosing state or county geometry. Unsupported, unknown, multistate and failed-read states stay distinct in the readiness system.

## Identity, permissions and approvals

Supabase Auth identifies users. Membership selects a workspace; the role vocabulary is owner, admin, member and viewer. The action matrix controls named application actions. PostgreSQL RLS, grants and immutable-record constraints enforce database boundaries, including linked child records. Separate service-role clients perform privileged operations and require their own narrow checks.

Public/share-token routes intentionally expose approved subsets. A valid share token is not permission to publish confidential originals. Exact artifact/payload hashes bind named review/approval records. The assistant action registry and route-local verification must retain distinct agent identity and human approval. Publication, adoption, spending and claim promotion remain human-controlled.

These foundations establish more than API convention, but they do not prove case-level confidentiality, agency records retention, tribal governance or every service-role side effect. Live RLS, public-derivative and revoked-access journeys must accompany relevant changes. Never infer a safe route solely because it imports an authorization helper.

## Long jobs and model science

AequilibraE and ActivitySim are separate demand methods. Shared networks/assignment and comparison boundaries support disciplined comparison; their results must never be averaged. ActivitySim execution exists. Borrowed behavioral parameters, period/mode representation, distribution, external travel, road loading and nationwide validation remain scientific gaps.

GTFS catalog, upload and refresh ingestion currently runs in a 300-second HTTP request, with durable version/custody state and abandonment cleanup but no resumable worker execution. Move the long work using those existing semantics after representative profiling.

General polling workers claim stages in Postgres. County-onramp jobs use a separate attempt/callback lifecycle. OCR and ODM have their own runtime and artifact contracts. Long work belongs in these workers, not in a serverless request. General-run reconciliation currently relies on stage timestamps while independent worker heartbeats live separately; healthy long ActivitySim silence needs explicit fault-tested reconciliation and attempt fencing.

Versioned scientific artifacts distinguish assignment-blind input/audit preparation from post-output diagnosis. Published v0.39-v0.44 studies are development evidence, not untouched nationwide acceptance. Consumed holdouts stay consumed. Rules-v5 remains diagnostic and inconclusive; a new preregistration alone cannot turn it into an acceptance evaluator. Each published use requires an implemented, preregistered and independently evaluated scientific gate.

Database custody, published files, loader checks and the actual production ingestion path are separate responsibilities. A correct published JSON file does not prove that every application run has persisted or displayed it correctly. Preserve raw residuals, unsupported observations and negative candidates.

## Data and external services

The current map implementation uses Mapbox GL and Mapbox-hosted styles; GIS placement preview sends an extent in a static-image URL. Census/TIGERweb/LODES, NHTSA FARS, California crash sources, OSM, grants and other domain adapters retrieve external data. Optional AI sends selected grounding/content to its configured provider. Self-hosted records do not imply no external traffic.

Operators need a maintained outbound-service inventory, source licenses, attribution, credentials, freshness and incomplete/outage behavior. The future local-capable renderer/data path must keep maps useful when outside services are disabled. Open-source libraries do not automatically grant rights to every source dataset or imagery tile.

Imports must preserve geometry, CRS/axis order, units, identifiers and source provenance. Exports declare exactly what they include. Workbook create-only import is distinct from edited-record reconciliation. Direct and governed GeoPackages currently assemble different selections; optional model/designation geometry support is not yet connected to those production calls.

## Deployment and durable state

The local Supabase CLI stack is for development/evaluation. Agency production self-hosting requires a separately configured and hardened Supabase deployment, Node app, worker processes, storage, authentication/email, scheduler and recovery procedure. The repository's local walkthrough helper is machine-specific and must not stand in for independent commissioning.

Durable state includes database records/auth state, Storage metadata and object bytes, local model/imagery artifacts, scientific source receipts/configurations, and the operator configuration/secrets needed to recover them. `.next`, dependency caches and browser profiles are not the authoritative planning record.

Migration deployment precedes app code that requires new schema. Read the actual release notes and rehearse nonempty upgrade paths; do not assume every future migration is backward-compatible merely because prior ones were. Rollback is a verified recovery procedure, not a destructive reset of the working stack.

Existing restore/upgrade drills cover representative records, not the complete documented backup mechanism and every local artifact. A completed full restore must prove semantic records, exact bytes, relationships, roles, published versions and continued work on a separate target.

## Verification and architectural decisions

Use focused behavior tests for observed defects, live database probes for permissions/custody, browser journeys for actual reachability, and independent people for usefulness and operations. Source-string guards protect narrow mechanical relationships and cannot certify workflow behavior. Each changed consequential guard needs a no-op survivor and a targeted failing mutation.

Read ADR-002 for the multi-engine choice, ADR-003 for crash-source acquisition and ADR-004 for agent-server intent. They preserve dated reasoning; verify current third-party APIs, licenses and protocol details before implementing from them. The roadmap owns future work. An architecture diagram or capability label never overrides measured failure.

## Proposed early extensions: participation, agent connections and capital delivery

These are roadmap designs, not implemented architecture. Nathaniel's September 4 priorities deepen three existing owners. Engagement retains campaign/question versions, source geometry and moderated public derivatives, then links responses and commitments to project/plan decisions. Projects retains the capital case through environmental, ROW/utilities, PS&E, procurement, construction and closeout; Documents, stage gates and Invoicing supply versioned evidence and separately reconciled payments/reimbursements. Rule applicability depends on actual authority, funding, agreement and effective date rather than workspace home.

The Planner Agent currently uses Anthropic API access. Proposed direct API adapters and a paired local connector expose installed Codex/Claude Code/OpenCode through one capability contract. T3 Code is the concrete reuse reference for native runtime control. The CLI owns its provider login; OpenPlan controls allowed case reads, proposed actions and exact human approval. A provider process has a separate lifecycle from a browser request. Personal device/account connections are distinct from deployment connections serving unattended jobs or public engagement. See the dated priority research and roadmap A0/M9/M10 for definitions of done.

Changing the model transport does not transfer legal, financial or scientific authority to the model. A CLI shell permission is not approval to publish a response, certify PS&E, accept construction, spend money or submit reimbursement. Those remain recorded domain decisions by authorized people.

## Proposed planning-contract and RTP ownership

The restored requirements extend existing owners. Projects owns delivery context; engagements own the commercial contract/task-order hierarchy; task allocations connect effort, people and deliverables. Source time/cost records retain one identity across internal cost, client invoice and funding-claim views. Approved baseline/rate versions, forecast assumptions and payment events need explicit history. Existing scalar budgets and mixed billed/spend totals do not implement that design yet. See M11 and the contract-budget review.

RTP owns the regional plan cycle, applicable elements, authored chapters and regional fiscal assumptions/rows. Documents owns predecessor bytes and cited pages; reviewed extraction and conflict decisions bind accepted content to the new cycle. A consultant contract for preparing an RTP belongs to M11's project budget; it is never added to the region's transportation financial element unless an actual regional-plan line independently requires it. M12 links plan-level policies, projects, measures, engagement responses and adoption versions to implementation. Existing extraction excludes chapter text from its ordinary launcher; current narrative machinery is a reuse starting point, not proof of the requested intake journey.

## Proposed administered-program reporting

Programs and its existing local-measure fund own the administered program. Projects/Documents own project facts and evidence. A reusable participation record must link the administrator to recipient organizations and their scoped submitters/certifiers; workspace membership alone currently grants broader powers. Versioned reporting definitions create period obligations and frozen submissions with reviewed corrections. Report, claim, payment and public release are distinct records/decisions. Enforce their boundaries at database, API and document access, including asynchronous work.

Metric observations retain project/segment, quantity/unit, method, period/cumulative basis, evidence and revision. Program financial events distinguish receipts, allocations, source expenditures, claims, disbursements and remaining obligations. Successor measure relationships preserve original rule/tax-period identity and authorized transfers. Reuse reporting and review across administered grants while tax ordinances and each award's conditions remain explicit. M13 describes the future design; current claims lack the structured output and recipient-participation joins.

## Proposed procurement ownership and contract handoff

M14 extends the existing consultant proposal pursuit and introduces an agency-owned procurement case. Share the public solicitation identity and issued versions; separate the agency working record, each consultant's private preparation and the formally received payload. Organization participation from M13 is reusable infrastructure, but bidder/evaluator/conflict and protected-price permissions require their own enforced rules. Search, OCR, assistant retrieval, previews, storage and evidence exports inherit those restrictions. Reviewed public records use an explicit publication projection; OCDS is a candidate interchange format, not an authentication or procurement engine.

The procurement case owns method/authority, solicitation/addendum versions, criteria, deadlines, publication, response receipts, permitted opening, evaluation, negotiation, notices/protests and award. The firm's pursuit owns go/no-go reasoning, qualifications/team evidence, response work and proposed fees. Receipt binds committed bytes and authoritative time; external delivery stays unconfirmed until supported. Award, execution and notice to proceed are separate. Executed scope, staff/rates, task/deliverable budgets, funding and deadlines transfer into M11/M10 while preserving proposal-to-contract changes. The current grant/proposal discriminator and export assembly alone do not provide these outcomes.

## Proposed hosted preview and customer deployment

M15 uses the same release and capabilities as self-hosting. Commission a production Linux reference topology with HTTPS, production Supabase, private database/worker administration, app and scheduler supervision, real mail and durable model/object storage. Current county execution assumes app/worker shared files; remote workers need a verified artifact-transfer contract. Use measured queues and resource isolation so a model cannot exhaust the interactive application. Promote tested versions with schema/identity checks and a tested recovery route.

Hosted trials receive separate workspaces and deliberate retention/cleanup rules. Cost controls protect shared resources and authorized external spend, not software subscription tiers. Customer transition needs a complete isolated workspace transfer including bytes, provenance, roles and continued jobs, followed by restore and upgrade proof. Prefer customer-owned hosting/domain/provider accounts and delegated administrative access. Optional implementation, annual administration and customization use the same free software; independent setup and an exit path remain mandatory. A browser-only hosted agent and an authenticated connection to an installed personal CLI are different runtime paths under A0.

## Proposed platform-wide agent execution

A0 selects the model/backend; A1 owns durable planning assignments and shared capability access. Retain AI SDK 6 for current API calls, native CLI sessions through a paired local connector, the OpenPlan registry/approval/domain services and existing workers. A bounded Postgres-backed assignment state machine records scope, source versions, actor, proposed/approved steps, job handles, actual results and recovery. LangGraph JS is a measured fallback for more complex executor state, not a parallel authoritative record. A thin MCP interface admits compatible external clients, including optional Buzz, without duplicating data, identity or approvals. See the dated agentic control decision for alternatives and current upstream boundaries.

External agent identity must be authenticated and enforced on routes; the current execution-source header is in-app attribution, not a delegated credential. Never hand a runner an unrestricted human session or service-role database access. Reuse one tested execution service behind browser and MCP transports. Separate business completion, worker completion, audit receipt and recipient usability. The current stage-gate path checks a resolved database error after its audit wrapper may record success; approval consumption, effect and audit are separate calls. Repair those semantics before automated retry or broader execution. Keep uncertain outcomes visible and recover through durable action IDs.

Buzz brings an independent workspace/relay and infrastructure, so it remains optional. Its pinned standalone runtime is stdio-only and lacks persisted session loading; connecting it to remote MCP requires a tested harness/bridge, not a claim of universal compatibility. The protocol latest is currently 2026-07-28, but clients/SDKs must be pinned. Self-host Supabase configuration documents OAuth server support; the actual OpenPlan issuer/audience/consent/role integration remains unproved. No such agentic runtime or integration was implemented by this review.

## Proposed complete aerial architecture

Extend current Aerial mission/flight/image/job/custody/report records through M5b.1–6. Repair server-side snapshot consistency and profile-specific exported settings first. Version aircraft/payload/controller/app formats separately from geographic context. Survey KML, review KML, WPML/KMZ and USB/device receipts have distinct semantics. A paired local transfer adapter, if needed, accepts only the chosen file/destination and has permissions separate from the native agent runner; a hosted browser does not acquire unrestricted controller storage access.

Persist exact consumed source/control manifests, processing engine/options, NodeODM task identity, callback receipt/application state and resumable artifact transfers. Required output manifests distinguish partial products from complete jobs. Keep current NodeODM while testing a versioned NodeODX adapter against actual contracts/outputs; preserve historical engine provenance. Reuse Aerial Intel viewer/measurement/TiTiler candidates and evaluate OpenGeo tile/extraction work before building replacements, with license, source-unit, memory and analytical validation. A whole-buffer decimated viewer is not a full-resolution volume engine.

Shared GIS services own CRS/vertical reference, surfaces and exported metadata. Each measurement/change record binds exact sources, geometry, method, sampling, coverage, uncertainty and reviewer. Frozen report/public artifacts preserve approved versions. Technical processing, byte custody, independent accuracy and planning/engineering fitness stay separate. Current missing mesh extraction, DNG subset mismatch, in-memory job recovery and callback retry ordering are source findings that require repair before broader reliability claims. See the aerial decision and benchmark for full output, operations and comparison scope; no engine or hardware was run in this review.


## Proposed local-assistance administration records

The full LAPM review reinforces a single project identity with reusable authority, document and financial services. Add source-version/applicability and obligation events tied to the actual agency, fund, phase, contract and trigger; external approval is a separately evidenced fact. Source revisions identify affected live records without rewriting historical accepted packages. Store independent clocks rather than deriving all due dates from award.

Extend existing Projects/GIS/Documents with linked parcel/relocation, utility/railroad, environmental commitment, design/contract, material/labor/quantity/change and dispute records. Agency-produced pay quantities and independent checking feed contractor payment; eligible paid source costs feed a separate funder claim. Staff/fee drawdown and agency cost/cash use distinct bases with shared source allocation identities. Version and lock certified support; reconcile rather than duplicate agency accounting.

Agency programs, audits and maintenance/certification outlive individual projects. Their obligations feed My Work and appropriate Plans/Programs/GIS homes. Restrict sealed fees, payroll/interviews, relocation, bank and counsel/CO memoranda across storage, APIs, search/OCR, exports and agent context. Preserve authoritative full records and reviewed public derivatives, actual retention anchors and longer holds through restore. These are proposed domains and controls, not existing operational or legal-compliance claims; see `LAPM_FEATURE_GAP_ANALYSIS.md`.


## National procedural comparison: extend applicability beyond home geography

Seven-state reconnaissance reinforces explicit sponsor/recipient/pass-through/delivery-agent/asset-owner/payer relationships. Qualification can attach to an agency, discipline, individual or specific project, with restriction and renewal. Resolve applicability using the actual agreement/program/phase and effective event; country/subdivision is one input. Preserve original PIN/agreement/certification identities rather than translating identical numbers across states.

The sampled reimbursement registry provides geographic vocabulary and guidance, not these operational rules. Extend it alongside the shared authority/event/cost services. Approved incurred-cost reimbursement, local advances, state-account transfers and local contingency are distinct financial treatments, selected by actual authority. Retention binds record class, program and source event, including longer state requirements and holds. Rule-source and chapter/form versions require independent currency records. See `NATIONAL_LOCAL_ASSISTANCE_COMPARISON.md`; no new implementation or all-state acceptance is claimed.
