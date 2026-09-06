/**
 * A long unbroken paste expanded a content-sized report summary beyond its
 * clipped workspace panel. document.scrollWidth stayed equal to the viewport,
 * so a page-overflow check alone missed the invisible controls. Measure the
 * actual input and panel. This edits an unsaved draft only; never click Save.
 */
module.exports = {
  id: 'report-draft-stays-readable',
  status: 'fixed',
  finding: '2026-09-05 report draft browser proof on f5ee2ef0: a 2,100-character unbroken paste stretched controls beyond the clipped panel at desktop and 390px',
  why: 'A planner must be able to read the field limit and correct an overlong draft without losing text or controls.',
  expectedFailure: /Report draft exceeds the visible panel/,

  async run({ page, baseUrl, expect, precondition }) {
    await page.goto(`${baseUrl}/dashboard`);
    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    const reports = page.locator('a[href^="/reports/"]').filter({ visible: true });
    await precondition((await reports.count()) > 0, 'A report is required to exercise the draft controls; no report means no layout evidence.');
    await reports.first().click();
    const summary = page.getByLabel('Summary', { exact: true }).filter({ visible: true });
    await summary.waitFor();
    const original = await summary.inputValue();
    const draft = 'QA unsaved layout test. ' + 'x'.repeat(2100);
    try {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await summary.fill(draft);
        await summary.scrollIntoViewIfNeeded();
        const bounds = await summary.evaluate((input) => {
          const panel = input.closest('article');
          const field = input.getBoundingClientRect();
          const box = panel.getBoundingClientRect();
          return { inputLeft: field.left, inputRight: field.right, panelWidth: box.width, viewportWidth: innerWidth };
        });
        expect(bounds.panelWidth <= width && bounds.inputLeft >= 0 && bounds.inputRight <= bounds.viewportWidth,
          `Report draft exceeds the visible panel at ${width}px: ${JSON.stringify(bounds)}`);
        expect(await summary.inputValue() === draft, 'The full draft must remain available; truncating it is not a layout fix.');
        expect(await summary.getAttribute('aria-invalid') === 'true', 'The overlong draft must be identified at its field.');
        expect(await page.getByRole('button', { name: /Generate (PDF|HTML) packet/, exact: true }).filter({ visible: true }).isDisabled(),
          'An unsaved overlong draft must not generate the older saved report.');
      }
    } finally {
      await summary.fill(original);
    }
  },
};
