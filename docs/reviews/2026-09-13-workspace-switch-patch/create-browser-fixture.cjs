const {chromium, expect: baseExpect} = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const privateDir = '/home/nathaniel/.local/state/openplan/workspace-switch-v0581-evidence';
const base = 'http://localhost:3261';
const expect = baseExpect.configure({timeout: 45000});
const stamp = Date.now();
const owner = {email: `header-owner-${stamp}@openplan.test`, password: crypto.randomBytes(24).toString('base64url')+'aA1!', organization: 'SYNTHETIC invited regional planning workspace with a long name'};
const viewer = {email: `header-viewer-${stamp}@openplan.test`, password: crypto.randomBytes(24).toString('base64url')+'aA1!', organization: 'SYNTHETIC personal planning workspace'};
for (const [role, account] of Object.entries({owner, viewer})) {
  const file = `${privateDir}/${role}-account.json`;
  if (fs.existsSync(file)) throw Error('Existing fixture credentials must be retained; inspect them before creating another fixture.');
  fs.writeFileSync(file, JSON.stringify(account), {mode: 0o600});
}
async function signIn(page, account) {
  await page.getByLabel('Work email', {exact: true}).fill(account.email);
  await page.getByLabel('Password', {exact: true}).fill(account.password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.waitForURL(url => !url.pathname.includes('sign-in'));
}
async function signUp(page, account) {
  await page.getByLabel('Organization', {exact: true}).fill(account.organization);
  await page.getByLabel('Work email', {exact: true}).fill(account.email);
  await page.getByLabel('Password', {exact: true}).fill(account.password);
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  await page.waitForURL(url => !url.pathname.includes('sign-up'));
  if (new URL(page.url()).pathname.includes('sign-in')) await signIn(page, account);
}
(async () => {
  fs.writeFileSync(privateDir+'/fixture-identity.log', execFileSync('bash', [root+'/openplan/scripts/ops/which-openplan.sh', base], {cwd: root}));
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const staff = await (await browser.newContext({viewport: {width: 1440, height: 1000}})).newPage();
  const page = await (await browser.newContext({viewport: {width: 1440, height: 1000}})).newPage();
  for (const p of [staff, page]) p.setDefaultTimeout(60000);
  try {
    await staff.goto(base);
    await staff.getByRole('link', {name: /Sign in/i}).first().click();
    await staff.getByRole('link', {name: 'Create an account', exact: true}).click();
    await signUp(staff, owner);
    await staff.waitForURL('**/dashboard');
    await staff.getByRole('link', {name: 'Workspace setup & health', exact: true}).click();
    const team = staff.locator('#workspace-team');
    await team.getByLabel('Work email', {exact: true}).fill(viewer.email);
    await team.getByLabel('Role', {exact: true}).selectOption('viewer');
    const received = staff.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/workspaces/invitations'));
    await team.getByRole('button', {name: 'Create invitation', exact: true}).click();
    const response = await received;
    expect(response.status()).toBe(201);
    const invitation = await response.json();
    expect(invitation.role).toBe('viewer');
    expect(invitation.delivery).toBe('manual');
    expect(new URL(invitation.invitationUrl).origin).toBe(base);
    await page.goto(invitation.invitationUrl);
    if (!new URL(page.url()).pathname.includes('sign-up')) await page.getByRole('link', {name: 'Create an account', exact: true}).click();
    await signUp(page, viewer);
    await expect(page.getByRole('button', {name: 'Accept and join', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Accept and join', exact: true}).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('banner').getByRole('button', {name: owner.organization, exact: true})).toBeVisible();
    await page.screenshot({path: privateDir+'/fixture-accepted.png'});
    fs.writeFileSync(privateDir+'/fixture-result.json', JSON.stringify({passed: true, workspaceId: invitation.workspaceId, method: 'Owner signup, manual viewer invitation, viewer signup and explicit keyboard acceptance through real navigation. No direct fixture writes or external delivery.'}, null, 2));
    console.log('Fresh owner and viewer fixture accepted through the app.');
  } catch (error) {
    for (const [role, p] of [['owner', staff], ['viewer', page]]) {
      await p.screenshot({path: `${privateDir}/fixture-${role}-failure.png`});
      fs.writeFileSync(`${privateDir}/fixture-${role}-failure.txt`, await p.locator('body').ariaSnapshot());
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message.replaceAll(owner.password, '[redacted]').replaceAll(viewer.password, '[redacted]')); process.exitCode = 1; });
