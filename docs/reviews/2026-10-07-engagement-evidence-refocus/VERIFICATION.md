# Repeated contribution inspection

T3 preview on production build 359ab99204b2 reproduced a focus defect on October
7, 2026. In the synthetic campaign's saved staff review, the first activation
of Inspect comment 1 focused Selected contribution evidence. Activating the
same button again left focus on the button. The retained evidence remained
available, but the inspection action no longer returned keyboard focus to it.
The browser readout is retained in before.json. No source or review was changed.

The correction explicitly focuses the already-selected contribution. Selecting
a different contribution continues to use the existing post-render focus effect.
The regression test reproduces the original failure at its second focus assertion;
the other 16 tests pass. With the correction, all 17 tests pass. A harmless source
comment passes the new regression. Removing only the repeated-focus operation
fails the focus assertion. The source is restored after each control.

These tests cover DOM focus and retained contribution text, and assert that
inspection sends no write requests. They do not prove screen-reader speech,
mobile layout, meaningful thematic interpretation or human acceptance. The broader nonempty theme/citation and response-to-decision journey
remains open.

## Corrected production acceptance

Build 8ed6f3980191c6ce16fa36d886e522511de2838d passes production compilation
and TypeScript with the checkout unchanged. Its isolated server on port 3500
reports that commit; PID 3001010 resolves to this worktree's application package.
The database URL points to the owned isolated stack on port 29821.

T3 desktop entry starts at the application root, follows Overview and Engagement,
selects the synthetic thematic workspace and campaign, then opens Analysis,
saved source cc77a4d3 and staff review bf07f2a2. At 1440 by 900 CSS pixels,
first and repeated inspection of comment 1 focus Selected contribution evidence.
Shift+Tab twice returns to Inspect comment 1; Enter focuses the evidence again.
The original contribution's final line remains in the retained text.

At 390 by 844 CSS pixels, the campaign reload and saved-source navigation restore
the selected review. First inspection, repeated inspection and Shift+Tab followed
by Enter for comment 2 focus the retained evidence. Document width stays 390 CSS
pixels. Both screenshots were inspected. T3 stores scaled images, 1280 by 800
for desktop and 566 by 1224 for mobile; these are not native viewport pixels.

A compact health-page snapshot exposes all nine accumulated console entries
without dropping entries. Only one belongs to this build's journey: a CSS preload
warning at 21:51:55Z. The earlier report-test exception and expected HTTP refusals
remain retained history from other builds. No new JavaScript exception appears
in this focus journey. The first long-page snapshot omitted all console entries
and was not used to infer a clean console.

No contribution, synthesis, approval, provider request or public response was
created or changed. Workspace selection is the normal user setting change. This
read-only focus correction produces no new export artifact. The pending parent
integration and exact-head GitHub checks remain separate merge requirements.
