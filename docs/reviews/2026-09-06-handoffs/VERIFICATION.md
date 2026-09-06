# Undated implementation handoff, September 6

The assigned test action was present in the stored land-use implementation table with `due_on: null` but absent from My Work on baseline 8958985c. The baseline browser record preserves that failure. The corrected reader includes open actions regardless of date and puts missing dates in **Work without a due date**. No stored dates, assignments, statuses, financial authority or adoption records are changed by reading the queue.

The UI now names undated work accurately and discloses unreadable plan actions in both affected blocks. Source selection, caller RLS and workspace/assignee filters remain in place. No new task system or migration was added.

## Evidence

- Five focused suites: 61 tests passed; focused ESLint passed. The new regression first failed because the fixture passed the wrapper instead of its client; after correcting that test error, the baseline failed specifically on the missing undated action. The corrected implementation passes.
- A harmless source comment survived. Eight consequential mutations failed: original date exclusion, invented date, missing assignee scope, missing inner join, including completed actions, omitted selected date, hidden unreadable undated source, and broken FK projection. `undated-mutations.json` records exits; detailed logs remain in the private local housekeeping archive. These fixtures simulate query semantics; they do not prove database policies.
- Separate local Supabase exercise: owner and member clients verify assignment, reassignment and completion; an outsider cannot read or overwrite the action. The record retains its null date and original title. `live-undated-result.json` records the restored fixture. The first exercise incorrectly seeded role `planner`; the existing writer role is `member`, so the first completion did not write. Corrected role and matched-row verification supersede that failed exercise. This was a fixture error, not a proven production authorization defect.
- Actual normal navigation from Overview to My Work, keyboard Tab to the item, and Enter to its original plan. Desktop and 390px captures are source-hash bound in `undated-proof.json`. Mobile screenshot capture initially timed out twice; an explicit viewport clip captured the real 390px render. A desktop capture before scrolling omitted the item and is not accepted evidence. The final focused captures show it. The viewport override was reset.
- Console inspection after reload returned React development and HMR messages. An earlier Overview disclosed an unrelated project-submittal read failure. No claim of whole-app console or workflow acceptance is made.

## Remaining boundaries

The queue retains its disclosed per-source limit of 20; this is not a complete obligation inventory. Missing date is not overdue. Version copying can still reset prior action status and leave multiple versions ambiguous; that independent source finding remains unresolved and does not authorize a new adoption/carry-forward policy here. No autosave, amendment continuity or entire implementation lifecycle is certified by this repair.

Shared-campaign reports/exports and OWP preparation remain pending. The complete v1 contract and sole roadmap queue are unchanged. v0.44 stays unreleased; the historical nine complete and three partial acceptance outcomes remain unchanged. This is a bounded handoff repair, not a new full acceptance campaign or practitioner usefulness finding.
