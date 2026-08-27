const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const {
  buildBrowserContextOptions,
  getOutputDir,
  guardLocalMutationTargets,
  loadEnv,
} = require('./harness-env');
const {
  assertOk,
  buildRunIdentity,
  createAppFetch,
  createQaAuthUser,
  jsonFetch,
  signInThroughBrowser,
} = require('./fixtures/provision');

const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3200';
const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);

function expectStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} returned ${result.status}: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function visibleProjectEntry(page, projectName) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  const projectsLink = page.getByRole('link', { name: 'Projects', exact: true });
  if (await projectsLink.count() === 0) {
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1_000);
    throw new Error(`Dashboard did not expose the Projects link at ${page.url()}. Visible text: ${bodyText}`);
  }
  await projectsLink.click();
  await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 20_000 });
  await page.getByRole('link', { name: projectName, exact: false }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+/, { timeout: 20_000 });
  const evidenceLink = page.locator('[data-page-tab="evidence"]:visible').last();
  try {
    await evidenceLink.waitFor({ timeout: 60_000 });
  } catch {
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1_500);
    throw new Error(`Project page did not expose its Evidence tab at ${page.url()}. Visible text: ${bodyText}`);
  }
  await evidenceLink.click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\?tab=evidence/, { timeout: 30_000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('p:visible').filter({ hasText: /^Frozen project handoff$/ }).waitFor({ timeout: 20_000 });
}

async function visibleMyWorkEntry(page, title) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'My Work', exact: true }).click();
  await page.waitForURL(/\/my-work/, { timeout: 20_000 });
  const link = page.getByRole('link', { name: title, exact: true }).first();
  await link.waitFor({ timeout: 20_000 });
  await link.click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+#project-decision-packages/, { timeout: 30_000 });
  const evidenceLink = page.locator('[data-page-tab="evidence"]:visible').last();
  await evidenceLink.waitFor({ timeout: 60_000 });
  await evidenceLink.click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\?tab=evidence/, { timeout: 30_000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('p:visible').filter({ hasText: /^Agency decision handoff$/ }).waitFor({ timeout: 60_000 });
}

async function freezeThroughVisibleReview(page, planTitle) {
  await page.getByRole('button', { name: 'Prepare evidence bundle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review project evidence bundle' });
  await dialog.waitFor({ timeout: 20_000 });
  await page.keyboard.press('Tab');
  const focusStayedInDialog = await dialog.evaluate((node) => node.contains(document.activeElement));
  assertOk(focusStayedInDialog, 'Keyboard focus escaped the evidence review dialog.');
  await dialog.getByLabel('Linked plan').selectOption({ label: `${planTitle} · active` });
  const reportCheck = dialog.getByLabel(/Include .*board.*packet/i);
  assertOk(await reportCheck.count() === 1, 'The visible review did not expose exactly one current board/report PDF.');
  if (!(await reportCheck.isChecked())) await reportCheck.check();
  await dialog.getByLabel(/I reviewed this exact selection/i).check();
  await dialog.getByRole('button', { name: 'Freeze evidence bundle', exact: true }).click();
  await dialog.getByRole('link', { name: 'Download frozen bundle', exact: true }).waitFor({ timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Assigned approver').first().waitFor({ timeout: 20_000 });
  await page.getByText('Agency decision handoff', { exact: true }).waitFor({ timeout: 20_000 });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assertOk(supabaseUrl && serviceRoleKey, 'Missing local Supabase environment keys.');
  const guard = guardLocalMutationTargets({
    appUrl: baseUrl,
    supabaseUrl,
    scriptName: 'local governed decision handoff smoke',
  });

  const creatorIdentity = buildRunIdentity('decision-creator');
  const approverIdentity = buildRunIdentity('decision-approver');
  const creatorId = await createQaAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email: creatorIdentity.email,
    password: creatorIdentity.password,
    purpose: 'local-governed-decision-handoff-creator',
  });
  const approverId = await createQaAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email: approverIdentity.email,
    password: approverIdentity.password,
    purpose: 'local-governed-decision-handoff-approver',
  });

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--renderer-process-limit=4',
      '--js-flags=--max-old-space-size=1024',
    ],
  });
  const creatorContext = await browser.newContext(buildBrowserContextOptions({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }));
  const approverContext = await browser.newContext(buildBrowserContextOptions({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }));
  const creatorPage = await creatorContext.newPage();
  const approverPage = await approverContext.newPage();
  const consoleProblems = [];
  for (const page of [creatorPage, approverPage]) {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleProblems.push(message.text());
    });
    page.on('pageerror', (error) => consoleProblems.push(error.message));
  }

  const suffix = creatorIdentity.suffix;
  const projectName = `California small-agency handoff ${suffix}`;
  const planTitle = `Small agency mobility plan ${suffix}`;
  const reportTitle = `Current board packet ${suffix}`;
  const artifacts = [];
  const ids = { creatorId, approverId };

  async function screenshot(page, name, fullPage = true) {
    const file = path.join(outputDir, `${datePart}-${name}.png`);
    await page.screenshot({ path: file, fullPage });
    artifacts.push(path.relative(path.resolve(__dirname, '..'), file));
  }

  try {
    await signInThroughBrowser(creatorPage, {
      baseUrl,
      email: creatorIdentity.email,
      password: creatorIdentity.password,
    });
    const creatorFetch = createAppFetch(creatorPage);

    const project = expectStatus(await creatorFetch('/api/projects', {
      projectName,
      plan: 'pilot',
      planType: 'active_transportation_plan',
      deliveryPhase: 'scoping',
      status: 'active',
      summary: 'Synthetic local QA record for a governed California small-agency handoff.',
    }), 201, 'Project creation');
    ids.projectId = project.projectRecordId;
    ids.workspaceId = project.workspaceId;

    const plan = expectStatus(await creatorFetch('/api/plans', {
      projectId: ids.projectId,
      title: planTitle,
      planType: 'atp',
      status: 'active',
      geographyLabel: 'California small-agency QA geography',
      horizonYear: 2045,
      summary: 'Synthetic current plan record for local governed-handoff proof.',
    }), 201, 'Linked plan creation');
    ids.planId = plan.planId;

    const report = expectStatus(await creatorFetch('/api/reports', {
      projectId: ids.projectId,
      title: reportTitle,
      reportType: 'board_packet',
      summary: 'Synthetic current board packet for local governed-handoff proof.',
    }), 201, 'Report creation');
    ids.reportId = report.reportId;
    const generated = await creatorFetch(`/api/reports/${ids.reportId}/generate`, { format: 'pdf' });
    expectStatus(generated, 200, 'Report PDF generation');

    const invitation = expectStatus(await creatorFetch('/api/workspaces/invitations', {
      workspaceId: ids.workspaceId,
      email: approverIdentity.email,
      role: 'admin',
    }), 201, 'Approver invitation');
    const invitationPathParts = new URL(invitation.invitationUrl).pathname.split('/').filter(Boolean);
    const token = invitationPathParts[0] === 'invitations'
      ? decodeURIComponent(invitationPathParts[1] || '')
      : null;
    assertOk(token, 'Invitation response did not contain its one-time token.');

    await signInThroughBrowser(approverPage, {
      baseUrl,
      email: approverIdentity.email,
      password: approverIdentity.password,
    });
    const approverFetch = createAppFetch(approverPage);
    expectStatus(await approverFetch('/api/workspaces/invitations/accept', { token }), 200, 'Invitation acceptance');

    await visibleProjectEntry(creatorPage, projectName);
    await freezeThroughVisibleReview(creatorPage, planTitle);
    await screenshot(creatorPage, 'governed-handoff-01-frozen-desktop');

    const approverSelect = creatorPage.getByLabel('Assigned approver').first();
    await approverSelect.selectOption(approverId);
    await creatorPage.getByRole('button', { name: 'Submit exact bundle', exact: true }).click();
    await creatorPage.getByText('Pending assigned approver.', { exact: true }).waitFor({ timeout: 20_000 });
    await screenshot(creatorPage, 'governed-handoff-02-submitted-desktop');

    await visibleMyWorkEntry(approverPage, 'Review submitted decision package');
    await approverPage.getByLabel('Return reason').fill('Clarify the board packet limits before approval.');
    await approverPage.getByRole('button', { name: 'Return with reason', exact: true }).click();
    await approverPage.getByText(/returned.*Clarify the board packet limits/i).waitFor({ timeout: 20_000 });
    await screenshot(approverPage, 'governed-handoff-03-returned-desktop');

    await visibleMyWorkEntry(creatorPage, 'Replace returned decision package');
    await freezeThroughVisibleReview(creatorPage, planTitle);
    await creatorPage.getByLabel('Assigned approver').first().selectOption(approverId);
    await creatorPage.getByRole('button', { name: 'Submit replacement bundle', exact: true }).click();
    await creatorPage.getByText('Pending assigned approver.', { exact: true }).last().waitFor({ timeout: 20_000 });

    await visibleMyWorkEntry(approverPage, 'Review submitted decision package');
    await approverPage.getByRole('button', { name: 'Approve exact bundle', exact: true }).click();
    const approvedReceipt = approverPage.locator('#project-decision-packages p').filter({ hasText: /approved · receipt /i }).last();
    await approvedReceipt.waitFor({ timeout: 20_000 });
    await approvedReceipt.scrollIntoViewIfNeeded();
    await screenshot(approverPage, 'governed-handoff-04-approved-desktop');

    await approverPage.setViewportSize({ width: 390, height: 844 });
    await approverPage.reload({ waitUntil: 'networkidle' });
    await approverPage.locator('[data-page-tab="evidence"]:visible').last().click();
    await approverPage.waitForURL(/\/projects\/[0-9a-f-]+\?tab=evidence/, { timeout: 30_000 });
    await approverPage.reload({ waitUntil: 'networkidle' });
    await approverPage.locator('p:visible').filter({ hasText: /^Agency decision handoff$/ }).waitFor({ timeout: 20_000 });
    const mobileApprovedReceipt = approverPage.locator('#project-decision-packages p').filter({ hasText: /approved · receipt /i }).last();
    await mobileApprovedReceipt.waitFor({ timeout: 20_000 });
    await mobileApprovedReceipt.scrollIntoViewIfNeeded();
    assertOk(await mobileApprovedReceipt.isVisible(), 'Approved receipt is not visible at 390px.');
    await screenshot(approverPage, 'governed-handoff-05-approved-390px');

    await approverPage.emulateMedia({ media: 'print' });
    const printPdf = path.join(outputDir, `${datePart}-governed-handoff-print.pdf`);
    await approverPage.pdf({ path: printPdf, format: 'Letter', printBackground: true });
    artifacts.push(path.relative(path.resolve(__dirname, '..'), printPdf));
    await approverPage.emulateMedia({ media: 'screen' });

    const bundleDownloadEvent = approverPage.waitForEvent('download');
    await approverPage.locator('#project-decision-packages a[href*="/evidence-bundles/"]').first().click();
    const bundleDownload = await bundleDownloadEvent;
    const bundlePath = path.join(outputDir, `${datePart}-governed-approved-bundle.zip`);
    await bundleDownload.saveAs(bundlePath);
    artifacts.push(path.relative(path.resolve(__dirname, '..'), bundlePath));

    const receiptDownloadEvent = approverPage.waitForEvent('download');
    await approverPage.getByRole('link', { name: 'Download receipt', exact: true }).last().click();
    const receiptDownload = await receiptDownloadEvent;
    const receiptPath = path.join(outputDir, `${datePart}-governed-approval-receipt.json`);
    await receiptDownload.saveAs(receiptPath);
    artifacts.push(path.relative(path.resolve(__dirname, '..'), receiptPath));

    const extracted = path.join(outputDir, `${datePart}-governed-approved-bundle`);
    fs.mkdirSync(extracted, { recursive: true });
    execFileSync('unzip', ['-o', '-q', bundlePath, '-d', extracted], { stdio: 'inherit' });
    execFileSync('sha256sum', ['-c', 'checksums.sha256'], { cwd: extracted, stdio: 'inherit' });
    execFileSync('jq', ['-e', '.schemaVersion == "project_evidence_manifest.v2" and .approvalOrPublication == false', 'manifest.json'], { cwd: extracted, stdio: 'inherit' });
    const layerListing = execFileSync('ogrinfo', ['-ro', 'project/project.gpkg'], {
      cwd: extracted,
      encoding: 'utf8',
    });
    const layerNames = [...layerListing.matchAll(/^\d+:\s+([^\s(]+)/gm)].map((match) => match[1]);
    assertOk(layerNames.length > 0, 'The downloaded GeoPackage did not expose any layers.');
    for (const layerName of layerNames) {
      execFileSync('ogrinfo', ['-ro', '-so', 'project/project.gpkg', layerName], {
        cwd: extracted,
        stdio: 'inherit',
      });
    }
    let privateTextHits = '';
    try {
      privateTextHits = execFileSync('rg', [
        '-n',
        '-i',
        'email|phone|participant|respondent|submitted_by|assigned_approver|decision-creator|decision-approver|@example',
        '.',
        '--glob',
        '*.json',
        '--glob',
        '*.txt',
      ], { cwd: extracted, encoding: 'utf8' });
    } catch (error) {
      if (!error || typeof error !== 'object' || error.status !== 1) throw error;
    }
    assertOk(privateTextHits.trim() === '', `Private or personal text entered the bundle: ${privateTextHits}`);
    const receiptJson = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assertOk(receiptJson.approvalOrPublication === false, 'Receipt incorrectly asserts approval or publication.');
    assertOk(receiptJson.statutoryAdoption === false, 'Receipt incorrectly asserts statutory adoption.');
    assertOk(receiptJson.modelValidation === false, 'Receipt incorrectly asserts model validation.');
    assertOk(/^[0-9a-f]{64}$/.test(receiptJson.bundleSha256), 'Receipt does not carry an exact bundle SHA-256.');
    assertOk(consoleProblems.length === 0, `Browser console reported: ${consoleProblems.join(' | ')}`);

    const reportPath = path.join(path.resolve(__dirname, '..'), `docs/ops/${datePart}-governed-decision-handoff-browser-proof.md`);
    fs.writeFileSync(reportPath, [
      `# Governed decision handoff browser proof - ${datePart}`,
      '',
      `- ${guard}`,
      `- Project: ${projectName} (${ids.projectId})`,
      '- outcomeReached: "yes"',
      '- Desktop and 390px paths passed through Projects, Evidence, My Work, return, replacement, approval, bundle download, and receipt download.',
      '- The approved downloaded ZIP passed sha256sum, jq, and ogrinfo. The receipt retained false publication, adoption, and model-validation flags.',
      '- Browser console and uncaught page errors: none.',
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
    ].join('\n'));
    console.log(JSON.stringify({ outcomeReached: 'yes', reportPath, artifacts, ids }, null, 2));
  } catch (error) {
    const detail = consoleProblems.length > 0 ? ` Browser console: ${consoleProblems.join(' | ')}` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${detail}`);
  } finally {
    await creatorPage.close().catch(() => {});
    await approverPage.close().catch(() => {});
    await creatorContext.close().catch(() => {});
    await approverContext.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
