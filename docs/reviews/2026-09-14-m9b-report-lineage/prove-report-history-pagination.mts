/** Render the native fixture with Chrome and prove headings stay with their text. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCampaignReviewHtml, parseReviewSnapshot } from '../../../openplan/src/lib/engagement/review-export.ts';
import { renderReportPdf } from '../../../openplan/src/lib/reports/pdf.ts';
const output = process.env.OPENPLAN_HISTORY_PAGINATION_EVIDENCE;
assert(output, 'Specify a private evidence directory');
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('../../../openplan/src/test/fixtures/engagement-review-decision-history-native.json', import.meta.url), 'utf8'));
const snapshot = await parseReviewSnapshot(fixture.snapshotText, fixture.snapshotSha256, fixture);
const html = buildCampaignReviewHtml(snapshot, fixture.snapshotSha256);
const rule = 'h2,h3,h4{break-after:avoid}';
assert(html.includes(rule));
const results = [];
for (const [name, markup, expected] of [
  ['baseline', html, true],
  ['harmless-comment', html + '<!-- Harmless pagination note. -->', true],
  ['heading-keep-removed', html.replace(rule, 'h2,h3{break-after:avoid}'), false],
] as const) {
  const pdf = await renderReportPdf(markup, { title: snapshot.campaign.title, generatedAt: snapshot.capturedAt, footerLabel: `${snapshot.scope} engagement review | ${fixture.snapshotSha256.slice(0, 12)}` });
  assert.equal(pdf.engine, 'chrome');
  const path = join(output, name + '.pdf');
  await writeFile(path, pdf.bytes);
  const pages = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }).split('\f').filter(page => page.trim());
  const headings = pages.map(page => (page.match(/Retained staff response/g) ?? []).length);
  const content = pages.map(page => (page.match(/SYNTHETIC theme · draft · revision 2/g) ?? []).length);
  assert.equal(headings.reduce((a, b) => a + b, 0), 3, 'Fixture must exercise all three retained responses');
  const kept = headings.every((count, index) => count === content[index]);
  assert.equal(kept, expected, name + ': unexpected page grouping');
  results.push({ case: name, outcome: kept ? 'survived' : 'killed', pages: pages.length, headingPages: headings, contentPages: content, sha256: createHash('sha256').update(pdf.bytes).digest('hex') });
}
const source = await readFile(new URL('../../../openplan/src/lib/engagement/review-export.ts', import.meta.url));
await writeFile(join(output, 'results.json'), JSON.stringify({ synthetic: true, snapshotSha256: fixture.snapshotSha256, rendererSha256: createHash('sha256').update(source).digest('hex'), results, limits: ['Real Chrome PDF and extracted page boundaries for this native fixture; visual inspection is separately recorded.', 'Does not prove every possible narrative length or the browser download workflow.'] }, null, 2) + '\n');
console.log(JSON.stringify(results));
