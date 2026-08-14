/**
 * CARD NESTING AND LINE LENGTH, MEASURED IN A REAL BROWSER.
 *
 * Nathaniel, 2026-08-13, after using OpenPlan as a human for the first time:
 * "it's too 'card' heavy in the UI, I still want to use cards, but it's ONLY
 * cards and when they get super nested it gets confusing."
 *
 * WHY THIS IS NOT A VITEST GUARD. jsdom applies no stylesheet and has no box
 * model, so it cannot answer the only question that matters here: does this
 * element LOOK like a box to a reader? A box in OpenPlan is a border plus a
 * radius (`op-cart-surface`, `module-section-surface`, `module-row-card`, and a
 * great many one-off `rounded-* border` divs) — a class-name scan would miss
 * the one-offs and could never see nesting formed ACROSS component boundaries,
 * which is exactly how /rtp reached five levels.
 *
 * WHAT IT MEASURES, per route:
 *   - `depth`  the deepest chain of nested boxes. The page shell
 *              (`op-cart-surface`) is depth 1, so a section inside it is 2 and
 *              an item card inside that is 3. THE RULE IS 3.
 *   - `deep`   how many boxes sit at depth 4 or worse. The rule is 0.
 *   - `cpl`    characters per line of the widest real paragraph. Reading
 *              surfaces must land between 45 and 90; a 158-character line is
 *              not a reading surface, it is a wall.
 *
 * THE BUDGET IS AN EQUALITY, NOT A CEILING (fixtures/card-nesting-budget.json).
 * A route that gets worse fails. A route that gets BETTER also fails, until the
 * new number is written into the budget in the same commit — otherwise an
 * improvement is a fact in a chat log, and the next lane re-nests the page with
 * nothing to notice.
 *
 * WHAT IT CANNOT SEE, stated so a green run is not over-read:
 *   - A filled panel with a radius and NO border reads as a box to a person and
 *     is not counted here. If a lane replaces borders with background tints,
 *     this audit will report an improvement that a reader cannot see. Watch for
 *     `deep` falling while the page still looks the same.
 *   - It measures whatever data the signed-in workspace happens to hold. A near
 *     empty workspace understates every count; the seeded budget was taken on
 *     one, so the numbers are a FLOOR.
 *   - It says nothing about whether a card is legitimate — that is the worklist
 *     rule, and it is judgement.
 *
 * USAGE
 *   OPENPLAN_BASE_URL=http://localhost:3200 \
 *   OPENPLAN_AUDIT_EMAIL=... OPENPLAN_AUDIT_PASSWORD=... \
 *   npm run local-card-nesting-audit             # check against the budget
 *   ... npm run local-card-nesting-audit -- --write   # re-seed the budget
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BUDGET_PATH = path.join(__dirname, 'fixtures', 'card-nesting-budget.json');
const WRITE = process.argv.includes('--write');

const baseUrl = (process.env.OPENPLAN_BASE_URL || '').trim();
const email = (process.env.OPENPLAN_AUDIT_EMAIL || '').trim();
const password = (process.env.OPENPLAN_AUDIT_PASSWORD || '').trim();

if (!baseUrl || !email || !password) {
  console.error(
    'OPENPLAN_BASE_URL, OPENPLAN_AUDIT_EMAIL and OPENPLAN_AUDIT_PASSWORD are all required.\n' +
      'OpenPlan has no canonical instance, so an audit always names the deployment it measured.'
  );
  process.exit(2);
}

/**
 * Runs INSIDE the page. Everything here uses the real computed style and the
 * real box model; nothing infers from a class name.
 */
const MEASURE = () => {
  const isBox = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const widths = [
      cs.borderTopWidth,
      cs.borderRightWidth,
      cs.borderBottomWidth,
      cs.borderLeftWidth,
    ].map((value) => parseFloat(value) || 0);
    // 0.4px, not 1px: a fractional device scale renders a 1px Tailwind border
    // as 0.689655px. A >= 1 threshold made an earlier version of this sweep
    // report ZERO boxes on every page in the product.
    const bordered = widths.filter((w) => w >= 0.4).length >= 3;
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const rect = el.getBoundingClientRect();
    // Chips, badges and toggles are not cards.
    if (rect.width < 60 || rect.height < 28) return false;
    return bordered && radius > 0;
  };

  const depthOf = (el) => {
    let depth = 0;
    let node = el;
    while (node && node !== document.body) {
      if (isBox(node)) depth += 1;
      node = node.parentElement;
    }
    return depth;
  };

  const scope = document.querySelector('main') || document.body;
  const boxes = Array.from(scope.querySelectorAll('div,section,article,li,form')).filter(isBox);

  let deepest = null;
  let maxDepth = 0;
  let deep = 0;
  for (const box of boxes) {
    const depth = depthOf(box);
    if (depth >= 4) deep += 1;
    if (depth > maxDepth) {
      maxDepth = depth;
      deepest = box;
    }
  }

  const chain = [];
  let node = deepest;
  while (node && node !== document.body) {
    if (isBox(node)) {
      const heading = node.querySelector('h1,h2,h3,h4,[data-slot="card-title"]');
      chain.unshift(
        ((heading && heading.textContent) || '(untitled box)').replace(/\s+/g, ' ').trim().slice(0, 48)
      );
    }
    node = node.parentElement;
  }

  // Characters per line, measured rather than assumed: the paragraph's own font
  // is drawn to a canvas and the mean glyph advance divides its pixel width.
  const paragraphs = Array.from(scope.querySelectorAll('p,li')).filter(
    (p) => (p.innerText || '').trim().length > 140 && p.getBoundingClientRect().width > 100
  );
  let cpl = 0;
  for (const p of paragraphs) {
    const cs = getComputedStyle(p);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = (p.innerText || '').trim().slice(0, 400);
    const advance = ctx.measureText(text).width / text.length;
    const measured = Math.round(p.getBoundingClientRect().width / advance);
    if (measured > cpl) cpl = measured;
  }

  return { boxes: boxes.length, depth: maxDepth, deep, cpl, chain };
};

async function main() {
  const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45000 }),
    page.getByRole('button', { name: /^sign in$/i }).click(),
  ]);

  const measured = {};
  for (const route of Object.keys(budget.routes)) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    measured[route] = await page.evaluate(MEASURE);
  }
  await browser.close();

  if (WRITE) {
    const next = { ...budget, measuredAt: new Date().toISOString().slice(0, 10), routes: {} };
    for (const [route, result] of Object.entries(measured)) {
      next.routes[route] = {
        depth: result.depth,
        deep: result.deep,
        reading: budget.routes[route].reading === true,
        deepestChain: result.chain,
      };
    }
    fs.writeFileSync(BUDGET_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Budget re-seeded from ${baseUrl}.`);
    return;
  }

  const failures = [];
  for (const [route, result] of Object.entries(measured)) {
    const recorded = budget.routes[route];
    if (result.depth !== recorded.depth) {
      failures.push(
        `${route}: box nesting is ${result.depth}, budget says ${recorded.depth}. ` +
          (result.depth > recorded.depth
            ? `Deepest chain: ${result.chain.join(' › ')}. A card inside a card inside a card is the defect Nathaniel named.`
            : 'Better than the budget — write the new number into fixtures/card-nesting-budget.json in this commit so it cannot come back.')
      );
    }
    if (result.deep !== recorded.deep) {
      failures.push(`${route}: ${result.deep} boxes at depth 4+, budget says ${recorded.deep}.`);
    }
    if (recorded.reading && (result.cpl < 45 || result.cpl > 90)) {
      failures.push(
        `${route}: widest paragraph runs ${result.cpl} characters per line. A reading surface holds 45–90; ` +
          'set the prose column to max-width 36rem.'
      );
    }
  }

  console.log(JSON.stringify({ baseUrl, measured }, null, 2));
  if (failures.length > 0) {
    console.error(`\n${failures.length} finding(s):\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nEvery route matches its recorded budget.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
