# Portfolio spreadsheet import research

## Decision

Build a reviewed, create-only CSV portfolio import as OpenPlan's next
planner-facing slice.

The supported outcome is specific: a planner brings a multi-row capital, RTP,
or TIP project table into one OpenPlan portfolio without re-entering each
project. The evidence does not support silent bulk creation, automatic updates,
or automatic interpretation of agency-specific status and funding fields.

The public agency examples are usually XLS or XLSX, not CSV. The evidence
supports spreadsheet intake more broadly than CSV alone. A CSV first slice is
reasonable because OpenPlan already parses CSV, but it must tell the planner to
save an official workbook as CSV and retain the original workbook as the source
record.

## Primary evidence

1. OpenPlan's fresh-account review found the unfinished workflow. The shipped
   Funding-tab path stores and indexes a multi-row CSV, maps columns, previews
   rows, and applies one selected row to one existing project. The dated finding
   says portfolio import still needs duplicate handling and a per-row create or
   skip decision. It also says silently creating projects is outside the
   reviewed workflow. See
   [the first-week work list](../ops/FIRST_WEEK_READINESS_WORK_LIST_2026-08-24.md)
   and [the closure record](../ops/FIRST_WEEK_READINESS_2026-08-24.md).

2. Caltrans publishes multi-row project workbooks with incompatible row shapes
   even inside one agency. The
   [HSIP Cycle 12 page](https://dot.ca.gov/programs/local-assistance/fed-and-state-programs/highway-safety-improvement-program/approved-project-lists)
   links a
   [project XLSX](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/hsip/2025/listoffundedprojectsr120250306.xlsx).
   Its fields include project and application IDs, agency, county, MPO,
   location, description, project cost, HSIP funds, application category,
   funding type, and special-rule status. Caltrans's
   [CWA archive](https://dot.ca.gov/programs/local-assistance/projects/cooperative-work-agreement-cwa/cwa-archive)
   publishes a different
   [federal-funds workbook](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/cwa/cycle-23/2021-federal-funded-projects.xlsx).
   It uses agency, work description, scope, two project identifiers, program
   code, budget, expenditure, balance, deadline, delay explanation, and
   contacts. A local read on 2026-08-24 found 240 rows carrying both project
   IDs. Twenty-two ID pairs recur, accounting for 39 rows beyond the first
   occurrence, because one project can have several program or funding lines.
   A row is not always a project.

3. NYSDOT distributes its current STIP as regional XLS workbooks with a data
   dictionary. The
   [official monthly download page](https://www.dot.ny.gov/portal/page/portal/programs/stip/stip-project-rpt)
   links [Region 1's XLS](https://www.dot.ny.gov/programs/stip/files/R1.xls).
   The workbook has separate Introduction, Data Field Descriptions, and Project
   List sheets. Its fields include region, MPO, ID, county, agency, plan
   revision, title, description, fund types, annual amounts, government shares,
   and phase amounts. The introduction says the file has one row for each
   funded phase and may repeat a project description. Duplicate-looking rows
   therefore require an external key and row-grain review, not name matching.

4. Public-agency procurement documents require import validation before records
   enter the system. The City of Kirkland's
   [2023 project-management software RFP](https://www.kirklandwa.gov/files/sharedassets/public/v/1/finance-and-administration/business-opportunities/rfp-32-23-pw-for-project-management-software.pdf)
   requires import errors to name source problems such as missing project
   coding, invalid values, and wrong data types. It separately requires
   correction before ordinary entries reach the database. Lake County DOT's
   [capital program system procurement Q&A](https://www.lakecountypurchasingportal.com/addendums/rfp-21118---integrated-capital-program-management-system/)
   says the program tracks projects across years and fiscal constraint by fund
   source and year. It also requires an audit trail for changes to project
   attributes and financial line items.

5. An official transportation upload tool makes create versus update an
   explicit choice. PennDOT's
   [One Map upload page](https://gis.penndot.gov/ONEMAP1/) accepts CSV, XLS, and
   XLSX, asks the user to map columns, and separates new-project creation from
   updating an existing project. New project names must be unique. Updating
   overwrites existing staged data unless the user chooses append. One Map
   imports GIS layers rather than portfolio records, so this only supports the
   need for explicit duplicate and update controls.

The three workbooks inspected on 2026-08-24 are identified by these SHA-256
hashes, because the agencies can replace files at the same URL:

- Caltrans HSIP Cycle 12 XLSX:
  `5d658b83c4db753e7af5096de82143303b3fed209eefeb635382f867670e1f18`
- Caltrans CWA Cycle 23 federal-funds XLSX:
  `b25409d8f1796f8cfaa4e5b0c63d21fe07a50a0d3485d763497db522e7ab2224`
- NYSDOT Region 1 XLS:
  `309d9370c292e27228e575e807320819f6c0c7e2c60959a6ee813f5199048aa7`

## What the source tables share

The stable core is small:

- a source-controlled project identifier when the publisher has one;
- a title or name;
- a description or scope;
- a sponsor or implementing agency;
- a place, corridor, county, region, or other location text;
- a project type, category, phase, or status;
- total cost and one or more funding amounts.

The variation cannot be normalized silently:

- Headers may start after explanatory rows or on another worksheet.
- One row may mean one project, one funding line, or one funded phase.
- Costs may be plain dollars or scaled units stated outside the header.
- A project can have several identifiers with different owners and lifetimes.
- Status, phase, category, and funding vocabularies do not map cleanly to
  OpenPlan's fields.
- Geography may be a county, MPO, road segment, milepoint, or free-text scope.
  OpenPlan cannot infer a verified place from those strings.

## Smallest supported workflow

1. Put the entry point on the existing Projects portfolio. Upload and store the
   source before any project write.
2. Stage the whole CSV. Require a name mapping. Allow optional mappings for a
   source project ID, description, estimated cost, and source location text.
   Ask the planner for currency, cost scale, and price year when cost is mapped.
   Do not derive them from jurisdiction. Keep mapped location as source text in
   the import record. It cannot populate the project's verified place, study
   area, or geometry. A planner can set those later through OpenPlan's existing
   geography workflow.
3. Ask for file-wide OpenPlan project type, status, and delivery phase. Let the
   planner override a row, but do not translate agency status words
   automatically.
4. Validate every staged row before publication. Show each row as `create`,
   `skip`, or `blocked conflict`. Repeated mapped source IDs are conflicts
   because they may be phases or funding lines. An exact normalized-name match
   is a warning, never an update key.
5. Require one explicit human confirmation. Create only rows the planner marked
   `create`. The first version does not update existing projects or merge
   repeated rows.
6. Preserve the source document and hash, sheet or CSV row number, mapped source
   ID when present, row fingerprint, mapping choices, actor, import time, and
   created project ID. A rerun of the same reviewed rows must skip them rather
   than create copies.
7. Return a durable import summary with created, skipped, conflicted, and
   invalid counts plus row-specific errors. Keep unmapped fields in the stored
   source instead of inventing destinations for them.
8. Keep this human-only. Record an assistant-action refusal when the import
   ships, because a bulk create action could author an entire agency portfolio
   from a plausible but wrong file mapping.

This extends the existing reviewed CSV, Knowledge Base, and project-create
contracts. It does not need a new planning module. Updating existing projects
must wait for a durable external-source identity contract and field-by-field
change review.

## Limits

- No OpenPlan user or outside agency was observed moving its own workbook into
  OpenPlan. The local evidence is a fresh-account regression journey, not an
  external user study.
- The agency sources prove that project portfolios live in tabular files and
  that their schemas vary. They do not prove that CSV is preferred over XLS or
  XLSX.
- The examples are from United States agencies. They do not establish worldwide
  field vocabularies or geography conventions.
- PennDOT One Map imports staged GIS data, not capital-project records.
- Public downloads do not fully document how each agency resolves conflicting
  amendments. The first OpenPlan slice therefore refuses updates and merges.
