const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { chromium } = require('playwright');
const {
  buildBrowserContextOptions,
  getOutputDir,
  guardLocalMutationTargets,
  loadEnv,
} = require('./harness-env');
const { assertOk, signInThroughBrowser } = require('./fixtures/provision');

const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3200';
const outputDir = getOutputDir(new Date().toISOString().slice(0, 10));
const projectId = '32f5ef20-c0cf-46a9-b103-322938ca23ac';
const projectName = 'Example Corridor Improvements';
const reportTitle = 'Example Corridor Improvements Board / Binder';
const expectedRegistryHash = '2a2fe3c38a86eb28daa2a8dbaa4e48f2ead5ffc7460dc6f37bd7a6132d52a7dc';
const readinessDownloadLinkName = 'Download exact local support JSON';

const exemplars = {
  'US-OR': {
    query: 'Deschutes County Oregon',
    result: /Deschutes/i,
    label: /Deschutes.*OR|Deschutes.*Oregon/i,
    statuses: ['partial', 'unavailable', 'partial', 'partial', 'unavailable'],
  },
  'US-PR': {
    query: 'San Juan Puerto Rico',
    result: /San Juan/i,
    label: /San Juan.*PR|San Juan.*Puerto Rico/i,
    statuses: ['partial', 'unavailable', 'partial', 'unavailable', 'unavailable'],
  },
};

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function openProjectFromVisibleEntry(page) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 30_000 });
  await page.getByRole('link', { name: projectName, exact: true }).first().click();
  await page.waitForURL(new RegExp(`/projects/${projectId}`), { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 120_000 });
}

async function setProjectPlace(page, jurisdictionId) {
  const exemplar = exemplars[jurisdictionId];
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.getByRole('button', { name: /^(?:Change area|Set study area)$/ }).click();
  const search = page.getByLabel('Search for a place');
  await search.fill(exemplar.query);
  const result = page.locator('button:visible').filter({ hasText: exemplar.result }).first();
  await result.waitFor({ timeout: 30_000 });
  await result.click();
  await result.waitFor({ state: 'detached', timeout: 60_000 });
  await page.getByRole('button', { name: 'Save study area', exact: true }).click();
  await page.getByRole('button', { name: 'Change area', exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText(exemplar.label).first().waitFor({ timeout: 60_000 });
  await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
}

async function clearProjectPlace(page) {
  const setArea = page.getByRole('button', { name: 'Set study area', exact: true });
  if (await setArea.count()) return;
  await page.getByRole('button', { name: 'Change area', exact: true }).click();
  await page.getByRole('button', { name: 'Clear area', exact: true }).click();
  await setArea.waitFor({ timeout: 60_000 });
  await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
}

async function visibleStatuses(page) {
  const select = page.getByRole('combobox', { name: 'Planning job' });
  const options = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value));
  const statuses = [];
  for (const option of options) {
    await select.selectOption(option);
    const badge = page.locator('section[aria-label="Jurisdiction support"] span').filter({
      hasText: /Supported here|Partly supported|Unavailable here|Not assessed here/,
    }).first();
    const text = (await badge.textContent()).trim();
    statuses.push({
      'Supported here': 'supported',
      'Partly supported': 'partial',
      'Unavailable here': 'unavailable',
      'Not assessed here': 'unassessed',
    }[text]);
  }
  return statuses;
}

async function downloadReadiness(page, jurisdictionId, suffix) {
  const event = page.waitForEvent('download');
  await page.getByRole('link', { name: readinessDownloadLinkName, exact: true }).click();
  const download = await event;
  const filePath = path.join(outputDir, `v042-${suffix}-jurisdiction-readiness.json`);
  await download.saveAs(filePath);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assertOk(payload.jurisdiction.id === jurisdictionId, `Readiness download resolved ${payload.jurisdiction.id}, not ${jurisdictionId}.`);
  assertOk(payload.registrySha256 === expectedRegistryHash, 'Readiness download has the wrong registry hash.');
  assertOk(payload.reports.length === 5, 'Readiness download does not contain all five planning jobs.');
  if (jurisdictionId !== 'US-CA') {
    const adapterIds = payload.reports.flatMap((report) => report.adapterIds);
    const authorityUrls = payload.reports.flatMap((report) => report.authorities.map((authority) => authority.url));
    assertOk(!adapterIds.some((id) => id === 'us-ca' || id === 'ccrs-ca'), `${jurisdictionId} payload inherited a California adapter.`);
    assertOk(!authorityUrls.some((url) => /(?:leginfo\.legislature\.ca\.gov|dot\.ca\.gov|catc\.ca\.gov)/.test(url)), `${jurisdictionId} payload inherited a California authority.`);
  }
  return { filePath, payload };
}

async function capture(page, name) {
  const dimensions = await page.evaluate(() => ({
    innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assertOk(dimensions.innerWidth === dimensions.documentWidth, `${name} has horizontal overflow: ${JSON.stringify(dimensions)}.`);
  const filePath = path.join(outputDir, `v042-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function captureMobileDownload(page, name) {
  const link = page.getByRole('link', { name: readinessDownloadLinkName, exact: true });
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  assertOk(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 780, `${name} download is covered or outside the mobile viewport: ${JSON.stringify(box)}.`);
  const filePath = path.join(outputDir, `v042-${name}.png`);
  await page.screenshot({ path: filePath });
  return filePath;
}

async function generateCurrentReport(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Open report', exact: true }).first().click();
  await page.waitForURL(/\/reports\/[0-9a-f-]+/, { timeout: 30_000 });
  const format = page.getByRole('combobox', { name: 'Packet format' });
  await format.selectOption('pdf');
  const generate = page.getByRole('button', { name: /(?:Generate|Regenerate) PDF packet/ });
  const generationResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes(`/api/reports/`) && response.url().endsWith('/generate')
  );
  await generate.click();
  const response = await generationResponse;
  assertOk(response.ok(), `Report generation returned ${response.status()}.`);
  await page.locator('button:not([disabled])').filter({ hasText: 'PDF packet' }).waitFor({ timeout: 120_000 });
  const alert = page.locator('[role="alert"]:visible');
  const alertText = (await alert.allTextContents()).map((text) => text.trim()).filter(Boolean);
  assertOk(alertText.length === 0, `Report generation displayed an error: ${alertText.join(' | ')}`);
  const reportUrl = page.url();
  const reportId = reportUrl.match(/\/reports\/([0-9a-f-]+)/)?.[1];
  assertOk(reportId, `Could not read report id from ${reportUrl}.`);
  return reportId;
}

async function freezeAndDownloadBundle(page) {
  await page.getByRole('link', { name: 'Review project records', exact: true }).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}`), { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 120_000 });
  await page.locator('[data-page-tab="evidence"]:visible').last().click();
  await page.waitForURL(/\?tab=evidence/, { timeout: 30_000 });
  await page.getByText('Frozen project handoff', { exact: true }).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Prepare evidence bundle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review project evidence bundle' });
  await dialog.waitFor({ timeout: 60_000 });

  const planSelect = dialog.getByLabel('Linked plan');
  if (!(await planSelect.inputValue())) {
    const values = await planSelect.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
    assertOk(values.length > 0, 'Evidence review has no linked plan.');
    await planSelect.selectOption(values[0]);
  }
  const reportChecks = dialog.getByLabel(new RegExp(`Include .*${reportTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  assertOk(await reportChecks.count() >= 1, 'Evidence review did not expose the generated report PDF.');
  for (let index = 0; index < await reportChecks.count(); index += 1) {
    const checkbox = reportChecks.nth(index);
    if (index === 0 && !(await checkbox.isChecked())) await checkbox.check();
    if (index > 0 && await checkbox.isChecked()) await checkbox.uncheck();
  }
  await dialog.getByLabel(/I reviewed this exact selection/i).check();
  const freeze = dialog.getByRole('button', { name: 'Freeze evidence bundle', exact: true });
  assertOk(await freeze.isEnabled(), `Evidence bundle remained blocked: ${(await dialog.innerText()).replace(/\s+/g, ' ')}`);
  await freeze.click();
  const link = dialog.getByRole('link', { name: 'Download frozen bundle', exact: true });
  await link.waitFor({ timeout: 120_000 });
  const event = page.waitForEvent('download');
  await link.click();
  const download = await event;
  const zipPath = path.join(outputDir, 'v042-oregon-project-evidence-bundle.zip');
  await download.saveAs(zipPath);
  return zipPath;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { env } = loadEnv();
  const guard = guardLocalMutationTargets({
    appUrl: baseUrl,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    scriptName: 'local jurisdiction readiness smoke',
  });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext(buildBrowserContextOptions({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }));
  const page = await context.newPage();
  const consoleProblems = [];
  const failedResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleProblems.push(message.text());
  });
  page.on('pageerror', (error) => consoleProblems.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  const artifacts = [];
  let restored = false;
  try {
    await signInThroughBrowser(page, {
      baseUrl,
      email: 'mapaudit@openplan.test',
      password: 'MapAudit!2026',
    });
    await openProjectFromVisibleEntry(page);

    await setProjectPlace(page, 'US-OR');
    const oregonStatuses = await visibleStatuses(page);
    assertOk(JSON.stringify(oregonStatuses) === JSON.stringify(exemplars['US-OR'].statuses), `Oregon statuses drifted: ${oregonStatuses}.`);
    const oregon = await downloadReadiness(page, 'US-OR', 'oregon');
    artifacts.push(oregon.filePath, await capture(page, 'oregon-1440'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 120_000 });
    artifacts.push(await capture(page, 'oregon-390'));
    artifacts.push(await captureMobileDownload(page, 'oregon-390-download'));

    const reportId = await generateCurrentReport(page);
    const zipPath = await freezeAndDownloadBundle(page);
    artifacts.push(zipPath);

    const extracted = path.join(outputDir, `v042-oregon-bundle-${Date.now()}`);
    fs.mkdirSync(extracted, { recursive: true });
    execFileSync('unzip', ['-q', zipPath, '-d', extracted]);
    execFileSync('sha256sum', ['-c', 'checksums.sha256'], { cwd: extracted, stdio: 'inherit' });
    const bundlePayload = JSON.parse(fs.readFileSync(path.join(extracted, 'project/jurisdiction-readiness.json'), 'utf8'));
    assertOk(isDeepStrictEqual(bundlePayload, oregon.payload), 'Bundle readiness payload differs from the visible project download.');
    const pdfFiles = execFileSync('find', [extracted, '-type', 'f', '-name', '*.pdf'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assertOk(pdfFiles.length === 1, `Expected one report PDF in the bundle, found ${pdfFiles.length}.`);
    const reportTextPath = path.join(outputDir, 'v042-oregon-report.txt');
    execFileSync('pdftotext', [pdfFiles[0], reportTextPath]);
    const reportText = fs.readFileSync(reportTextPath, 'utf8');
    assertOk(/Jurisdiction readiness/i.test(reportText), 'Generated report does not expose jurisdiction readiness.');
    assertOk(/Deschutes/i.test(reportText), 'Generated report does not name the Oregon project place.');
    assertOk(reportText.replace(/\s/g, '').toLowerCase().includes(expectedRegistryHash), 'Generated report does not carry the full readiness registry hash.');
    artifacts.push(reportTextPath);

    await page.goto(`${baseUrl}/projects/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 120_000 });
    await setProjectPlace(page, 'US-PR');
    const puertoRicoStatuses = await visibleStatuses(page);
    assertOk(JSON.stringify(puertoRicoStatuses) === JSON.stringify(exemplars['US-PR'].statuses), `Puerto Rico statuses drifted: ${puertoRicoStatuses}.`);
    const puertoRico = await downloadReadiness(page, 'US-PR', 'puerto-rico');
    artifacts.push(puertoRico.filePath, await capture(page, 'puerto-rico-1440'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 120_000 });
    artifacts.push(await capture(page, 'puerto-rico-390'));
    artifacts.push(await captureMobileDownload(page, 'puerto-rico-390-download'));

    await page.setViewportSize({ width: 1440, height: 1000 });
    await clearProjectPlace(page);
    restored = true;
    const restoredPayload = await downloadReadiness(page, null, 'restored-unidentified');
    assertOk(restoredPayload.payload.reports.every((report) => report.status === 'unassessed'), 'Restored unidentified project inherited an exemplar claim.');
    artifacts.push(restoredPayload.filePath);

    assertOk(consoleProblems.length === 0, `Browser console reported: ${consoleProblems.join(' | ')}`);
    assertOk(failedResponses.length === 0, `Browser received failed responses: ${failedResponses.join(' | ')}`);
    console.log(JSON.stringify({
      outcomeReached: 'yes',
      guard,
      projectId,
      reportId,
      registrySha256: expectedRegistryHash,
      bundleSha256: sha256(zipPath),
      oregonStatuses,
      puertoRicoStatuses,
      restoredTo: 'unidentified',
      consoleProblems,
      failedResponses,
      artifacts,
    }, null, 2));
  } finally {
    if (!restored) {
      try {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${baseUrl}/projects/${projectId}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Can OpenPlan do this here?' }).waitFor({ timeout: 120_000 });
        await clearProjectPlace(page);
        console.error('Restored the project to its original unidentified place after an interrupted proof.');
      } catch (restoreError) {
        console.error(`Could not restore the project after failure: ${restoreError instanceof Error ? restoreError.message : restoreError}`);
      }
    }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
