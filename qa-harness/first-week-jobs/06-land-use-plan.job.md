---
id: 06-land-use-plan
title: Write a land-use plan, take it through review and adoption, then report progress
account: run
files: handover
maxTurns: 300
---

You are an assistant planner working on your agency's land-use plan. The policy
team needs a public draft now, the governing body will adopt the final version,
and next year your manager must report what the agency implemented.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

**What you need to have done:**

1. Start from the signed-in landing page and create a land-use plan for the
   workspace's home geography. Add a readable section, one policy, and one
   implementation action. The supplied
   `handover/land-use-designations.geojson` is an explicitly synthetic,
   unadopted QA fixture. Upload it through Data Hub and attach its exact ready
   version as the plan's mapped designation so the custody workflow can be
   exercised. Preserve its exercise-only label; do not represent it as agency
   evidence or an adopted map.
   For this isolated QA journey, use clearly labelled exercise-only process statuses and dates
   to test the state transitions. They do not establish legal compliance,
   environmental review, consultation, adoption, or agency
   action. Never describe them as real findings. Localhost exercise-only activation is authorized
   and required for this test; it does not activate a real public portal, contact a real person,
   or take legal effect. Using the current run date in a required `decidedOn` field is authorized
   only when the decision and every surrounding record remain visibly labelled exercise-only.
   The supplied `handover/exercise-only-adoption-instrument.txt` is likewise an
   explicit synthetic QA fixture. Upload it through Documents, preserve its
   exercise-only title, and select it only as the supporting adoption document
   needed to exercise the custody link. It is never a real legal instrument,
   vote, finding, ordinance, resolution, or agency decision.
2. Prepare a public-review version, obtain the actual public address from the
   software, and open it signed out. The public record must make clear what is
   draft and what legal configuration applies.
3. Close the review with a response record, revise the plan if the workflow
   requires it, and record an exercise-only adoption decision using the authorized
   exercise date and supplied exercise instrument. Use clearly labelled exercise
   values and say so in your report; none are an agency decision.
4. Publish the adopted plan or packet and open the readable result from the
   workbench.
5. Update the implementation action and produce the progress report a manager
   would read next year.

The outcome is one connected chain. A draft editor by itself is not completion.
If a later step is impossible because the product requires evidence you do not
have, report that honest stop instead of manufacturing the record.
