/**
 * A RESIDENT CAN REACH THE BOX WHERE THEY WRITE THE COMMENT.
 *
 * WHERE THIS CAME FROM. On 2026-08-14 a fresh tester opened a live campaign's
 * public link, marked a spot on the map, and could not advance to step 2 — the
 * step that holds the comment box, which is the entire purpose of the page.
 * They tried mouse, forced click and keyboard, on desktop and mobile viewports,
 * on the map page and on /about, with and without a marked location. Every
 * attempt left the wizard on "Step 1 of 5". They filed it as a blocker, and it
 * was the single most central action in the job.
 *
 * IT DID NOT REPRODUCE afterwards. Driven by hand on current main, on a healthy
 * server, "Next" advances to step 2 and the comment box appears — with the
 * campaign unconfigured, and again with a consultation area and geofence set to
 * match theirs. `git log` shows NO commit touching the portal between their run
 * and that check, so nothing fixed it in between.
 *
 * THE EXPLANATION, and it is not "the tester was wrong". The step machine is
 * React state, so before hydration those buttons are server-rendered markup with
 * no handler attached; a click in that window is silently swallowed. Their
 * session was one in which the dev server was dying — another lane in the same
 * run recorded the app becoming unreachable — so that window was wide, and
 * every retry landed inside it. The sibling stage-gate script records the same
 * mechanism on a different control and calls it "a real thing a fast planner can
 * hit, not just a test problem".
 *
 * WHAT CHANGED as a result: the Next button is now disabled until the form can
 * actually answer, so a resident on a slow phone sees a control that is honestly
 * not ready instead of one that ignores them. That does not make this script
 * unnecessary — it makes it the thing that would notice if the step machine
 * itself ever broke.
 *
 * STATUS: fixed, meaning it PASSES today. It was never reproduced-and-repaired,
 * and this header says so rather than claiming a fix nobody made. If it starts
 * failing, a resident cannot comment.
 *
 * IT WRITES NOTHING. It stops at the comment step without submitting, so it may
 * be run against any local campaign repeatedly.
 */
module.exports = {
  id: 'portal-next-advances-past-step-one',
  status: 'fixed',
  finding:
    "2026-08-14T23-26-10-042Z / 03-public-engagement — the resident comment form's Next button never advanced past Step 1 of 5, so no comment could be left at all",
  why: 'A public engagement portal where a resident cannot reach the comment box has failed at the one thing it exists to do, and nothing on screen tells them their click did not land.',

  async run({ page, baseUrl, expect, precondition }) {
    /**
     * FIND THE PUBLIC LINK THE WAY A PLANNER HANDS IT OUT, rather than being
     * given a token. The runner supplies none, and constructing one would test a
     * URL nobody publishes. The tester who found this took the address from the
     * campaign's own panel, and so does this.
     */
    await page.goto(`${baseUrl}/engagement`, { waitUntil: 'domcontentloaded' });
    const campaignLink = page.locator('a[href*="/engagement/"]').first();
    await campaignLink.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
    precondition(
      (await campaignLink.count()) > 0,
      'This workspace has no engagement campaign, so there is no resident portal to open and this run proved nothing.',
    );
    await campaignLink.click();
    await page.waitForLoadState('domcontentloaded');

    /**
     * The share panel prints the address as TEXT, not as a link — it is meant to
     * be copied onto a postcard, not clicked. So this reads it the way a planner
     * does. (An earlier version of this script looked for an anchor and could
     * never have matched anything, which is its own small lesson about writing a
     * selector from memory instead of from the page.)
     */
    const pageText = await page.locator('body').innerText();
    const found = pageText.match(/https?:\/\/[^\s]+\/engage\/[A-Za-z0-9._~-]+/);
    precondition(
      Boolean(found),
      'This campaign shows no public link, so it is not published and there is no resident portal to open. This run proved nothing.',
    );
    const portalUrl = found[0];

    await page.goto(portalUrl, { waitUntil: 'load' });

    const form = page.getByTestId('portal-guided-form');
    await form.waitFor({ state: 'visible', timeout: 30000 });

    const stepLine = form.locator('p', { hasText: /^Step \d+ of \d+$/ }).first();
    const before = (await stepLine.innerText()).trim();
    expect(
      /Step 1 of/.test(before),
      `The form did not open on its first step (it read "${before}"), so this run is not exercising the reported path.`,
    );

    /**
     * WAIT FOR THE BUTTON TO BE ENABLED, not merely present. That wait IS the
     * assertion about the fix: before it, the button is honestly disabled; a
     * build that ships an enabled-but-inert button would fail here by advancing
     * nowhere, which is the original finding.
     */
    const next = form.getByRole('button', { name: 'Next' });
    await next.waitFor({ state: 'visible', timeout: 30000 });

    let enabled = false;
    for (let waited = 0; waited < 30000 && !enabled; waited += 250) {
      enabled = await next.isEnabled();
      if (!enabled) await page.waitForTimeout(250);
    }
    expect(
      enabled,
      'The Next button never became enabled, so a resident can never leave step 1. Either hydration failed or the readiness flag is stuck.',
    );

    await next.click();

    const after = (await stepLine.innerText()).trim();
    expect(
      /Step 2 of/.test(after),
      `Next did not advance the form: it still reads "${after}". A resident cannot reach the box where the comment is written.`,
    );

    // The step number moving is not enough — the comment box is the point.
    const body = form.getByRole('textbox', { name: /we need this part/i });
    await body.waitFor({ state: 'visible', timeout: 10000 });
  },
};
