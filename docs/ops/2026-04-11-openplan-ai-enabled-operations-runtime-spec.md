# OpenPlan AI-Enabled Operations Runtime Spec

Date: 2026-04-11  
Owner: Bartholomew Hale  
Status: Proposed next-wave architecture

## Purpose

This memo makes the next north star explicit:

OpenPlan should not stop at being a planning database, report generator, or packet command board.

It should become an **AI-enabled planning operations system** where a user can talk to the platform about the full state of their work, the system can gather outside data, and trusted agents can take real actions inside the app.

## Product thesis

The user experience should feel like this:

- the app knows what projects, programs, RTP cycles, reports, scenarios, deadlines, grants, packets, and delivery controls exist
- the app can see what is stale, blocked, missing, or drifting
- the app can pull in relevant outside signals from the internet and public data sources
- the user can ask one question about the whole operation instead of clicking through six modules
- the agent can perform approved work, not only narrate it

This is not a chatbot bolted onto a municipal dashboard.

This is an **agent-enabled operations layer** sitting on top of the shared planning platform.

## What the runtime must be able to do

### 1. See the whole app

The runtime must understand app-wide operational state across:

- workspaces
- projects
- RTP cycles
- plans
- programs
- funding opportunities and awards
- scenarios and comparison snapshots
- models and runs
- reports and packet artifacts
- engagement campaigns
- invoices, submittals, milestones, and other controls

The assistant should no longer behave like a page-local helper that only knows the current record.

### 2. Gather data from outside the app

The runtime should be able to ingest or retrieve:

- public funding notices and grant guidance
- planning and regulatory documents
- public data feeds and datasets
- map and transportation data
- web research needed to support planning, funding, and delivery decisions

This should happen through explicit connectors, provenance logging, and reviewable artifacts, not invisible scraping magic.

### 3. Maintain shared operational context

The runtime needs a common planning-memory layer that answers:

- what is this record connected to
- what changed recently
- what is now stale because something upstream changed
- what action is safest and highest leverage next
- what evidence supports that recommendation

The packet-command work already started this pattern for reports.
The next step is to make that app-wide.

### 4. Take actions inside the platform

The runtime should eventually be able to:

- create and update records
- assemble or refresh packets
- draft report sections
- propose or apply status changes
- attach supporting evidence
- flag deadlines and blockers
- connect opportunities to programs/projects
- trigger multi-step workflows with user-visible audit trails

This requires role-aware permissions, action logging, and explicit trust boundaries.

### 5. Talk to the user about operations as a whole

The user should be able to ask things like:

- What is most likely to slip this week?
- Which grants are worth pursuing now?
- Which packets are stale because scenario evidence changed?
- What changed across our active programs?
- Go refresh the packet basis for this cycle and show me what moved.

The answer should come from shared operational context, not page-specific prompt templates alone.

## Required architecture layers

## Layer 1: System of record

This is the structured app data already being built:

- projects
- plans
- RTP cycles
- programs
- funding opportunities
- scenarios
- models
- reports
- engagement
- controls
- artifacts

## Layer 2: Internet and data gathering layer

This layer brings in outside information and stores provenance:

- source URL or upstream system
- fetch time
- extracted summary
- affected records
- trust/review status
- reusable artifact or dataset reference

## Layer 3: Shared operations context layer

This layer unifies app state into one operational graph or context model.

It should support:

- linked-record awareness
- stale/drift propagation
- deadline and blocker aggregation
- app-wide command priorities
- evidence-aware recommendations

## Layer 4: Agent runtime layer

This is the action engine.

It should support:

- read workflows
- recommendation workflows
- draft workflows
- mutation workflows
- multi-step operator workflows
- approval-aware execution
- audit trail + rollback posture where appropriate

## Layer 5: Conversation and control layer

This is where the user experiences the system:

- app copilot
- record-specific copilots
- operations briefings
- command queues
- guided next actions
- agent handoff and follow-through

## Design rules

### Rule 1: App-wide beats page-local

A page-local assistant can still exist, but the primary intelligence layer must reason over the whole workspace and all linked records.

### Rule 2: Actionable beats decorative

The assistant must be able to do useful work, not only summarize what is on screen.

### Rule 3: Provenance beats magic

Outside data gathering and AI-generated recommendations must cite source, timing, and affected records.

### Rule 4: Permissions must be explicit

The runtime should have bounded powers by role and action type. Safe reads and recommendations are broader than write or workflow actions.

### Rule 5: Shared context beats duplicate logic

Packet queues, stale-state logic, and next-action recommendations should come from shared platform services, not be reimplemented independently in every page.

## Next implementation wave

### Wave 1: Operations copilot foundation

Build the minimum app-wide intelligence spine.

#### Scope
- define workspace-level operations summary contract
- define shared command-queue contract across modules
- define assistant context assembly contract across projects, programs, reports, scenarios, and controls
- expand the current assistant model from page-target previews into workspace and operations summaries

#### Acceptance criteria
- the system can produce one trustworthy workspace operations brief
- packet pressure, controls, and cross-module drift can appear in one shared queue
- recommendations are evidence-aware and not page-fragmented

### Wave 2: Internet-connected research and signal ingestion

#### Scope
- define source-ingestion objects and provenance contract
- support curated external data retrieval for funding/program/planning context
- attach fetched signals to records and command queues

#### Acceptance criteria
- outside signals can be reviewed, linked, and cited in-app
- grants/program/project recommendations can reflect current external information

### Wave 3: Agent action runtime

#### Scope
- define safe action registry
- define role-aware mutation workflows
- define approval and audit trail model
- allow the agent to perform real in-app tasks

#### Acceptance criteria
- the user can approve and run bounded multi-step actions from the copilot
- actions are logged and tied back to records and artifacts

## Immediate build recommendation

Do not jump straight to broad autonomous execution.

The next safe, compounding move is:

1. create a shared **workspace operations summary**
2. create a shared **command queue / command priority** contract
3. evolve the assistant from page-local prompts into an **operations copilot** that can see the whole app
4. only then begin broader internet-ingestion and mutation workflows

That sequence preserves truthfulness while still moving decisively toward the full agent-enabled platform.
