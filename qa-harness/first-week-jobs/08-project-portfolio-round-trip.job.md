---
id: 08-project-portfolio-round-trip
title: Take a project portfolio out to XLSX and bring it back to reviewed import
account: run
files: none
maxTurns: 120
---

You are an agency capital-programming planner handing the current project list
to a colleague who works in spreadsheets. You also need to know that the file
can return to OpenPlan without silently changing project fields.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

**What you need to have done:**

1. Start from the signed-in landing page and reach Projects through visible
   navigation. Download the active workspace's project workbook and record its
   filename. If OpenPlan refuses the export, report the exact stated reason; do
   not work around a row limit or missing price year.
2. Inspect the workbook using an available spreadsheet reader. Identify the
   project-data sheet and the human-readable instructions. Confirm whether the
   file contains formulas and whether it states the create-only and geography
   limits.
3. Return to Projects through the visible interface and upload that exact XLSX
   to Import project list. Select only the Projects worksheet. Confirm that the
   project name, source ID, description, cost amount, cost currency, cost price
   year, project type, status, delivery phase, and source-location fields point
   at the corresponding workbook columns.
4. Preview the selected worksheet. Do not commit: importing into the source
   workspace is create-only and could duplicate projects. Record invalid,
   conflicted, and previously-created counts, including a zero-row preview when
   the workspace is empty.

The outcome is a standard XLSX artifact plus a reviewed import preview whose
row-level fields still mean the same thing. A download alone, a screenshot of a
table, or a committed duplicate portfolio does not reach the outcome.
