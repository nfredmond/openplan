/**
 * THE FIRST-WEEK HARNESS — DISCOVERY LAYER.
 *
 * THE PROBLEM IT EXISTS TO SOLVE
 * ------------------------------
 * Twenty releases of OpenPlan shipped with nobody but agents looking at it.
 * Then Nathaniel used it himself for twenty minutes and produced a better defect
 * list than eleven thousand tests had. That is not a fluke and it is not a
 * failure of the tests; the two things look for different classes of problem. A
 * test asks "does this do what I decided it should do". A new person asks "what
 * am I supposed to do here", and gets no answer, and leaves. Nothing in the
 * repository could ask the second question, so Nathaniel was the only instrument
 * that could, and he does not scale.
 *
 * This runner is the second instrument. It hands a FRESH agent — no repository,
 * no CLAUDE.md, no memory of this project, no idea what the buttons are called —
 * a planner's job written as an outcome, and a real browser, and gets out of the
 * way. Then it records where the agent got stuck.
 *
 * THE NO-CONTEXT PART IS THE WHOLE TRICK, and it is fragile enough to state
 * precisely. An agent that has read the codebase cannot get lost in the places a
 * new hire gets lost: it knows the route is `/rtp` even when nothing on screen
 * says so, it knows the button is called "Generate packet", and it will find its
 * way to an outcome through knowledge no planner has. Its report is then a
 * report about a product nobody else is using. Three mechanisms keep the child
 * ignorant, and all three matter:
 *
 *   1. Its working directory is a fresh run directory OUTSIDE the repository,
 *      so no CLAUDE.md and no project memory are discovered.
 *   2. `--setting-sources ""` — no user, project, or local settings load, which
 *      is what keeps the global CLAUDE.md and the auto-memory index out. This
 *      was verified by probe, not assumed: the child was asked to list every
 *      memory file it had, and answered none.
 *   3. `--tools "Read,Write"` — no Bash, no Grep, no Glob. Even pointed at the
 *      repository it could not read the source. What it has beyond that is a
 *      browser, over MCP, and nothing else.
 *
 * WHY A SCRIPT CANNOT DO THIS JOB. A deterministic script only ever tests what
 * somebody already thought of; it cannot be confused, and confusion is the thing
 * being measured. Discovery findings therefore produce a work-list rather than
 * failing the build. The separate outcome gate does fail when the planner did
 * not finish the selected job. Confirmed defects become
 * `first-week-regressions/`, which is deterministic and keeps a fixed problem
 * fixed.
 *
 * EVIDENCE OR IT DID NOT HAPPEN. An agent driving a browser will report "I
 * couldn't find the funding tab" when it simply did not scroll. Every finding
 * must arrive with a screenshot and the page snapshot from the moment it got
 * stuck, and every finding is checked against that evidence by
 * `first-week-evidence.js` before a person sees it. Findings that fail are
 * discarded and counted, not investigated. The counted part matters: a run where
 * eight of nine findings were discarded is telling you about the agent, and you
 * should know that before you read the ninth.
 *
 * LOCAL ONLY, AND NOT NEGOTIABLE. The agent signs up, types, uploads, publishes
 * and deletes. It is an unsupervised writer. So the base URL is guarded to a
 * loopback host by the same guard the mutating smokes use, and there is no flag
 * to turn that off.
 *
 * WHAT IT COSTS. One agent session per job against the selected local CLI login;
 * no API key or metered API spend. Runs are sequential, one browser at a time,
 * and usage limits are real.
 *
 * USAGE
 *   OPENPLAN_BASE_URL=http://localhost:3200 \
 *   OPENPLAN_FIRST_WEEK_EMAIL=mapaudit@openplan.test \
 *   OPENPLAN_FIRST_WEEK_PASSWORD='…' \
 *   npm run first-week-discovery                        # every job
 *   OPENPLAN_FIRST_WEEK_AGENT=codex npm run first-week-discovery
 *   ... npm run first-week-discovery -- --job 03-public-engagement
 *   ... npm run first-week-discovery -- --resume ~/.local/state/openplan/first-week-runs/<stamp>
 *   ... npm run first-week-discovery -- --list
 *   npm run first-week-discovery -- --verify-only first-week-runs/<stamp>
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertLocalTargetUrl } = require('./harness-env');
const { verifyJobReport } = require('./first-week-evidence');

const JOBS_DIR = path.join(__dirname, 'first-week-jobs');
const RUNS_DIR = path.resolve(
  process.env.OPENPLAN_FIRST_WEEK_RUNS_DIR || path.join(os.homedir(), '.local', 'state', 'openplan', 'first-week-runs'),
);
const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.79';
const DEFAULT_MODEL = 'sonnet';
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const SERVER_PROBE_TIMEOUT_MS = 10 * 1000;
const BLOCKED_STATUSES = new Set([
  'blocked_quota',
  'blocked_server',
  'blocked_build',
  'blocked_timeout',
  'blocked_turn_limit',
  'blocked_unfinished_report',
]);

function parseArgs(argv) {
  const args = { jobs: [], list: false, verifyOnly: null, resume: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') args.list = true;
    else if (arg === '--job') args.jobs.push(argv[++i]);
    else if (arg === '--jobs') args.jobs.push(...String(argv[++i] || '').split(','));
    else if (arg === '--verify-only') args.verifyOnly = argv[++i];
    else if (arg === '--resume') args.resume = argv[++i];
    else if (arg.startsWith('--job=')) args.jobs.push(arg.slice('--job='.length));
    else if (arg.startsWith('--resume=')) args.resume = arg.slice('--resume='.length);
  }
  args.jobs = args.jobs.map((j) => String(j || '').trim()).filter(Boolean);
  return args;
}

/**
 * Job files are prose with a small `--- key: value ---` header. Prose, because
 * the jobs are the part a person rewrites, and a person should not have to
 * escape a newline to describe a planner's afternoon.
 */
function loadJobs() {
  return fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith('.job.md'))
    .sort()
    .map((name) => {
      const raw = fs.readFileSync(path.join(JOBS_DIR, name), 'utf8');
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) throw new Error(`${name} has no --- header block.`);
      const meta = {};
      for (const line of match[1].split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      if (!meta.id) throw new Error(`${name} has no id.`);
      return {
        file: name,
        id: meta.id,
        title: meta.title || meta.id,
        account: ['new', 'fresh-run', 'run'].includes(meta.account) ? meta.account : 'existing',
        requiresApprover: meta.approver === 'true',
        files: meta.files || 'none',
        maxTurns: Number(meta.maxTurns) > 0 ? Number(meta.maxTurns) : 90,
        body: match[2].trim(),
      };
    });
}

/**
 * The folder "your predecessor left you". The project remains explicitly
 * synthetic, but its geometry sits near Ukiah inside the required Mendocino
 * setup geography. A 0°N 0°E placeholder was safe while this fixture only
 * proved upload and packet creation; it became an invalid test input once the
 * same project had to reach Census tracts and a runnable OSM network in the
 * first-week modeling journey.
 */
function writeHandoverFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const corridor = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'Synthetic QA Corridor — not an adopted alignment',
          jurisdiction: 'Mendocino County test fixture',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-123.2176, 39.1326],
            [-123.2148, 39.1437],
            [-123.2107, 39.1548],
            [-123.2071, 39.1661],
          ],
        },
      },
    ],
  };
  const studyArea = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Synthetic QA study area near Ukiah — not an adopted boundary' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-123.235, 39.12],
              [-123.19, 39.12],
              [-123.19, 39.18],
              [-123.235, 39.18],
              [-123.235, 39.12],
            ],
          ],
        },
      },
    ],
  };
  const landUseDesignations = {
    type: 'FeatureCollection',
    name: 'Synthetic QA future land-use designations — exercise only, not adopted',
    features: [
      {
        type: 'Feature',
        properties: {
          designation: 'Exercise mixed use',
          exercise_status: 'synthetic_unadopted_qa_fixture',
          source_note: 'Generated only to exercise OpenPlan first-week custody and publication controls',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-123.235, 39.12],
            [-123.2125, 39.12],
            [-123.2125, 39.18],
            [-123.235, 39.18],
            [-123.235, 39.12],
          ]],
        },
      },
      {
        type: 'Feature',
        properties: {
          designation: 'Exercise residential',
          exercise_status: 'synthetic_unadopted_qa_fixture',
          source_note: 'Generated only to exercise OpenPlan first-week custody and publication controls',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-123.2125, 39.12],
            [-123.19, 39.12],
            [-123.19, 39.18],
            [-123.2125, 39.18],
            [-123.2125, 39.12],
          ]],
        },
      },
    ],
  };
  const projects = [
    'name,description,cost_usd,phase',
    'Example Corridor Complete Street,"Sidewalks, lighting and crossings along the corridor",4200000,planning',
    'Example Corridor Signal Upgrade,"Replace four signals and add pedestrian phases",1150000,design',
    'Example Corridor Shared-Use Path,"Two miles of separated path beside the corridor",7600000,planning',
  ].join('\n');
  const adoptionInstrument = [
    'EXERCISE-ONLY ADOPTION INSTRUMENT — NOT AN AGENCY RECORD',
    '',
    'Purpose: test OpenPlan first-week document custody and adoption workflow state transitions.',
    'Status: synthetic QA fixture; not adopted, approved, signed, voted on, or legally effective.',
    'This file does not establish legal compliance, environmental review, consultation, adoption, or agency action.',
    'It must never be cited or represented as a real ordinance, resolution, finding, vote, or governing-body decision.',
  ].join('\n');
  const modelComparisonAssumption = [
    'EXERCISE-ONLY MODEL COMPARISON ASSUMPTION — NOT A FORECAST',
    '',
    'Expected change: -5 percent assigned daily auto trips versus no-build.',
    'Source: manager-supplied synthetic QA assumption for first-week workflow testing.',
    'Limit: not a local study, count analysis, adopted policy assumption, calibrated result, agency estimate, or outward claim.',
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'corridor.geojson'), `${JSON.stringify(corridor, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'study-area.geojson'), `${JSON.stringify(studyArea, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'land-use-designations.geojson'), `${JSON.stringify(landUseDesignations, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'projects.csv'), `${projects}\n`);
  fs.writeFileSync(path.join(dir, 'exercise-only-adoption-instrument.txt'), `${adoptionInstrument}\n`);
  fs.writeFileSync(path.join(dir, 'exercise-only-model-assumption.txt'), `${modelComparisonAssumption}\n`);
}

function buildPrompt(job, { baseUrl, email, password, approverEmail, approverPassword, agentDir, contract }) {
  const body = job.body
    .replace(/\{\{BASE_URL\}\}/g, baseUrl)
    .replace(/\{\{EMAIL\}\}/g, email)
    .replace(/\{\{PASSWORD\}\}/g, password)
    .replace(/\{\{APPROVER_EMAIL\}\}/g, approverEmail || '')
    .replace(/\{\{APPROVER_PASSWORD\}\}/g, approverPassword || '');

  return [
    'You are doing a real job in a real piece of software, using the browser you have been given.',
    'You have never seen this software before and there is no documentation. That is intentional.',
    'Use the browser MCP server named browser for the product. Do not use web search, shell commands, or inspect source files.',
    '',
    `Your working directory is ${agentDir}. Write your evidence and your report there and nowhere else.`,
    `The job id you were given is: ${job.id}`,
    // Run A of this harness died at its turn limit with three screenshots taken
    // and nothing written down. The budget is stated so the agent can pace
    // itself, and the contract tells it to write the report early regardless.
    `You have about ${job.maxTurns} steps. Running out is normal and is not failure — but a report that was never written to disk is.`,
    '',
    '========== THE JOB ==========',
    body,
    '',
    '========== HOW TO REPORT ==========',
    contract,
    '',
    'Start now. Create findings.json early, keep it current, and leave the final version on disk when you stop.',
  ].join('\n');
}

function mcpConfig(browserDir) {
  return {
    mcpServers: {
      browser: {
        command: 'npx',
        args: [
          '-y',
          PLAYWRIGHT_MCP,
          '--browser',
          'chrome',
          '--headless',
          '--isolated',
          '--viewport-size',
          '1440x900',
          // The agent is never told this directory exists. Everything the
          // browser serves it is recorded here, and `first-week-evidence.js`
          // checks the agent's snapshots against these copies.
          '--output-dir',
          browserDir,
        ],
      },
    },
  };
}

function runClaudeAgent({ job, agentDir, browserDir, prompt, model, timeoutMs }) {
  const mcpPath = path.join(path.dirname(agentDir), 'mcp.json');
  fs.writeFileSync(mcpPath, `${JSON.stringify(mcpConfig(browserDir), null, 2)}\n`);

  const args = [
    '-p',
    prompt,
    '--model',
    model,
    // No settings sources: this is what keeps the global CLAUDE.md and the
    // project memory index out of the child. Verified by probe.
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--mcp-config',
    mcpPath,
    '--tools',
    'Read,Write',
    '--permission-mode',
    'bypassPermissions',
    '--max-turns',
    String(job.maxTurns),
    '--output-format',
    'json',
  ];

  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group: a timeout has to take the browser down with the
    // agent, or a killed job leaves a headless Chrome holding a profile and the
    // next job starts against a machine that is already busy.
    const child = spawn('claude', args, {
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

function codexMcpArgs(browserDir) {
  return [
    '-y',
    PLAYWRIGHT_MCP,
    '--browser',
    'chrome',
    '--headless',
    '--isolated',
    '--viewport-size',
    '1440x900',
    '--output-dir',
    browserDir,
  ];
}

function buildCodexArgs({ agentDir, browserDir }) {
  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--approve-for-me',
    '--add-dir',
    browserDir,
    '-C',
    agentDir,
    '--json',
    '-c',
    'web_search="disabled"',
    '-c',
    'mcp_servers.browser.command="npx"',
    '-c',
    `mcp_servers.browser.args=${JSON.stringify(codexMcpArgs(browserDir))}`,
    '-c',
    'mcp_servers.browser.startup_timeout_sec=120',
    '-',
  ];
}

/**
 * Codex needs the existing login but none of the user's instructions, memory,
 * plugins, or project configuration. A blank HOME plus a one-run auth symlink
 * produced a fresh-context probe; isolating CODEX_HOME alone did not.
 */
function runCodexAgent({ agentDir, browserDir, prompt, timeoutMs }) {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openplan-first-week-codex-'));
  const isolatedCodexHome = path.join(isolatedHome, 'codex');
  fs.mkdirSync(isolatedCodexHome, { recursive: true });
  const sourceCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sourceAuth = path.join(sourceCodexHome, 'auth.json');
  const isolatedAuth = path.join(isolatedCodexHome, 'auth.json');
  if (!fs.existsSync(sourceAuth)) throw new Error(`Codex auth is unavailable at ${sourceAuth}.`);
  fs.symlinkSync(sourceAuth, isolatedAuth);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('codex', buildCodexArgs({ agentDir, browserDir }), {
      cwd: agentDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: isolatedHome,
        CODEX_HOME: isolatedCodexHome,
        NPM_CONFIG_CACHE: path.join(os.homedir(), '.npm'),
      },
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.stdin.end(prompt);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (fs.existsSync(isolatedAuth)) fs.unlinkSync(isolatedAuth);
      resolve({ code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started, backend: 'codex' });
    });
  });
}

function runAgent(options) {
  return options.backend === 'codex' ? runCodexAgent(options) : runClaudeAgent(options);
}

function codexContractViolation(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const item = event?.item;
    if (item?.type === 'command_execution') return 'Codex used a shell command during a browser-only journey.';
    if (item?.type === 'web_search') return 'Codex used web search during a browser-only journey.';
  }
  return null;
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Bind a first-week run to the exact app checkout it exercised. */
function currentBuildIdentity() {
  const appPackage = readJsonIfPresent(path.join(__dirname, '..', 'openplan', 'package.json'));
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  const gitSha = revision.status === 0 ? revision.stdout.trim() : '';
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  return {
    gitSha: /^[0-9a-f]{40}$/i.test(gitSha) ? gitSha : 'unknown',
    appVersion:
      typeof appPackage?.version === 'string' && appPackage.version.trim()
        ? appPackage.version.trim()
        : 'unknown',
    gitDirty: status.status !== 0 || Boolean(status.stdout.trim()),
  };
}

/** Explain why a local checkout and the app answering /api/health are not the same build. */
function compareBuildIdentity(localBuild, deployment) {
  if (!localBuild || localBuild.gitSha === 'unknown') return 'The local checkout commit is unknown.';
  if (localBuild.gitDirty) return 'The local checkout is dirty, so HEAD does not name the exercised source.';
  const commit = typeof deployment?.commit === 'string' ? deployment.commit.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{7,40}$/.test(commit)) return 'The running app did not advertise a usable commit.';
  if (!localBuild.gitSha.toLowerCase().startsWith(commit)) {
    return `The running app commit ${commit} does not match local checkout ${localBuild.gitSha}.`;
  }
  if (deployment?.version !== localBuild.appVersion) {
    return `The running app version ${deployment?.version ?? 'unknown'} does not match ${localBuild.appVersion}.`;
  }
  return null;
}

async function readServerBuildIdentity(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
      signal: AbortSignal.timeout(SERVER_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.deployment ?? null;
  } catch {
    return null;
  }
}

/**
 * Browser logs are release evidence. Expected 409 validation responses and a
 * missing development favicon stay recorded, but React errors, page failures,
 * broken chunks, and every other console error invalidate the journey.
 */
function inspectBrowserConsole(browserDir) {
  const result = { fatal: [], allowed: [] };
  if (!fs.existsSync(browserDir)) return result;
  const files = fs.readdirSync(browserDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^console-.*\.log$/i.test(entry.name))
    .map((entry) => entry.name);
  for (const file of files) {
    const lines = fs.readFileSync(path.join(browserDir, file), 'utf8').split(/\r?\n/);
    for (const text of lines) {
      if (!/\[ERROR\]/.test(text)) continue;
      const entry = { file, text };
      const expectedConflict = /status of 409 \(Conflict\)/.test(text);
      const missingFavicon = /status of 404 \(Not Found\).*\/favicon\.ico/i.test(text);
      (expectedConflict || missingFavicon ? result.allowed : result.fatal).push(entry);
    }
  }
  return result;
}

/** Require the MCP's records even when the agent reports no findings. An empty
 * console log is a valid capture; a missing log is not evidence of no errors.
 * Presence alone does not prove the page content, screenshots or user outcome. */
function inspectBrowserCapture(browserDir) {
  try {
    const files = fs.readdirSync(browserDir, { withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => entry.name);
    const hasSnapshot = files.some((name) => /^page-.*\.ya?ml$/i.test(name)
      && fs.readFileSync(path.join(browserDir, name), 'utf8').trim().length > 0);
    const hasConsole = files.some((name) => /^console-.*\.log$/i.test(name));
    return {
      problem: !hasSnapshot
        ? 'No non-empty MCP page snapshot was retained for this journey.'
        : !hasConsole ? 'No MCP console capture was retained for this journey.' : null,
      console: inspectBrowserConsole(browserDir),
    };
  } catch {
    return {
      problem: 'The browser capture directory or its records are missing or unreadable.',
      console: { fatal: [], allowed: [] },
    };
  }
}

function buildNewRunManifest({ createdAt, baseUrl, model, backend, jobs, freshAccount, build }) {
  return { createdAt, baseUrl, model, backend, jobs, freshAccount, build };
}

function buildJobManifest({ job, email, approverEmail, model, backend, build }) {
  return {
    id: job.id,
    title: job.title,
    account: job.account,
    email,
    approverEmail,
    model,
    backend,
    build,
  };
}

function normalizeFindingsReport(value) {
  let report = value;
  if (typeof report === 'string') {
    try {
      report = JSON.parse(report);
    } catch {
      return null;
    }
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  if (!['yes', 'partly', 'no'].includes(report.outcomeReached) || !Array.isArray(report.findings)) return null;
  return report;
}

function parseAgentSession(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function terminalAgentText(session, processResult) {
  if (session) {
    return [session.result, processResult?.stderr]
      .filter((value) => typeof value === 'string')
      .join('\n');
  }

  const terminal = [];
  for (const line of String(processResult?.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'error' || event.type === 'turn.failed') terminal.push(JSON.stringify(event));
    } catch {
      /* A forced stop may leave one truncated JSONL line. */
    }
  }
  if (typeof processResult?.stderr === 'string') terminal.push(processResult.stderr);
  return terminal.join('\n');
}

/**
 * Classify how a job ended separately from what the planner found. Claude can
 * return exit 0 and subtype "success" for a subscription limit, so process
 * status alone is not evidence that the job ran.
 */
function classifyJobExecution({ processResult = {}, session = null, reportPresent = false, serverAvailableAfter = true }) {
  const resultText = terminalAgentText(session, processResult);
  if (session?.api_error_status === 429 || /session limit|weekly limit|usage limit|rate limit|quota/i.test(resultText)) {
    return { status: 'blocked_quota', reason: 'The agent service quota was exhausted before the journey finished.' };
  }
  if (
    !serverAvailableAfter ||
    /ERR_CONNECTION_REFUSED|ECONNREFUSED|server (?:stopped|disconnected|unavailable)|site can.t be reached/i.test(resultText)
  ) {
    return { status: 'blocked_server', reason: 'The target OpenPlan server stopped answering during the journey.' };
  }
  if (processResult.timedOut || processResult.signal === 'SIGKILL') {
    return { status: 'blocked_timeout', reason: 'The journey exceeded its wall-clock timeout.' };
  }
  if (session?.subtype === 'error_max_turns') {
    return { status: 'blocked_turn_limit', reason: 'The agent used every allowed step before the journey finished.' };
  }
  if (!reportPresent && processResult.code === 0 && !session?.is_error) {
    return { status: 'blocked_unfinished_report', reason: 'The agent stopped without leaving a findings report.' };
  }
  if (reportPresent && processResult.code === 0 && !session?.is_error) {
    return { status: 'completed', reason: 'The agent completed and left a findings report.' };
  }
  return {
    status: 'failed',
    reason: `The agent process failed${processResult.code === undefined ? '' : ` with exit ${processResult.code}`}.`,
  };
}

function readJobExecution(jobDir) {
  const recorded = readJsonIfPresent(path.join(jobDir, 'execution.json'));

  const stdoutPath = path.join(jobDir, 'agent-stdout.json');
  const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  const session = parseAgentSession(stdout);
  const reportPresent = readFindings(path.join(jobDir, 'agent')) !== null;
  const inferred = classifyJobExecution({
    processResult: { code: recorded?.exitCode ?? 0, signal: recorded?.signal ?? null, stdout },
    session,
    reportPresent,
  });
  if (
    !recorded?.status ||
    (recorded.status === 'failed' && inferred.status !== 'failed') ||
    (recorded.status === 'blocked_quota' && inferred.status === 'completed')
  ) {
    return { ...recorded, ...inferred };
  }
  return recorded;
}

function classifyJobOutcome({ execution, report, fatalConsoleErrors = 0, browserCaptureProblem = null }) {
  if (execution.status !== 'completed') {
    return {
      status: 'inconclusive',
      reason: `The journey execution ended ${execution.status}, so it cannot prove the planner outcome.`,
    };
  }
  if (!report) {
    return { status: 'inconclusive', reason: 'The completed execution has no valid findings report.' };
  }
  if (browserCaptureProblem) {
    return { status: 'inconclusive', reason: browserCaptureProblem };
  }
  if (fatalConsoleErrors > 0) {
    return {
      status: 'failed',
      reason: `The browser recorded ${fatalConsoleErrors} unexpected console error${fatalConsoleErrors === 1 ? '' : 's'}.`,
    };
  }
  if (report.outcomeReached === 'yes') {
    return { status: 'passed', reason: 'The completed journey reports that the planner reached the intended outcome.' };
  }
  return {
    status: 'failed',
    reason:
      report.outcomeReached === 'partly'
        ? 'The planner reached the intended outcome only partly.'
        : 'The planner did not reach the intended outcome.',
  };
}

function shouldResumeJob(jobDir) {
  if (!fs.existsSync(jobDir)) return true;
  const execution = readJobExecution(jobDir);
  const report = readFindings(path.join(jobDir, 'agent'));
  const browserCapture = inspectBrowserCapture(path.join(jobDir, 'browser'));
  return classifyJobOutcome({
    execution,
    report,
    fatalConsoleErrors: browserCapture.console.fatal.length,
    browserCaptureProblem: browserCapture.problem,
  }).status !== 'passed';
}

/** Preserve every prior artifact. Resuming never erases the evidence for why a run stopped. */
function archiveAttempt(jobDir, stamp) {
  if (!fs.existsSync(jobDir)) return null;
  const names = fs.readdirSync(jobDir).filter((name) => name !== 'attempts');
  if (!names.length) return null;
  const attemptDir = path.join(jobDir, 'attempts', stamp);
  fs.mkdirSync(attemptDir, { recursive: true });
  for (const name of names) fs.renameSync(path.join(jobDir, name), path.join(attemptDir, name));
  return attemptDir;
}

async function serverIsAvailable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
      signal: AbortSignal.timeout(SERVER_PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Agents like to wrap JSON in prose. This pulls the object back out rather than
 * discarding an otherwise complete report over a code fence.
 */
function readFindings(agentDir) {
  const direct = normalizeFindingsReport(readJsonIfPresent(path.join(agentDir, 'findings.json')));
  if (direct) return direct;

  const searchDirs = [agentDir, path.join(agentDir, 'evidence')].filter((dir) => fs.existsSync(dir));
  const candidates = searchDirs.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((name) => /findings.*\.(json|txt|md)$/i.test(name))
      .map((name) => path.join(dir, name)),
  );
  for (const candidate of candidates) {
    const text = fs.readFileSync(candidate, 'utf8');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const report = normalizeFindingsReport(JSON.parse(text.slice(start, end + 1)));
      if (report) return report;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function renderJobMarkdown(job, verdict) {
  const lines = [`## ${job.id} — ${job.title}`, ''];
  lines.push(`- Outcome reached: **${verdict.outcomeReached ?? 'not stated'}**`);
  lines.push(`- Outcome gate: **${verdict.outcome.status}**. ${verdict.outcome.reason}`);
  lines.push(`- Evidence-complete claims awaiting product judgment: **${verdict.confirmed.length}**`);
  lines.push(`- Discarded findings: **${verdict.discarded.length}**`);
  lines.push(`- Snapshots the browser recorded: ${verdict.browserDumps}`);
  if (verdict.execution) lines.push(`- Run status: **${verdict.execution.status}**. ${verdict.execution.reason}`);
  if (verdict.browserConsole) {
    lines.push(
      `- Browser console: **${verdict.browserConsole.fatal.length} unexpected errors**; ${verdict.browserConsole.allowed.length} named expected HTTP responses retained.`,
    );
  }
  if (verdict.ending) lines.push(`- The session ${verdict.ending}.`);
  if (verdict.whatIDid) lines.push('', `**What it did.** ${verdict.whatIDid}`);
  if (verdict.whatWouldHaveHelped) lines.push('', `**What would have helped.** ${verdict.whatWouldHaveHelped}`);

  if (verdict.confirmed.length) {
    lines.push('', '### Evidence complete — manual product judgment still required', '');
    for (const f of verdict.confirmed) {
      lines.push(`- **[${f.severity}] ${f.title}**`);
      lines.push(`  - ${f.url}`);
      lines.push(`  - evidence: \`${f.screenshot}\`, \`${f.snapshot}\``);
    }
  }
  if (verdict.discarded.length) {
    lines.push('', '### Discarded — the evidence did not hold up', '');
    for (const f of verdict.discarded) {
      lines.push(`- ~~${f.title || f.id}~~`);
      for (const reason of f.reasons) lines.push(`  - ${reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function verifyRun(runRoot, baseUrl) {
  const discoveredJobDirs = fs
    .readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const manifest = readJsonIfPresent(path.join(runRoot, 'run.json'));
  const jobDirs = Array.isArray(manifest?.jobs)
    ? [...new Set(manifest.jobs.filter((job) => typeof job === 'string' && job.trim()))]
    : discoveredJobDirs;

  const sections = [];
  let confirmed = 0;
  let discarded = 0;
  let completed = 0;
  let blocked = 0;
  let failed = 0;
  let reached = 0;
  let partlyReached = 0;
  let notReached = 0;
  let inconclusive = 0;

  for (const jobDir of jobDirs) {
    const dir = path.join(runRoot, jobDir);
    const agentDir = path.join(dir, 'agent');
    const browserDir = path.join(dir, 'browser');

    const meta = readJsonIfPresent(path.join(dir, 'job.json')) || { id: jobDir, title: jobDir };
    const stdoutPath = path.join(dir, 'agent-stdout.json');
    const session = parseAgentSession(fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '') || {};
    const execution = readJobExecution(dir);
    if (execution.status === 'completed') completed += 1;
    else if (BLOCKED_STATUSES.has(execution.status)) blocked += 1;
    else failed += 1;
    // How the session ENDED is part of the result. A job that hit its turn
    // limit and a job that finished having found nothing look identical in a
    // finding count, and they mean opposite things.
    const ending = !session.subtype
      ? execution.backend
        ? `ran through \`${execution.backend}\` with exit ${execution.exitCode ?? '?'}`
        : 'did not start an agent session'
      : session.subtype !== 'success'
        ? `ended \`${session.subtype}\` after ${session.num_turns ?? '?'} steps`
        : `returned \`${session.subtype}\` after ${session.num_turns ?? '?'} steps`;
    const report = readFindings(agentDir);
    const browserCapture = inspectBrowserCapture(browserDir);
    const browserConsole = browserCapture.console;
    const outcome = classifyJobOutcome({
      execution,
      report,
      fatalConsoleErrors: browserConsole.fatal.length,
      browserCaptureProblem: browserCapture.problem,
    });
    if (outcome.status === 'inconclusive') inconclusive += 1;
    else if (outcome.status === 'passed') reached += 1;
    else if (report.outcomeReached === 'partly') partlyReached += 1;
    else notReached += 1;

    if (!report) {
      sections.push(
        [
          `## ${meta.id} — ${meta.title}`,
          '',
          `- Run status: **${execution.status}**. ${execution.reason}`,
          `- Outcome gate: **${outcome.status}**. ${outcome.reason}`,
          `- Browser console: **${browserConsole.fatal.length} unexpected errors**; ${browserConsole.allowed.length} named expected HTTP responses retained.`,
          `- The agent ${ending}. This journey is unfinished and may be resumed; it is not a no-findings result.`,
          `- See \`${jobDir}/execution.json\` and \`${jobDir}/agent-stdout.json\`.`,
          '',
        ].join('\n'),
      );
      continue;
    }

    const verdict = verifyJobReport({ runDir: agentDir, browserOutputDir: browserDir, baseUrl, report });
    verdict.whatIDid = report.whatIDid;
    verdict.whatWouldHaveHelped = report.whatWouldHaveHelped;
    verdict.ending = ending;
    verdict.execution = execution;
    verdict.outcome = outcome;
    verdict.browserConsole = browserConsole;
    confirmed += verdict.confirmed.length;
    discarded += verdict.discarded.length;

    fs.writeFileSync(path.join(dir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
    sections.push(renderJobMarkdown(meta, verdict));
  }

  const evaluated = reached + partlyReached + notReached + inconclusive;
  const outcomeGatePassed = evaluated > 0 && reached === evaluated;

  const summary = [
    '# First-week harness — discovery run',
    '',
    `- Target: ${baseUrl}`,
    `- Run directory: ${runRoot}`,
    `- Evidence-complete claims awaiting product judgment: **${confirmed}**`,
    `- Discarded findings: **${discarded}**`,
    `- Completed jobs: **${completed}**`,
    `- Blocked jobs: **${blocked}**`,
    `- Failed jobs: **${failed}**`,
    `- Planner outcomes reached: **${reached}**`,
    `- Planner outcomes partly reached: **${partlyReached}**`,
    `- Planner outcomes not reached: **${notReached}**`,
    `- Outcome evidence inconclusive: **${inconclusive}**`,
    `- Outcome gate: **${outcomeGatePassed ? 'PASSED' : 'FAILED'}**`,
    '',
    'The outcome gate passes only when every selected journey completes and reports that',
    'the planner reached the intended outcome, with a retained non-empty MCP page snapshot',
    'and a console capture without unexpected errors. These records are necessary, but do not',
    'prove the semantic outcome, screenshot validity, runtime identity or human usability.',
    '',
    'An evidence-complete claim means the named screenshot and page snapshot passed mechanical',
    'checks, including exact and same-line missing-text contradictions. It does not prove the',
    'narrative is correct: a person must compare the claim with',
    'the evidence before making it a work item. A discarded claim was contradicted by an exact',
    'check or had incomplete evidence.',
    '',
    ...sections,
  ].join('\n');

  fs.writeFileSync(path.join(runRoot, 'summary.md'), `${summary}\n`);
  return {
    confirmed,
    discarded,
    completed,
    blocked,
    failed,
    reached,
    partlyReached,
    notReached,
    inconclusive,
    outcomeGatePassed,
    summaryPath: path.join(runRoot, 'summary.md'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = loadJobs();

  if (args.list) {
    for (const job of jobs) console.log(`${job.id.padEnd(24)} ${job.title}`);
    return;
  }

  const baseUrl = (process.env.OPENPLAN_BASE_URL || '').trim();
  if (!baseUrl) {
    console.error(
      'OPENPLAN_BASE_URL is required. OpenPlan has no canonical instance, so a discovery run always names the deployment it drove.',
    );
    process.exit(2);
  }
  // The agent signs up, types, uploads and publishes without supervision. There
  // is deliberately no flag that lets it do that anywhere but a local instance.
  assertLocalTargetUrl(baseUrl, 'First-week discovery base URL');

  if (args.verifyOnly && args.resume) {
    console.error('--verify-only and --resume cannot be used together.');
    process.exit(2);
  }

  if (args.verifyOnly) {
    const runRoot = path.resolve(args.verifyOnly);
    const result = verifyRun(runRoot, baseUrl);
    console.log(
      `\n${result.confirmed} evidence-complete claims awaiting judgment, ${result.discarded} discarded. ${result.summaryPath}`,
    );
    if (!result.outcomeGatePassed) process.exitCode = 1;
    return;
  }

  let selected = args.jobs.length ? jobs.filter((job) => args.jobs.includes(job.id)) : jobs;
  if (!selected.length) {
    console.error(`No job matched ${args.jobs.join(', ')}. Run with --list.`);
    process.exit(2);
  }

  const existingEmail = (process.env.OPENPLAN_FIRST_WEEK_EMAIL || '').trim();
  const existingPassword = (process.env.OPENPLAN_FIRST_WEEK_PASSWORD || '').trim();
  const governedAccountsPath = path.resolve(
    process.env.OPENPLAN_FIRST_WEEK_GOVERNED_ACCOUNTS
      || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'openplan', 'first-week-governed-accounts.json'),
  );
  const governedAccounts = readJsonIfPresent(governedAccountsPath);
  const governedCreator = governedAccounts?.schemaVersion === 'openplan.first_week_governed_accounts.v1'
    ? governedAccounts.creator
    : null;
  const configuredApproverEmail = (process.env.OPENPLAN_FIRST_WEEK_APPROVER_EMAIL || governedAccounts?.approver?.email || '').trim();
  const configuredApproverPassword = (process.env.OPENPLAN_FIRST_WEEK_APPROVER_PASSWORD || governedAccounts?.approver?.password || '').trim();
  if (selected.some((job) => job.account === 'existing') && (!existingEmail || !existingPassword)) {
    console.error(
      'OPENPLAN_FIRST_WEEK_EMAIL and OPENPLAN_FIRST_WEEK_PASSWORD are required for jobs that start signed in.',
    );
    process.exit(2);
  }
  if (selected.some((job) => job.requiresApprover) && (!configuredApproverEmail || !configuredApproverPassword)) {
    console.error(
      'This job needs OPENPLAN_FIRST_WEEK_APPROVER_EMAIL and OPENPLAN_FIRST_WEEK_APPROVER_PASSWORD, or the local governed-account handoff written by the deterministic smoke.',
    );
    process.exit(2);
  }

  const model = (process.env.OPENPLAN_FIRST_WEEK_MODEL || DEFAULT_MODEL).trim();
  const backend = (process.env.OPENPLAN_FIRST_WEEK_AGENT || 'claude').trim().toLowerCase();
  if (!['claude', 'codex'].includes(backend)) {
    console.error('OPENPLAN_FIRST_WEEK_AGENT must be claude or codex.');
    process.exit(2);
  }
  const timeoutMs = Number(process.env.OPENPLAN_FIRST_WEEK_TIMEOUT_MS) || DEFAULT_JOB_TIMEOUT_MS;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runRoot = args.resume ? path.resolve(args.resume) : path.join(RUNS_DIR, stamp);
  fs.mkdirSync(runRoot, { recursive: true });

  const manifestPath = path.join(runRoot, 'run.json');
  const existingManifest = readJsonIfPresent(manifestPath);
  if (args.resume && !existingManifest) {
    console.error(`${runRoot} has no run.json and cannot be resumed safely.`);
    process.exit(2);
  }
  if (existingManifest && existingManifest.baseUrl !== baseUrl) {
    console.error(`This run targeted ${existingManifest.baseUrl}; refusing to resume it against ${baseUrl}.`);
    process.exit(2);
  }
  if (args.resume && !args.jobs.length) {
    selected = jobs.filter((job) => existingManifest.jobs.includes(job.id));
  }
  const generatedFreshAccount = {
    email: `first-week-${stamp.slice(0, 19).toLowerCase()}@openplan.test`,
    password: 'FirstWeek!2026',
  };
  const buildIdentity = currentBuildIdentity();
  if (buildIdentity.gitDirty) {
    console.error('The first-week release journey requires a clean checkout so HEAD names every exercised byte.');
    process.exit(2);
  }
  if (existingManifest?.build) {
    const resumeBuildProblem = compareBuildIdentity(buildIdentity, {
      commit: existingManifest.build.gitSha,
      version: existingManifest.build.appVersion,
    });
    if (resumeBuildProblem) {
      console.error(`Refusing to resume against a different checkout: ${resumeBuildProblem}`);
      process.exit(2);
    }
  }
  const deploymentIdentity = await readServerBuildIdentity(baseUrl);
  const initialBuildProblem = compareBuildIdentity(buildIdentity, deploymentIdentity);
  if (initialBuildProblem) {
    console.error(`First-week build identity check failed: ${initialBuildProblem}`);
    process.exit(2);
  }
  const manifest = existingManifest || buildNewRunManifest({
    createdAt: new Date().toISOString(),
    baseUrl,
    model,
    backend,
    jobs: selected.map((job) => job.id),
    freshAccount: generatedFreshAccount,
    build: buildIdentity,
  });
  const runHasFreshAccountCreator = jobs.some(
    (job) => job.account === 'fresh-run' && Array.isArray(manifest.jobs) && manifest.jobs.includes(job.id),
  );
  if (
    selected.some((job) => job.account === 'run') &&
    !runHasFreshAccountCreator &&
    (!existingEmail || !existingPassword) &&
    !(governedCreator?.email && governedCreator?.password)
  ) {
    console.error(
      'A run-account job selected by itself needs OPENPLAN_FIRST_WEEK_EMAIL and OPENPLAN_FIRST_WEEK_PASSWORD, the local governed-account handoff, or a run manifest that includes the fresh-account setup job.',
    );
    process.exit(2);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const contract = fs.readFileSync(path.join(JOBS_DIR, '_reporting-contract.md'), 'utf8');

  console.log(`First-week discovery against ${baseUrl}`);
  console.log(`Agent: ${backend}${backend === 'claude' ? ` (${model})` : ''}. Jobs: ${selected.map((j) => j.id).join(', ')}`);
  console.log(`Run directory: ${runRoot}\n`);

  for (const job of selected) {
    const dir = path.join(runRoot, job.id);
    if (args.resume && !shouldResumeJob(dir)) {
      process.stdout.write(`✓ ${job.id} — already completed; keeping its evidence\n`);
      continue;
    }
    if (args.resume) archiveAttempt(dir, stamp);
    const agentDir = path.join(dir, 'agent');
    const browserDir = path.join(dir, 'browser');
    fs.mkdirSync(path.join(agentDir, 'evidence'), { recursive: true });
    fs.mkdirSync(browserDir, { recursive: true });
    if (job.files === 'handover') writeHandoverFiles(path.join(agentDir, 'handover'));

    const useRunAccount = job.account === 'fresh-run' || (job.account === 'run' && runHasFreshAccountCreator);
    const governedPrimary = job.account === 'run'
      && governedCreator?.email
      && governedCreator?.password
      && (job.requiresApprover || (!useRunAccount && (!existingEmail || !existingPassword)))
      ? governedCreator
      : null;
    const email = governedPrimary
      ? governedPrimary.email
      : useRunAccount
      ? manifest.freshAccount.email
      : job.account === 'new'
        ? `first-week-${stamp.slice(0, 19).toLowerCase()}-${job.id}@openplan.test`
        : existingEmail;
    const password = governedPrimary
      ? governedPrimary.password
      : useRunAccount
      ? manifest.freshAccount.password
      : job.account === 'new'
        ? 'FirstWeek!2026'
        : existingPassword;

    fs.writeFileSync(
      path.join(dir, 'job.json'),
      `${JSON.stringify(buildJobManifest({
        job,
        email,
        approverEmail: job.requiresApprover ? configuredApproverEmail : null,
        model,
        backend,
        build: manifest.build,
      }), null, 2)}\n`,
    );

    const prompt = buildPrompt(job, {
      baseUrl,
      email,
      password,
      approverEmail: job.requiresApprover ? configuredApproverEmail : null,
      approverPassword: job.requiresApprover ? configuredApproverPassword : null,
      agentDir,
      contract,
    });
    fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);

    process.stdout.write(`▶ ${job.id} — ${job.title}\n`);
    const currentIdentity = currentBuildIdentity();
    const localBuildProblem = compareBuildIdentity(currentIdentity, {
      commit: manifest.build.gitSha,
      version: manifest.build.appVersion,
    });
    const runningIdentity = await readServerBuildIdentity(baseUrl);
    const runningBuildProblem = runningIdentity
      ? compareBuildIdentity(manifest.build, runningIdentity)
      : 'The target OpenPlan server did not answer the preflight health check.';
    if (localBuildProblem || runningBuildProblem) {
      const serverUnavailable = !runningIdentity && !localBuildProblem;
      const execution = {
        status: serverUnavailable ? 'blocked_server' : 'blocked_build',
        reason: localBuildProblem || runningBuildProblem,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(dir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
      process.stdout.write(`  BLOCKED: ${execution.reason}\n`);
      continue;
    }

    const startedAt = new Date().toISOString();
    const result = await runAgent({ backend, job, agentDir, browserDir, prompt, model, timeoutMs });
    fs.writeFileSync(path.join(dir, 'agent-stdout.json'), result.stdout);
    if (result.stderr) fs.writeFileSync(path.join(dir, 'agent-stderr.log'), result.stderr);
    const session = parseAgentSession(result.stdout);
    const contractViolation = backend === 'codex' ? codexContractViolation(result.stdout) : null;
    const serverAvailableAfter = await serverIsAvailable(baseUrl);
    const localIdentityAfter = currentBuildIdentity();
    const localBuildProblemAfter = compareBuildIdentity(localIdentityAfter, {
      commit: manifest.build.gitSha,
      version: manifest.build.appVersion,
    });
    const serverIdentityAfter = serverAvailableAfter ? await readServerBuildIdentity(baseUrl) : null;
    const runningBuildProblemAfter = serverAvailableAfter
      ? compareBuildIdentity(manifest.build, serverIdentityAfter)
      : null;
    const execution = {
      ...(contractViolation
        ? { status: 'failed_contract', reason: contractViolation }
        : localBuildProblemAfter || runningBuildProblemAfter
          ? { status: 'blocked_build', reason: localBuildProblemAfter || runningBuildProblemAfter }
        : classifyJobExecution({
            processResult: result,
            session,
            reportPresent: readFindings(agentDir) !== null,
            serverAvailableAfter,
          })),
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: result.code,
      signal: result.signal,
      durationMs: result.durationMs,
      agentSubtype: session?.subtype ?? null,
      agentTurns: session?.num_turns ?? null,
      backend,
    };
    fs.writeFileSync(path.join(dir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
    process.stdout.write(
      `  ${execution.status} in ${Math.round(result.durationMs / 1000)}s (exit ${result.code}${result.signal ? `, ${result.signal}` : ''})\n`,
    );
  }

  const result = verifyRun(runRoot, baseUrl);
  console.log(`\n${result.confirmed} evidence-complete claims awaiting judgment, ${result.discarded} discarded.`);
  console.log(`Read: ${result.summaryPath}`);
  if (!result.outcomeGatePassed) process.exitCode = 1;
}

module.exports = {
  archiveAttempt,
  buildCodexArgs,
  buildJobManifest,
  buildNewRunManifest,
  classifyJobExecution,
  classifyJobOutcome,
  compareBuildIdentity,
  codexContractViolation,
  currentBuildIdentity,
  inspectBrowserConsole,
  loadJobs,
  parseAgentSession,
  parseArgs,
  readFindings,
  readJobExecution,
  RUNS_DIR,
  shouldResumeJob,
  verifyRun,
  writeHandoverFiles,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
