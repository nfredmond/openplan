/**
 * ONE SCREEN, TWO ANSWERS: which stage-gate template is this workspace on?
 *
 * WHERE THIS CAME FROM. Two fresh agents, in two separate discovery runs on
 * 2026-08-14, both walked into this on their first hour in the product. Neither
 * had seen the codebase. The second one filed it with evidence:
 *
 *   "I set my agency's home geography, and the dashboard told me the stage-gate
 *    template didn't match my jurisdiction and offered a 'Rebind' action to fix
 *    it. I selected the correct template and confirmed the rebind."
 *
 * After confirming, the panel says — correctly — `Bound to <new template>`, and
 * eight lines above it the section header still names the OLD template. The
 * PATCH had already returned 200 with the new template in its body, so the save
 * worked; only the header did not move. A new planner reads two contradicting
 * facts about the same setting and cannot tell which is true.
 *
 * READ THIS BEFORE "FIXING" IT WITH A REFRESH. The panel does not refresh on
 * purpose, and the reason is written where the state lives
 * (`src/components/workspaces/workspace-stage-gate-panel.tsx`): every gate diff
 * on that screen — what leaves the board, what arrives — was computed by the
 * server against the binding that existed when the page rendered. Refreshing
 * part of it would leave a picker offering a second rebind reviewed against
 * facts that no longer hold. That design is deliberate and it is right.
 *
 * What is NOT required by that design is a header that names a template the
 * workspace is no longer on. The narrow fix is for the header to show the
 * binding this session just wrote, while the picker stays closed and the
 * reload-to-continue notice stays exactly as it is.
 *
 * STATUS: fixed in adfbdec6 (2026-08-14) — the header now shows the binding the
 * session just wrote, while the picker still closes and the reload notice is
 * unchanged, exactly as the paragraph above argued it should. This script was
 * left marked `open` in that commit, and the regression runner caught the
 * omission on its next run: "this now PASSES, so somebody fixed it". That is
 * the check earning its keep on the person who wrote it.
 *
 * The `expectedFailure` pattern below is kept deliberately. It is unused while
 * this is `fixed`, and it is the evidence of what failing looked like if this
 * ever comes back.
 *
 * IT LEAVES THE WORKSPACE REBOUND, deliberately and harmlessly: it picks the
 * first template that is not the current one, so consecutive runs swap the
 * binding back and forth rather than accumulating anything. Rebinding edits no
 * recorded gate decision — the panel says so, and that invariant is the reason
 * this is safe to run repeatedly. It is still a write, which is why the runner
 * refuses any base URL that is not local.
 *
 * NOTHING HERE NAMES A JURISDICTION. The template names are read off the page.
 * A deployment that registers a different set of packs exercises this the same
 * way; one that registers only a single pack cannot reach the dead end at all,
 * and this script says so rather than passing.
 */
module.exports = {
  id: 'stage-gate-rebind-header-agrees',
  status: 'fixed',
  finding:
    '2026-08-14T21-10-49-712Z / 01-first-day-setup — after rebinding the stage-gate template, the section header still shows the old template name until the page is manually reloaded',
  why: 'A planner who changes which stage gates their agency uses is shown the old answer and the new answer at the same time, and nothing on the screen says which one the workspace is actually on.',
  expectedFailure: /header still names/,

  async run({ page, baseUrl, expect }) {
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'load' });

    // The setting moved out of the overview when workspace setup became its
    // own visible destination. Reach it through the same navigation a planner
    // uses so another route move cannot masquerade as the original rebind bug.
    await page.getByRole('link', { name: /Workspace setup & health/i }).click();
    await page.waitForURL(/\/workspace(?:\?|$)/, { timeout: 30000 });

    const panel = page.getByRole('region', { name: 'Stage-gate template' });
    await panel.waitFor({ state: 'visible', timeout: 30000 });

    // The header line beside the heading: "<template name> v<version>".
    const headerBefore = (await panel.locator('p').first().innerText()).trim();
    expect(
      headerBefore.length > 0,
      'The stage-gate panel showed no bound template at all, so there is nothing to contradict. This workspace is not in the state the finding describes.',
    );

    // The picker is a radio group, one entry per other registered template. It
    // is absent entirely when the account cannot manage the workspace, when the
    // binding could not be read, or when this deployment registers only one
    // pack — three states in which the dead end cannot be reached at all, and
    // in which a pass would prove nothing.
    const choices = panel.locator('input[type="radio"][name="stage-gate-template"]');
    expect(
      (await choices.count()) > 0,
      'No stage-gate template could be chosen here: this account cannot manage the workspace, the binding could not be read, or this deployment registers only one template. The dead end cannot be reached, so this run proved nothing.',
    );

    /**
     * WHY THIS RETRIES, because it is worth knowing and it cost an hour.
     *
     * These radios are controlled by React. A click that lands before the page
     * has hydrated toggles the input in the DOM and reaches no handler, so the
     * radio ENDS UP LOOKING SELECTED — `isChecked()` returns true — while the
     * component still holds no selection and its button still reads "Select a
     * template". Waiting on the button after a single click therefore waits
     * forever on a page that looks correct.
     *
     * (That is a real thing a fast planner can hit, not just a test problem.
     * It is not what this script is about, so it is not asserted here.)
     *
     * The button label changing is the only proof the click was HEARD.
     */
    const reviewButton = panel.getByRole('button', { name: /^Review rebind to/i });
    let heard = false;
    for (let attempt = 0; attempt < 5 && !heard; attempt += 1) {
      await choices.first().click({ force: true });
      heard = await reviewButton
        .waitFor({ state: 'visible', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
    }
    expect(
      heard,
      'Selecting a template never reached the page: the radio shows as chosen and the button still says "Select a template". The script could not get as far as a rebind.',
    );
    await reviewButton.click();
    await panel.getByRole('button', { name: /^Rebind to/i }).click();

    const confirmation = panel.getByText(/^Bound to /);
    await confirmation.waitFor({ state: 'visible', timeout: 30000 });
    const boundText = (await confirmation.innerText()).trim();

    // "Bound to <name> (<jurisdiction>). No recorded gate decision was…"
    const boundName = boundText.replace(/^Bound to\s+/, '').split(/\s+\(/)[0].trim();
    expect(boundName.length > 0, `Could not read the newly bound template out of: ${boundText}`);

    const headerAfter = (await panel.locator('p').first().innerText()).trim();
    expect(
      headerAfter.includes(boundName),
      `The panel says "${boundText}" but the header still names "${headerAfter}". ` +
        'One screen, two answers to "which template is this workspace on".',
    );
  },
};
