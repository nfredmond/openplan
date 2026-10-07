# Execution permission recovery and remaining acceptance

This is partial engineering evidence, recorded October 6, 2026 Pacific time.
The production build is `00b849e75a3145f1f99d701520bfeddc3ffe18c8`, version
0.66.0, served on port 3479 from the execution-controls worktree. The Next
process cwd and health commit match that checkout. The database is the owned
restore-target stack on API port 29821. The normal demo and benefit-cost
worktree remain outside this check.

## Observed recovery

T3 navigation follows home, sign in, dashboard, Engagement, campaign, Analysis,
saved source, request history and preparation inspection. The completed journey
uses `openplan-execution.localhost:3479`, which separates host-only cookies from
other localhost sessions. An earlier localhost journey redirected to sign in;
the cause is not established.

The segment request `a0a2c622` has four prepared tasks and 43,932 saved bytes.
The browser shows its original local provider endpoint, `synthetic` model and
expired earlier allowance. Its native baseline has one allowance and no
attempts, dispatches or outputs.

The check withholds one real HTTP 200 reply after the execution route saves
allowance `11e52d39-a45e-49c9-99fe-65dc27e9815e`. It does not fabricate a
successful receipt. The UI retains the unconfirmed command. Full navigation,
source reopening and request inspection recover that command without another
POST. An explicit retry sends identical bytes and returns the original ID,
intent hash and expiry. Native inventory then contains two allowances and
still no attempts, dispatches or outputs.

Staff explicitly preserves the recovery copy and activates its download. The
application creates an 842-byte JSON Blob with the same command and scope.
Neither action sends a POST. The check reads the actual generated Blob bytes;
delivery of a downloaded file to disk is not established.

The context and thematic views also read their original providers, expired
allowances and prepared plans. They show 13 tasks with 209,536 saved bytes and
five tasks with 51,749 saved bytes, respectively. No new allowance is submitted
for either stage. Their historical attempts and outputs remain unchanged in
the native comparison.

The [structured records](execution-browser-00b849/) retain exact receipts and
inventory. Run `python3 execution-browser-00b849/check-browser-evidence.py`
from this directory to compare them. Harmless inventory reordering passes.
Changed retry bytes, an automatic reload POST, a duplicate allowance, a new
execution attempt and a changed download command each fail for their stated
reason. This comparison cannot establish independent browser rendering,
worker execution, another actor's access or scientific validity.

## Browser limits and defect found

The inspected [desktop capture](execution-browser-00b849/desktop-recovery.png)
uses a 1440 by 900 CSS viewport. T3 scales its raster capture to 1280 by 800.
At 390 by 844, DOM inspection reports a 390-pixel document width and a visible
278-pixel retry button. Mobile screenshot capture repeatedly fails in the T3
client. Recording also times out. Mobile visual acceptance and final console
review remain open; DOM dimensions do not close them.

Some T3 clicks focus the page first, causing the existing source-access refresh
to unmount private inspectors. The check inspects the resulting page after each
failed action. For the retained-command journey, it then invokes observed DOM
buttons through T3 evaluation and waits for real application reads. This keeps
native route, browser storage and recovery evidence, but is not a complete
pointer or keyboard acceptance journey.

An explicit browser focus event confirms that the new source-scoped memory
retains the unsent provider and model after fresh source and provider reads,
without a save. This exercises the mounted browser application; it does not
establish hardware focus behavior. Request-history expansion and unsent
execution limits still reset when the source inspector unmounts. Submitted
commands retain their separate durable recovery path.

A further read-only browser check sets the attempt limit to one and refreshes
the execution review. The form changes it back to four. No command is sent.
Two added tests reproduce that defect on refresh and close/reopen. The fix
initializes the attempt default once per mounted request scope, preserving
chosen limits during later reads. Fresh charge acknowledgment remains required.
All 15 panel tests and targeted ESLint pass. Harmless comments pass; removing
the preservation guard, suppressing the initial default and retaining an old
acknowledgment each fail. The correction still needs an identified production
build and browser confirmation. It does not preserve unsent limits across a
full inspector remount.

## Check and integration status

The durable full local QA run on `c8177f05` completes with exit zero and an
unchanged checkout: 18,371 tests pass and 1,525 are skipped. Connector checks,
dependency audit and webpack production build with TypeScript pass. Live RLS
was not opted into that local run. The combined `00b849e7` production build
also passes with an unchanged checkout. Neither result covers later edits.

PR #116 is merged as `176feca8`; its seven named checks pass. The post-merge
main QA run `37576861795` also passes. Main RLS and PR #117 current-head checks
remain separate. No release tag or full M9b acceptance follows from this note.
Finish mobile visual and console acceptance, confirm the attempt-limit fix,
inspect exact-head CI and retain the remaining complete engagement workflow.
