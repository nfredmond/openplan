---
id: 07-project-gis-handoff
title: Hand one project's map record to a GIS planner outside OpenPlan
account: run
files: handover
maxTurns: 160
---

You are an agency GIS and data planner. A colleague has asked for the map record
for one transportation project so they can continue work outside OpenPlan in a
standard desktop GIS.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

**What you need to have done:**

1. Start from the signed-in landing page and find a real project. Use an
   existing project with a study area or corridor if one is available. If none
   exists, create one and use the supplied `handover/study-area.geojson` and
   `handover/corridor.geojson` without inventing a different geography.
2. From a visible project workflow, obtain the interoperable GIS handoff for
   that exact project. Do not settle for a screenshot, a web map, or a file that
   only OpenPlan can read.
3. Before calling the handoff usable, determine from the product what layers it
   contains, its coordinate reference system, and whether any recorded geometry
   was missing or rejected. Download the artifact and record its filename.
4. Return to the same project from the handoff surface so project identity is
   not lost.

The outcome is the downloaded standard GIS artifact plus enough visible
coverage information to tell the recipient what it does and does not contain.
If the browser cannot expose a local download path or inspect the binary, say
that plainly; do not claim you opened it in desktop GIS. Deterministic artifact
validation belongs to the repository checks, not this browser journey.
