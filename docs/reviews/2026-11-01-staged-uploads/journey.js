/**
 * Browser journey for PR 391: aerial photos and Knowledge Base documents
 * uploaded through signed Storage URLs (KI-2026-10-12-017).
 *
 * Runs against a LOCAL dev server and a LOCAL Supabase stack only. It refuses
 * any base URL or API URL that is not loopback. It signs up through the real
 * form, creates a project and a mission through the app's own controls,
 * uploads files through the page's file inputs, then checks each stored row
 * and object through the service role and each download through the signed-in
 * session (sha256 of the bytes served against the file chosen).
 *
 * Usage (from qa-harness/, which has playwright):
 *   OPENPLAN_JOURNEY_BASE_URL=http://localhost:3210 \
 *   OPENPLAN_JOURNEY_API_URL=http://127.0.0.1:55321 \
 *   OPENPLAN_JOURNEY_SERVICE_KEY=<local service role key, never printed> \
 *   OPENPLAN_JOURNEY_FIXTURES=<dir with the generated files> \
 *   OPENPLAN_JOURNEY_OUT=<dir for screenshots and results.json> \
 *   node ../docs/reviews/2026-11-01-staged-uploads/journey.js
 *
 * Fixtures are generated, not checked in: make_pdf.py (a real PDF with a text
 * line and an uncompressed RGB image) and ImageMagick plasma JPEGs. See
 * STATUS.md for the exact commands and hashes.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.resolve(process.cwd(), "node_modules/playwright"));

const BASE = process.env.OPENPLAN_JOURNEY_BASE_URL;
const API = process.env.OPENPLAN_JOURNEY_API_URL;
const SERVICE_KEY = process.env.OPENPLAN_JOURNEY_SERVICE_KEY;
const FIXTURES = process.env.OPENPLAN_JOURNEY_FIXTURES;
const OUT = process.env.OPENPLAN_JOURNEY_OUT;

for (const [name, value] of Object.entries({ BASE, API, SERVICE_KEY, FIXTURES, OUT })) {
  if (!value) throw new Error(`Missing ${name}`);
}
for (const url of [BASE, API]) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`Refusing non-local target ${url}`);
}
fs.mkdirSync(OUT, { recursive: true });

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fixture = (name) => path.join(FIXTURES, name);
const fixtureSha = (name) => sha256(fs.readFileSync(fixture(name)));
const results = { startedAt: new Date().toISOString(), base: BASE, steps: [], network: [], console: [] };

/** Never keep a token: signed URLs carry it in the query string. */
function scrubUrl(raw) {
  const url = new URL(raw);
  return `${url.origin}${url.pathname}${url.search ? "?<query withheld>" : ""}`;
}
function scrubText(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt withheld>")
    .replace(/token=[^&\s"']+/g, "token=<withheld>")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "<key withheld>");
}

async function service(pathname, init = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function listStaged(bucket, workspaceId) {
  // Storage's list API names one folder level at a time.
  const users = await service(`/storage/v1/object/list/${bucket}`, {
    method: "POST",
    body: JSON.stringify({ prefix: `${workspaceId}/staged/`, limit: 1000 }),
  });
  const found = [];
  for (const entry of Array.isArray(users.body) ? users.body : []) {
    const inner = await service(`/storage/v1/object/list/${bucket}`, {
      method: "POST",
      body: JSON.stringify({ prefix: `${workspaceId}/staged/${entry.name}/`, limit: 1000 }),
    });
    for (const object of Array.isArray(inner.body) ? inner.body : []) found.push(`${entry.name}/${object.name}`);
  }
  return { listStatus: users.status, objects: found };
}

function record(step, data) {
  results.steps.push({ step, at: new Date().toISOString(), ...data });
  console.log(`[${step}]`, JSON.stringify(data));
}

function watch(page, label) {
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      results.console.push({ viewport: label, type: message.type(), text: scrubText(message.text()).slice(0, 400) });
    }
  });
  page.on("pageerror", (error) => results.console.push({ viewport: label, type: "pageerror", text: scrubText(error.message).slice(0, 400) }));
  page.on("requestfinished", async (request) => {
    const url = request.url();
    if (!/\/upload\/(start|complete)$|\/object\/upload\/sign\//.test(new URL(url).pathname)) return;
    const response = await request.response();
    const body = request.postDataBuffer();
    let requestJson = null;
    if (body && /\/upload\/(start|complete)$/.test(new URL(url).pathname)) {
      try {
        requestJson = JSON.parse(body.toString("utf8"));
      } catch {
        requestJson = null;
      }
    }
    let responseJson = null;
    if (response && /\/upload\/(start|complete)$/.test(new URL(url).pathname)) {
      try {
        responseJson = await response.json();
        if (responseJson && responseJson.uploadUrl) responseJson.uploadUrl = scrubUrl(responseJson.uploadUrl);
      } catch {
        responseJson = null;
      }
    }
    results.network.push({
      viewport: label,
      method: request.method(),
      url: scrubUrl(url),
      status: response ? response.status() : null,
      requestBytes: body ? body.byteLength : 0,
      request: requestJson,
      response: responseJson,
    });
  });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  // Dev mode compiles on first visit; let the page settle before capturing it.
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => undefined);
  await page.screenshot({ path: file, fullPage: false });
  return path.basename(file);
}

async function downloadSha(page, url) {
  const response = await page.request.get(`${BASE}${url}`, { maxRedirects: 5, timeout: 120000 });
  const bytes = await response.body();
  return { status: response.status(), bytes: bytes.byteLength, sha256: sha256(bytes), servedHeaderSha: response.headers()["x-openplan-file-sha256"] ?? null };
}

async function waitForKbRow(workspaceId, title) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await service(
      `/rest/v1/kb_documents?select=id,title,byte_size,checksum,status,source_kind,content_type,storage_ref,project_id&workspace_id=eq.${workspaceId}&title=eq.${encodeURIComponent(title)}`
    );
    if (Array.isArray(rows.body) && rows.body.length) return rows.body;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return [];
}

async function uploadKb(page, workspaceId, file, label) {
  const title = path.basename(file, path.extname(file));
  await page.locator('input[type="file"][aria-label="Upload a file"]').setInputFiles(fixture(file));
  // The notice names the file's title on success; a refusal shows as an alert.
  const settled = page.locator(".module-note", { hasText: title }).or(page.locator("p.bg-red-50")).first();
  await settled.waitFor({ timeout: 180000 });
  const notice = scrubText(await settled.innerText());
  const rows = await waitForKbRow(workspaceId, title);
  const row = rows[0] ?? null;
  const download = row ? await downloadSha(page, `/api/knowledge-base/documents/${row.id}/download`) : null;
  const expected = fixtureSha(file);
  record(`kb-upload ${label}`, {
    file,
    fixtureBytes: fs.statSync(fixture(file)).size,
    notice,
    row,
    rowsWithThisTitle: rows.length,
    download,
    checksumMatches: row?.checksum === expected,
    downloadMatches: download?.sha256 === expected,
    screenshot: await shot(page, `kb-${label}`),
  });
  return row;
}

async function uploadAerial(page, missionId, file, label) {
  // Photos live under the mission page's Photos tab; a closed tab stays in the
  // DOM, hidden. Use the input behind the "Upload photos" label a planner can
  // see, and count the panel copies so the evidence shows there was one.
  const labels = page.locator(`label[for="aerial-imagery-upload-${missionId}"]`);
  const panelCopies = await labels.count();
  const visibleLabel = labels.filter({ visible: true }).first();
  const input = visibleLabel.locator("xpath=preceding-sibling::input[1]");
  await input.setInputFiles(fixture(file));
  const outcome = page.locator("ul li", { hasText: `${file}:` }).filter({ visible: true }).first();
  await outcome.waitFor({ timeout: 180000 });
  const text = scrubText(await outcome.innerText());
  const rows = await service(
    `/rest/v1/aerial_imagery?select=id,original_filename,byte_size,checksum_sha256,content_type,storage_path&mission_id=eq.${missionId}&original_filename=eq.${encodeURIComponent(file)}`
  );
  const row = Array.isArray(rows.body) ? rows.body[0] ?? null : null;
  const download = row ? await downloadSha(page, `/api/aerial/missions/${missionId}/imagery/${row.id}/download`) : null;
  const expected = fixtureSha(file);
  record(`aerial-upload ${label}`, {
    file,
    fixtureBytes: fs.statSync(fixture(file)).size,
    outcome: text,
    panelCopies,
    row,
    download,
    checksumMatches: row ? row.checksum_sha256 === expected : null,
    downloadMatches: download ? download.sha256 === expected : null,
    screenshot: await shot(page, `aerial-${label}`),
  });
  return row;
}

async function clickNav(page, name) {
  const link = page.getByRole("link", { name, exact: true }).first();
  await link.click();
  // The rail expands while the pointer rests on it; a planner moves on to the page.
  const viewport = page.viewportSize();
  await page.mouse.move(Math.round(viewport.width * 0.6), Math.round(viewport.height * 0.5));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const email = `staged-journey-${Date.now()}@example.test`;
  const password = `Journey-${crypto.randomBytes(6).toString("hex")}`;
  try {
    // ---------------- Desktop 1440 ----------------
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktop.newPage();
    watch(page, "desktop-1440");

    const health = await (await fetch(`${BASE}/api/health`)).json();
    record("identity", { health: { status: health.status, deployment: health.deployment } });

    await page.goto(`${BASE}/sign-up`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Organization").fill("Staged Upload Journey Agency");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 120000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const users = await service(`/auth/v1/admin/users?per_page=200`);
    const user = (users.body?.users ?? []).find((candidate) => candidate.email === email);
    const memberships = await service(`/rest/v1/workspace_members?select=workspace_id,role&user_id=eq.${user?.id}`);
    const workspaceId = memberships.body?.[0]?.workspace_id;
    record("signed-up", { url: scrubUrl(page.url()), workspaceRole: memberships.body?.[0]?.role, workspaceFound: Boolean(workspaceId), screenshot: await shot(page, "01-dashboard") });
    if (!workspaceId) throw new Error("No workspace after sign-up");

    await clickNav(page, "Projects");
    await page.waitForURL(/\/projects/, { timeout: 60000 });
    await page.getByTestId("project-workspace-creator-open").click();
    await page.getByLabel("Project name").fill("Staged upload journey corridor");
    const projectFlow = page.getByTestId("guided-flow-create-project");
    await projectFlow.getByRole("button", { name: "Next", exact: true }).click();
    await projectFlow.getByRole("button", { name: "Start the project", exact: true }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 120000 });
    const projectId = page.url().match(/\/projects\/([0-9a-f-]{36})/)[1];
    record("project-created", { projectId, screenshot: await shot(page, "02-project") });

    // (1) and (3) Knowledge Base
    await clickNav(page, "Documents");
    await page.waitForURL(/\/knowledge-base/, { timeout: 60000 });
    await page.locator('input[type="file"][aria-label="Upload a file"]').waitFor({ state: "attached", timeout: 60000 });
    await uploadKb(page, workspaceId, "large-rtp-exhibit.pdf", "large-pdf");
    await uploadKb(page, workspaceId, "small-staff-report.pdf", "small-pdf");

    // (4) refused: a type neither accept list names. Refused at start, no URL.
    await page.locator('input[type="file"][aria-label="Upload a file"]').setInputFiles(fixture("model-runner.exe"));
    // The Documents page renders its refusal as a red paragraph (no role="alert").
    const refusal = page.getByText("Unsupported document type", { exact: false }).first();
    await refusal.waitFor({ timeout: 60000 });
    record("kb-refused wrong-type", {
      message: scrubText(await refusal.innerText()),
      staged: await listStaged("kb-documents", workspaceId),
      screenshot: await shot(page, "kb-refused-wrong-type"),
    });

    // (2) and (3) Aerial
    await clickNav(page, "Aerial Imagery");
    await page.waitForURL(/\/aerial/, { timeout: 60000 });
    record("aerial-page", { screenshot: await shot(page, "03-aerial") });
    // Every mission belongs to a project: pick it in the launcher, then log the mission.
    await page.locator("#aerial-mission-launcher-project").selectOption({ label: "Staged upload journey corridor" });
    await page.getByTestId("aerial-mission-creator-open").click();
    const missionFlow = page.getByRole("dialog");
    await missionFlow.getByLabel("Mission name").fill("Staged upload journey flight");
    record("mission-dialog", { screenshot: await shot(page, "04-mission-dialog") });
    await missionFlow.getByRole("button", { name: "Next", exact: true }).click();
    await missionFlow.getByRole("button", { name: "Log the mission", exact: true }).click();
    await page.getByTestId("aerial-mission-logged").waitFor({ timeout: 120000 });
    // The page lists the new mission; open it from that list.
    await page.getByRole("link", { name: /Staged upload journey flight/ }).first().click();
    await page.waitForURL(/\/aerial\/missions\/[0-9a-f-]{36}/, { timeout: 120000 });
    const missionId = page.url().match(/\/aerial\/missions\/([0-9a-f-]{36})/)[1];
    await page.locator(`#aerial-imagery-upload-${missionId}`).waitFor({ state: "attached", timeout: 60000 });
    record("mission-created", { missionId, screenshot: await shot(page, "05-mission") });
    // Photos sit under their own tab on the mission page.
    await page.getByTestId("page-tabs-nav").getByRole("link", { name: /^Photos/ }).click();
    record("photos-tab", { screenshot: await shot(page, "06-photos-tab") });

    await uploadAerial(page, missionId, "large-mission-frame.jpg", "large-jpeg");
    await uploadAerial(page, missionId, "small-mission-frame.jpg", "small-jpeg");

    // (4) refused after staging: a .jpg name whose bytes are not an image.
    // The PUT succeeds, complete sniffs the bytes, refuses, and removes the object.
    await uploadAerial(page, missionId, "not-a-photo.jpg", "refused-not-a-photo");
    record("aerial-refused staged listing", { staged: await listStaged("aerial-imagery", workspaceId) });

    // ---------------- 390 px ----------------
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const phone = await mobile.newPage();
    watch(phone, "mobile-390");
    await phone.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await phone.getByLabel(/email/i).fill(email);
    await phone.getByLabel("Password").fill(password);
    await phone.getByRole("button", { name: /Sign in/ }).click();
    await phone.waitForURL(/\/dashboard/, { timeout: 120000 });
    record("mobile-signed-in", { screenshot: await shot(phone, "m01-dashboard") });

    await phone.goto(`${BASE}/knowledge-base`, { waitUntil: "domcontentloaded" });
    await phone.locator('input[type="file"][aria-label="Upload a file"]').waitFor({ state: "attached", timeout: 60000 });
    await uploadKb(phone, workspaceId, "large-rtp-exhibit-390.pdf", "m-large-pdf");

    await phone.goto(`${BASE}/aerial/missions/${missionId}`, { waitUntil: "domcontentloaded" });
    await phone.locator(`#aerial-imagery-upload-${missionId}`).waitFor({ state: "attached", timeout: 60000 });
    await phone.getByTestId("page-tabs-nav").getByRole("link", { name: /^Photos/ }).click();
    await uploadAerial(phone, missionId, "large-mission-frame-390.jpg", "m-large-jpeg");

    record("final staged listing", {
      kb: await listStaged("kb-documents", workspaceId),
      aerial: await listStaged("aerial-imagery", workspaceId),
    });
  } catch (error) {
    record("error", { message: scrubText(error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 2000) });
    process.exitCode = 1;
  } finally {
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    await browser.close();
  }
})();
