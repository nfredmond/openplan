// One map package run on the planner's computer: claim, prepare the run folder,
// run Claude Code with the skill, then hand the finished package to OpenPlan.
//
// The model never runs twice for one package. A connector that stops while the
// agent is working reports the run as stopped and leaves the folder in place.
// Once the agent has finished and the package is found, only the upload may be
// repeated, from the journal in the run folder.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ConnectorError } from "./connector-client.mjs";
import { claudeAccountSummary } from "./claude-process.mjs";
import {
  claudeMapArgs, claudeMapEnv, claudeMapSettings, claudeVersionAtLeast, foldClaudeMapEvent, initialClaudeMapState, parseClaudeVersion,
} from "./map-package-claude.mjs";
import { mapConnectorRequest, putMapPackageFile } from "./map-package-client.mjs";
import { buildSkillManifest, MAP_PACKAGE_SKILL_NAME, MAP_PACKAGE_SKILL_ROOT, verifiedSkillManifest } from "./map-package-skill.mjs";

export const MAP_RUN_JOURNAL = "openplan_run.json";
export const MAP_RUN_HEARTBEAT_MS = 60_000;
export const MAP_RUN_MAX_MS = 12 * 60 * 60 * 1000;
const SESSION_LOG_LIMIT = 256 * 1024 * 1024;
const ALLOWED_MODEL = "claude-fable-5-1";

export function defaultMapRunsRoot() {
  return join(homedir(), "OpenPlan Map Packages");
}

function safeFolderName(title, packageId) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "map-package";
  return `${slug}-${packageId.slice(0, 8)}`;
}

async function writePrivateJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}

export async function readMapRunJournal(runDir) {
  try { return JSON.parse(await readFile(join(runDir, MAP_RUN_JOURNAL), "utf8")); } catch { return null; }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}

/** The claimed package, checked against what this checkout can run. */
export async function checkedMapClaim(job, { skillRoot = MAP_PACKAGE_SKILL_ROOT } = {}) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!job || typeof job !== "object" || ![job.id, job.attemptId, job.workspaceId, job.projectId].every(value => uuid.test(value ?? ""))) {
    throw new ConnectorError("map_claim_invalid");
  }
  if (job.provider !== "claude" || job.authMode !== "claude_subscription" || job.model !== ALLOWED_MODEL || job.effort !== "high") {
    throw new ConnectorError("map_package_runner_refused");
  }
  if (typeof job.briefCanonical !== "string" || createHash("sha256").update(job.briefCanonical, "utf8").digest("hex") !== job.briefHash) {
    throw new ConnectorError("map_brief_mismatch");
  }
  if (typeof job.prompt !== "string" || !job.prompt.trim() || job.prompt.length > 20_000) throw new ConnectorError("map_claim_invalid");
  const manifest = await verifiedSkillManifest(skillRoot, join(skillRoot, "..", "MANIFEST.json")).catch(() => { throw new ConnectorError("map_skill_manifest_mismatch"); });
  if (job.skill?.name !== MAP_PACKAGE_SKILL_NAME || job.skill?.treeHash !== manifest.treeHash) throw new ConnectorError("map_skill_version_mismatch");
  return { ...job, brief: JSON.parse(job.briefCanonical), skillTreeHash: manifest.treeHash };
}

/**
 * Write the run folder: the brief, the study area, and a working copy of the
 * skill packaged as a session plugin. The agent may extend its copy of the kit,
 * as the skill allows; the receipt says whether it did.
 */
export async function prepareMapRunFolder(job, runsRoot, { skillRoot = MAP_PACKAGE_SKILL_ROOT } = {}) {
  await mkdir(runsRoot, { recursive: true, mode: 0o700 });
  const runDir = join(runsRoot, safeFolderName(job.title, job.id));
  await mkdir(runDir, { mode: 0o700 }).catch(error => { if (error.code === "EEXIST") throw new ConnectorError("map_run_folder_exists"); throw error; });
  await writeFile(join(runDir, "openplan_brief.json"), `${JSON.stringify(job.brief, null, 2)}\n`, { mode: 0o600 });
  await mkdir(join(runDir, "inputs"), { mode: 0o700 });
  if (job.brief.studyArea?.features?.length) {
    await writeFile(join(runDir, "inputs", "openplan_study_area.geojson"), `${JSON.stringify(job.brief.studyArea)}\n`, { mode: 0o600 });
  }
  const pluginDir = join(runDir, "openplan-skill-plugin");
  await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true, mode: 0o700 });
  await writeFile(join(pluginDir, ".claude-plugin", "plugin.json"), `${JSON.stringify({
    name: "openplan-map-package", version: "1.0.0", description: "The transportation-gis skill for one OpenPlan map package run.",
  }, null, 2)}\n`, { mode: 0o600 });
  await cp(skillRoot, join(pluginDir, "skills", MAP_PACKAGE_SKILL_NAME), { recursive: true, errorOnExist: true, force: false });
  return { runDir, pluginDir, skillCopy: join(pluginDir, "skills", MAP_PACKAGE_SKILL_NAME) };
}

/** `claude auth status --json`, with the same nonidentifying summary Planner Agent uses. */
export async function claudeMapAccount({ binaryPath, providerHome, signal, spawnImpl = spawn }) {
  const run = args => new Promise((resolve, reject) => {
    const child = spawnImpl(binaryPath, args, { env: { HOME: homedir(), PATH: "/usr/bin:/bin", CLAUDE_CONFIG_DIR: providerHome, DISABLE_AUTOUPDATER: "1" }, stdio: ["ignore", "pipe", "ignore"], signal });
    const chunks = [];
    child.stdout.on("data", chunk => { if (chunks.reduce((sum, item) => sum + item.length, 0) < 64_000) chunks.push(chunk); });
    child.on("error", () => reject(new ConnectorError("native_process_unavailable")));
    child.on("close", code => resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") }));
  });
  const version = parseClaudeVersion((await run(["--version"])).stdout);
  if (!claudeVersionAtLeast(version)) throw new ConnectorError("map_claude_version_unsupported");
  const status = await run(["auth", "status", "--json"]);
  let raw;
  try { raw = JSON.parse(status.stdout); } catch { throw new ConnectorError("native_account_unreadable"); }
  return { ...claudeAccountSummary(raw), version: version.join(".") };
}

/** Find the package the kit built: the newest ZIP in gis/build with its folder beside it. */
export async function findBuiltPackage(runDir) {
  const buildDir = join(runDir, "gis", "build");
  let entries;
  try { entries = await readdir(buildDir, { withFileTypes: true }); } catch { return null; }
  const zips = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,155}_maps_\d{8}\.zip$/.test(entry.name)) continue;
    const zipPath = join(buildDir, entry.name);
    const folder = join(buildDir, entry.name.slice(0, -4));
    const folderInfo = await lstat(folder).catch(() => null);
    if (!folderInfo?.isDirectory() || folderInfo.isSymbolicLink()) continue;
    zips.push({ zipPath, folder, name: entry.name, mtime: (await stat(zipPath)).mtimeMs });
  }
  zips.sort((left, right) => right.mtime - left.mtime);
  return zips[0] ?? null;
}

async function readJsonIfPresent(path, maxBytes) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > maxBytes) return null;
    return JSON.parse(await readFile(path, "utf8"));
  } catch { return null; }
}

export const MAP_PREVIEW_MAX_PIXELS = 1600;
const DOWNSCALE_SCRIPT = [
  "import sys",
  "from PIL import Image",
  "image = Image.open(sys.argv[1])",
  "image.thumbnail((int(sys.argv[3]), int(sys.argv[3])))",
  "image.save(sys.argv[2], format='PNG', optimize=True)",
].join("\n");

/**
 * A page-sized copy of one figure, made with the Pillow the kit already needs.
 * Full figures run 3,000 to 5,000 pixels wide; the package keeps them, and the
 * app shows these. Returns null when Python or Pillow cannot make one.
 */
export function downscalePreview(source, target, { spawnImpl = spawn, maxPixels = MAP_PREVIEW_MAX_PIXELS } = {}) {
  return new Promise(resolve => {
    const child = spawnImpl("python3", ["-I", "-c", DOWNSCALE_SCRIPT, source, target, String(maxPixels)],
      { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: homedir() }, stdio: ["ignore", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", async code => {
      clearTimeout(timer);
      const info = code === 0 ? await lstat(target).catch(() => null) : null;
      resolve(info?.isFile() && info.size > 0 ? target : null);
    });
  });
}

/** What the package says about itself: QA counts, review gates and the figure list. */
export async function describeBuiltPackage(built, { previewDir = null, spawnImpl = spawn } = {}) {
  const qa = await readJsonIfPresent(join(built.folder, "qa", "qa_report.json"), 20_000_000);
  const review = await readJsonIfPresent(join(built.folder, "qa", "review.json"), 2_000_000);
  const spec = await readJsonIfPresent(join(built.folder, "spec", "map_package.json"), 50_000_000);
  const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  // The package's qa/review.json lists gates as [{gate, status, ...}]; the
  // project's own review.json keys them by name. Accept both.
  const gateEntries = Array.isArray(review?.gates)
    ? review.gates.map(item => [item?.gate, item?.status])
    : review?.gates && typeof review.gates === "object" ? Object.entries(review.gates).map(([name, gate]) => [name, gate?.status]) : null;
  const gates = gateEntries
    ? Object.fromEntries(gateEntries.filter(([name]) => typeof name === "string" && /^[a-z_]{1,40}$/.test(name))
      .map(([name, status]) => [name, String(status ?? "pending").slice(0, 40)]))
    : null;
  const figures = [];
  const previews = [];
  for (const map of Array.isArray(spec?.maps) ? spec.maps.slice(0, 200) : []) {
    const id = typeof map?.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(map.id) ? map.id : null;
    if (!id) continue;
    const png = join(built.folder, "maps", "png", `${id}.png`);
    const pngInfo = await lstat(png).catch(() => null);
    const preview = pngInfo?.isFile() && pngInfo.size <= 25 * 1024 * 1024 && previews.length < 60 ? `${id}.png` : null;
    if (preview) {
      const small = previewDir ? await downscalePreview(png, join(previewDir, preview), { spawnImpl }) : null;
      previews.push({ name: preview, path: small ?? png });
    }
    figures.push({
      id,
      figure: typeof map.figure === "string" ? map.figure.slice(0, 80) : null,
      title: typeof map.title === "string" ? map.title.slice(0, 300) : id,
      alt: typeof map.alt === "string" ? map.alt.slice(0, 1000) : null,
      preview,
    });
  }
  return {
    qa: qa ? { checks: count(qa.checks), passed: count(qa.passed), failed: count(qa.failed), notes: count(qa.notes) } : null,
    gates,
    figures,
    previews,
  };
}

export function normalizedModelsUsed(models) {
  return [...new Set((models ?? []).map(model => String(model).replace(/\[[^\]]*\]$/, "")))].sort();
}

/**
 * Run Claude Code until it stops. Progress goes to `onProgress`; a heartbeat
 * answer other than "running" stops the run. Returns the folded stream state
 * and how the process ended.
 */
export function runClaudeMapSession({ binaryPath, args, env, cwd, prompt, logPath, signal, onInit, onProgress, spawnImpl = spawn, maxMs = MAP_RUN_MAX_MS }) {
  return new Promise((resolve, reject) => {
    let state = initialClaudeMapState();
    let stop = null;
    let killTimer;
    const child = spawnImpl(binaryPath, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
    let logged = 0;
    const kill = reason => {
      if (stop) return;
      stop = reason;
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, 10_000);
    };
    const onAbort = () => kill("stopped");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => kill("timeout"), maxMs);
    let buffered = "";
    child.stdout.on("data", chunk => {
      if (logged < SESSION_LOG_LIMIT) { log.write(chunk); logged += chunk.length; }
      buffered += chunk.toString("utf8");
      if (buffered.length > 16 * 1024 * 1024) buffered = buffered.slice(-1024 * 1024);
      let index;
      while ((index = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        const before = state.init;
        state = foldClaudeMapEvent(state, event);
        onProgress?.(state);
        if (!before && state.init) {
          const verdict = onInit?.(state.init);
          if (verdict) kill(verdict);
        }
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new ConnectorError("native_process_unavailable")); });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", onAbort);
      log.end();
      resolve({ state, code, exitSignal, stop });
    });
    child.stdin.end(prompt);
  });
}

/** Upload a built package from its journal, then ask the app to measure and complete it. */
export async function deliverMapPackage(config, runDir, journal, { signal, fetchImpl, put = putMapPackageFile, report = () => {} }) {
  const ids = { packageId: journal.packageId, attemptId: journal.attemptId };
  const upload = await mapConnectorRequest(config.setup, { operation: "upload", ...ids, receipt: journal.receipt,
    files: journal.files.map(({ role, name, bytes, sha256 }) => ({ role, name, bytes, sha256 })) }, { signal, fetchImpl });
  await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "uploading" });
  const byName = new Map(journal.files.map(file => [file.name, file]));
  for (const item of Array.isArray(upload.uploads) ? upload.uploads : []) {
    const file = byName.get(item?.name);
    if (!file) throw new ConnectorError("map_upload_unexpected_file");
    report(`uploading ${file.name}`);
    await put(item.url, file.path, file.contentType, { signal });
  }
  const done = await mapConnectorRequest(config.setup, { operation: "complete", ...ids }, { signal, fetchImpl, timeoutMs: 600_000 });
  if (done.state !== "ready") throw new ConnectorError("map_package_not_ready");
  await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "delivered" });
  return "ready";
}

const CONTENT_TYPES = { package_zip: "application/zip", figure_preview: "image/png", run_report: "text/markdown" };

/**
 * One cycle: resume a finished run's upload if one is waiting, otherwise claim
 * the next queued package for this connection and run it to the end.
 */
export async function mapPackageCycle(config, { runsRoot = defaultMapRunsRoot(), connectorDir, signal, fetchImpl, spawnImpl = spawn,
  put = putMapPackageFile, report = () => {}, skillRoot = MAP_PACKAGE_SKILL_ROOT, heartbeatMs = MAP_RUN_HEARTBEAT_MS, maxMs = MAP_RUN_MAX_MS } = {}) {
  if (config.setup.provider !== "claude" || config.setup.expectedAuthMode !== "claude_subscription") throw new ConnectorError("map_package_runner_refused");

  // Runs this connection left unfinished, oldest first.
  const folders = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of folders) {
    if (!entry.isDirectory()) continue;
    const runDir = join(runsRoot, entry.name);
    const journal = await readMapRunJournal(runDir);
    if (!journal || journal.connectionId !== config.setup.connectionId) continue;
    if (journal.phase === "running") {
      // The agent was cut off. Never start it again; say so and keep the folder.
      await mapConnectorRequest(config.setup, { operation: "fail", packageId: journal.packageId, attemptId: journal.attemptId,
        failureCode: "map_package_connector_restarted" }, { signal, fetchImpl }).catch(() => {});
      await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "stopped" });
      report("stopped");
    } else if (journal.phase === "built" || journal.phase === "uploading") {
      report("resuming upload");
      try {
        return await deliverMapPackage(config, runDir, journal, { signal, fetchImpl, put, report });
      } catch (error) {
        // The app no longer accepts this attempt (cancelled, or its lease ran out
        // before the upload began). The package stays in the folder.
        if (!(error instanceof ConnectorError) || ![403, 409].includes(error.status)) throw error;
        await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "abandoned", failureCode: error.code });
        report("upload no longer accepted; the package stays in its folder");
      }
    }
  }

  const account = await claudeMapAccount({ binaryPath: config.binaryPath, providerHome: config.providerHome, signal, spawnImpl });
  if (account.status !== "connected") return account.status;
  const claimed = await mapConnectorRequest(config.setup, { operation: "claim", authMode: account.authMode }, { signal, fetchImpl });
  if (!claimed.package) return claimed.status;
  const job = await checkedMapClaim(claimed.package, { skillRoot });
  const ids = { packageId: job.id, attemptId: job.attemptId };
  // A failure report must reach the app even when the connector is stopping.
  const fail = failureCode => mapConnectorRequest(config.setup, { operation: "fail", ...ids, failureCode }, { fetchImpl }).catch(() => {});

  const { runDir, pluginDir, skillCopy } = await prepareMapRunFolder(job, runsRoot, { skillRoot });
  const journal = { schemaVersion: 1, connectionId: config.setup.connectionId, packageId: job.id, attemptId: job.attemptId, phase: "running" };
  await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), journal);
  report(`running in ${runDir}`);

  const settings = claudeMapSettings({ runDir, claudeConfigDir: config.providerHome, connectorDir, home: homedir() });
  const startedAt = Date.now();
  const sessionAbort = new AbortController();
  let latest = initialClaudeMapState();
  const heartbeat = setInterval(async () => {
    try {
      const answer = await mapConnectorRequest(config.setup, { operation: "heartbeat", ...ids,
        progress: { phase: "working", message: latest.message, steps: latest.steps, recent: latest.recent } }, { signal, fetchImpl });
      if (answer.state !== "running") sessionAbort.abort();
    } catch { /* The lease covers ten minutes of lost heartbeats; the server ends the run after that. */ }
  }, heartbeatMs);
  let session;
  try {
    session = await runClaudeMapSession({
      binaryPath: config.binaryPath,
      args: claudeMapArgs({ model: job.model, effort: job.effort, pluginDir, settings }),
      env: claudeMapEnv({ model: job.model, home: homedir(), claudeConfigDir: config.providerHome, path: process.env.PATH ?? "/usr/bin:/bin", censusApiKey: process.env.CENSUS_API_KEY }),
      cwd: runDir, prompt: job.prompt, logPath: join(runDir, "openplan_session.jsonl"),
      signal: AbortSignal.any([...(signal ? [signal] : []), sessionAbort.signal]), spawnImpl, maxMs,
      onInit: init => (init.model !== job.model ? "model_changed" : init.apiKeySource !== "none" ? "api_key_billing" : null),
      onProgress: state => { latest = state; },
    }).then(result => { latest = result.state; return result; });
  } finally { clearInterval(heartbeat); }

  const failWith = async code => { await fail(code); await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "failed", failureCode: code }); return code; };
  if (sessionAbort.signal.aborted) { await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "stopped" }); return "stopped"; }
  if (signal?.aborted) return await failWith("map_package_connector_stopped");
  if (session.stop === "model_changed") return await failWith("map_package_model_changed");
  if (session.stop === "api_key_billing") return await failWith("map_package_api_key_billing");
  if (session.stop === "timeout") return await failWith("map_package_timeout");
  if (session.stop) { await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), { ...journal, phase: "stopped" }); return "stopped"; }
  const result = session.state.result;
  if (session.code !== 0 || !result || result.isError || result.subtype !== "success") {
    return await failWith(result?.subtype === "error_max_turns" ? "map_package_max_turns" : "map_package_agent_failed");
  }
  const modelsUsed = normalizedModelsUsed(result.modelsUsed);
  if (modelsUsed.length !== 1 || modelsUsed[0] !== job.model) return await failWith("map_package_other_model_used");
  const built = await findBuiltPackage(runDir);
  if (!built) return await failWith("map_package_zip_missing");

  const previewDir = join(runDir, "openplan_previews");
  await mkdir(previewDir, { recursive: true, mode: 0o700 });
  const described = await describeBuiltPackage(built, { previewDir, spawnImpl });
  const kitAfter = await buildSkillManifest(skillCopy).catch(() => null);
  const files = [{ role: "package_zip", name: built.name, path: built.zipPath, contentType: CONTENT_TYPES.package_zip, ...(await sha256File(built.zipPath)) }];
  for (const preview of described.previews) {
    files.push({ role: "figure_preview", name: preview.name, path: preview.path, contentType: CONTENT_TYPES.figure_preview, ...(await sha256File(preview.path)) });
  }
  const reportPath = join(runDir, "openplan_report.md");
  const reportInfo = await lstat(reportPath).catch(() => null);
  if (reportInfo?.isFile() && reportInfo.size > 0 && reportInfo.size <= 1024 * 1024) {
    files.push({ role: "run_report", name: "openplan_report.md", path: reportPath, contentType: CONTENT_TYPES.run_report, ...(await sha256File(reportPath)) });
  }
  const receipt = {
    schemaVersion: 1, provider: "claude", authMode: "claude_subscription", model: job.model, effort: job.effort,
    modelsUsed, cliVersion: `${account.version} (Claude Code)`, skillTreeHash: job.skillTreeHash,
    kitChanged: kitAfter?.treeHash !== job.skillTreeHash, sessionId: result.sessionId,
    durationMs: result.durationMs ?? Date.now() - startedAt, numTurns: result.numTurns, usage: result.usage,
    packageName: basename(built.name, ".zip"), qa: described.qa, gates: described.gates, figures: described.figures,
  };
  const builtJournal = { ...journal, phase: "built", receipt, files };
  await writePrivateJson(join(runDir, MAP_RUN_JOURNAL), builtJournal);
  return await deliverMapPackage(config, runDir, builtJournal, { signal, fetchImpl, put, report });
}

/**
 * Check this computer can run a map package, without calling a model: Claude
 * Code version and sign-in, the sandbox tools, QGIS for the kit, and the
 * skill copy in this checkout.
 */
export async function mapRunCheck(config, { spawnImpl = spawn, skillRoot = MAP_PACKAGE_SKILL_ROOT } = {}) {
  const checks = [];
  const record = async (name, fn) => {
    try { checks.push({ name, ok: true, detail: String(await fn()) }); }
    catch (error) { checks.push({ name, ok: false, detail: error?.code ?? error?.message ?? "failed" }); }
  };
  const runOk = (command, args, env = { PATH: "/usr/bin:/bin" }) => new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.on("error", () => reject(new Error("not installed")));
    child.on("close", code => (code === 0 ? resolve(Buffer.concat(chunks).toString("utf8").trim()) : reject(new Error(`exit ${code}`))));
  });
  await record("Connection is for Claude Code", () => {
    if (config.setup.provider !== "claude" || config.setup.expectedAuthMode !== "claude_subscription") throw new Error("map packages run on a Claude Code connection");
    return "yes";
  });
  await record("Claude Code version and sign-in", async () => {
    const account = await claudeMapAccount({ binaryPath: config.binaryPath, providerHome: config.providerHome, spawnImpl });
    if (account.status !== "connected") throw new Error(account.status);
    return `${account.version}, ${account.planType} plan`;
  });
  await record("Sandbox tools (bubblewrap, socat)", async () => { await runOk("/usr/bin/bwrap", ["--version"]); await runOk("/usr/bin/socat", ["-V"]); return "installed"; });
  await record("QGIS for the kit", () => runOk("python3", ["-c", "from qgis.core import Qgis; print(Qgis.QGIS_VERSION)"],
    { PATH: process.env.PATH ?? "/usr/bin:/bin", QT_QPA_PLATFORM: "offscreen", HOME: homedir() }));
  await record("Skill copy matches its manifest", async () => (await verifiedSkillManifest(skillRoot, join(skillRoot, "..", "MANIFEST.json"))).treeHash.slice(0, 12));
  return checks;
}
