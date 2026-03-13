# OpenPlan Option C Reset Directive

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: ACTIVE — architectural correction directive

## Executive Decision
OpenPlan will proceed under **Option C: modular reset and re-architecture**.

This means:
1. We do **not** pretend the current corridor-analysis app is the full product.
2. We do **not** throw away the current repo and start blind from zero.
3. We **do** reclassify the existing implemented slice as one module inside the larger OpenPlan platform.

## Product Reframing
### Canonical product definition
OpenPlan is a **multi-tenant Planning OS for local agencies, transportation commissions, tribes, consultants, and public-facing planning workflows**.

It is not merely a corridor-analysis website.

### Current implemented slice (to keep, but demote)
The current app should be treated as:
- **Analysis Studio**
- or **Corridor Intelligence Module**

This module includes:
- workspace/auth foundation
- corridor upload
- analysis runs
- report export
- billing skeleton
- California stage-gate scaffold

Useful, but incomplete relative to the full platform.

## Mandatory UI/UX Direction Change
### Problem
Current OpenPlan UI behaves too much like a marketing website:
- top horizontal nav
- page-level landing structure
- broad hero/CTA rhythm
- too little persistent application chrome
- workspace shell is underdeveloped

### New app-shell rule
For desktop/web, OpenPlan must use a **left-side vertical application shell** like a serious SaaS/productivity platform.

### Desktop app-shell requirements
1. **Persistent left navigation rail**
   - always visible on desktop
   - compact icon rail or icon+label sidebar
   - optimized for rapid switching between modules

2. **Contextual secondary navigation**
   - when a module is selected, show nested section nav beneath or adjacent to primary nav
   - examples:
     - Projects → Overview, Deliverables, Risks, Decisions, Schedule, Files
     - Engagement → Campaigns, Pins, Moderation, Reports
     - Models → Scenarios, Runs, Outputs, Calibration

3. **Top utility bar, not top primary nav**
   - top bar should be reserved for:
     - global search
     - workspace switcher
     - notifications
     - quick actions
     - profile/settings
   - primary navigation should **not** live across the top on desktop

4. **Dense, tool-like layout**
   - multi-panel composition is preferred
   - tables, side panels, filters, inspectors, activity feeds, and map/report panes should feel native to operations software
   - avoid “marketing page in authenticated clothing” layouts

5. **Module-first UX**
   - the interface should communicate that OpenPlan contains multiple tools within one operating system
   - corridor analysis is one module, not the homepage identity of the whole platform

### Design reference interpretation from screenshots
The screenshots imply the following desired qualities:
- dark, focused, operator-grade app feel
- persistent left rail
- nested navigation / pop-out context menus
- high information density without clutter
- dashboard/workspace orientation instead of brochure-site orientation
- stronger software-product visual language and weaker marketing-site visual language

## Product Information Architecture (target desktop nav)
### Primary left-nav modules
- Overview
- Projects
- Plans
- Programs
- Engagement
- Analysis Studio
- Scenarios
- Models
- Data Hub
- Reports
- Admin

### Example sub-navigation by module
#### Projects
- All Projects
- Active
- Pipeline
- Risks
- Decisions
- Deliverables

#### Plans
- RTP / MTP
- Corridor Plans
- Active Transportation Plans
- Safety Plans
- General Plans / Land Use

#### Programs
- RTIP / STIP Cycles
- Funding Packages
- Submission Calendar
- Complete Streets
- Compliance Readiness

#### Engagement
- Campaigns
- Social Map
- Comments / Pins
- Moderation Queue
- Sentiment / Themes
- Outreach Reports

#### Analysis Studio
- Corridors
- Accessibility
- Safety
- Equity
- Report Builder
- Run History

#### Scenarios
- Baselines
- Alternatives
- Comparison
- Mitigations
- VMT / CEQA

#### Models
- Inputs
- Synthetic Population
- Networks / Skims
- Managed Runs
- Calibration
- Outputs

#### Data Hub
- Connectors
- Datasets
- Provenance
- Refresh Jobs
- Policy Monitor

#### Reports
- Binders
- Board Packets
- Grant Outputs
- Public Engagement Summaries
- Exports

#### Admin
- Workspace Settings
- Members / Roles
- Audit Log
- Billing
- AI Settings
- Integrations

## Architectural Correction
### Current state problem
The current repo over-centers:
- corridor analysis
- report generation
- pilot pricing
- landing-page framing

This causes product confusion and weakens the path to the actual Planning OS.

### New bounded-domain structure
OpenPlan should be organized as a modular monolith first, with clear domain boundaries:

1. **Identity & Tenancy**
2. **Planning Core**
3. **Compliance & Stage Gates**
4. **Engagement**
5. **Analysis Studio**
6. **Scenario / CEQA Engine**
7. **Model Orchestration (ABM/TDM)**
8. **Data Fabric**
9. **AI Gateway**
10. **Billing / Admin / Integrations**

### Delivery posture
Use a **modular monolith** now.
Do not jump to microservices prematurely.
Extract services only where clearly justified (e.g., ABM/model execution, heavy GIS compute, async ingestion jobs).

## Immediate execution sequence
### Phase 0 — stop the drift
1. Freeze further “website-like” navigation polish on authenticated app pages.
2. Treat marketing/public site and authenticated app as separate UX surfaces.
3. Stop describing OpenPlan publicly as if corridor analysis is the whole product.

### Phase 1 — app shell + IA correction
1. Replace top-nav-primary layout with desktop left-sidebar app shell.
2. Add workspace-aware shell layout for authenticated routes.
3. Move top bar to utilities only.
4. Introduce placeholder routes for major modules so the product structure is visible.
5. Reposition current Explore experience under **Analysis Studio**.

### Phase 2 — domain model correction
1. Add first-class entities for:
   - projects
   - plans
   - program cycles
   - deliverables
   - risks
   - issues
   - decisions
   - meetings
   - campaigns
   - datasets
   - scenarios
   - model runs
2. Keep stage-gate decisions tied to projects, not just isolated runs.
3. Build event/audit structure around the planning operating system, not only analysis execution.

### Phase 3 — feature-track expansion
1. Engagement module
2. Data Hub / provenance layer
3. Scenario + CEQA engine
4. ABM managed runs
5. AI Gateway / copilots

## Non-negotiable UX rule
**Desktop authenticated OpenPlan must feel like a complex planning operations platform, not a startup website.**

That means:
- left nav
- persistent shell
- dense but readable operations UI
- module hierarchy
- contextual panels
- reduced hero/landing patterns inside the app

## Next deliverables to create
1. App-shell wireframe / layout spec
2. Route map and navigation model
3. Domain model reset memo
4. Implementation packet for shell migration in current repo

## Recommendation
Proceed immediately with:
- app-shell redesign
- route/IA restructuring
- corridor-analysis reclassification under Analysis Studio

This is the lowest-risk path that preserves working assets while correcting product direction.
