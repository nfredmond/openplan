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
 * being measured. That is also why this layer is not a gate and does not fail
 * the build — it produces a work-list, and work-lists are read by people. The
 * things it confirms get turned into `first-week-regressions/`, which IS
 * deterministic, and which is what keeps a fixed problem fixed.
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
 * WHAT IT COSTS. One agent session per job against your Claude subscription; no
 * API key, no metered spend. Runs are sequential — one browser at a time, and
 * usage limits are real.
 *
 * USAGE
 *   OPENPLAN_BASE_URL=http://localhost:3200 \
 *   OPENPLAN_FIRST_WEEK_EMAIL=mapaudit@openplan.test \
 *   OPENPLAN_FIRST_WEEK_PASSWORD='…' \
 *   npm run first-week-discovery                        # every job
 *   ... npm run first-week-discovery -- --job 03-public-engagement
 *   ... npm run first-week-discovery -- --resume first-week-runs/<stamp>
 *   ... npm run first-week-discovery -- --list
 *   npm run first-week-discovery -- --verify-only first-week-runs/<stamp>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { assertLocalTargetUrl } = require('./harness-env');
const { verifyJobReport } = require('./first-week-evidence');

const JOBS_DIR = path.join(__dirname, 'first-week-jobs');
const RUNS_DIR = path.join(__dirname, 'first-week-runs');
const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.79';
const DEFAULT_MODEL = 'sonnet';
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const SERVER_PROBE_TIMEOUT_MS = 10 * 1000;
const BLOCKED_STATUSES = new Set([
  'blocked_quota',
  'blocked_server',
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
        files: meta.files || 'none',
        maxTurns: Number(meta.maxTurns) > 0 ? Number(meta.maxTurns) : 90,
        body: match[2].trim(),
      };
    });
}

/**
 * The folder "your predecessor left you". Nothing here names a real place: the
 * geometry sits at 0°N 0°E for the same reason `fixtures/provision.js` puts it
 * there — an anchor that is obviously nowhere can never be mistaken for
 * somewhere once it reaches a screenshot.
 */
function writeHandoverFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const corridor = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Example Corridor', jurisdiction: 'Example County' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.01, 0.004],
            [0.02, 0.006],
            [0.031, 0.012],
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
        properties: { name: 'Example Study Area' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-0.01, -0.01],
              [0.04, -0.01],
              [0.04, 0.03],
              [-0.01, 0.03],
              [-0.01, -0.01],
            ],
          ],
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

  fs.writeFileSync(path.join(dir, 'corridor.geojson'), `${JSON.stringify(corridor, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'study-area.geojson'), `${JSON.stringify(studyArea, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'projects.csv'), `${projects}\n`);
}

function buildPrompt(job, { baseUrl, email, password, agentDir, contract }) {
  const body = job.body
    .replace(/\{\{BASE_URL\}\}/g, baseUrl)
    .replace(/\{\{EMAIL\}\}/g, email)
    .replace(/\{\{PASSWORD\}\}/g, password);

  return [
    'You are doing a real job in a real piece of software, using the browser you have been given.',
    'You have never seen this software before and there is no documentation. That is intentional.',
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

function runAgent({ job, agentDir, browserDir, prompt, model, timeoutMs }) {
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

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseAgentSession(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function agentResultText(session, processResult) {
  return [session?.result, processResult?.stdout, processResult?.stderr]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

/**
 * Classify how a job ended separately from what the planner found. Claude can
 * return exit 0 and subtype "success" for a subscription limit, so process
 * status alone is not evidence that the job ran.
 */
function classifyJobExecution({ processResult = {}, session = null, reportPresent = false, serverAvailableAfter = true }) {
  const resultText = agentResultText(session, processResult);
  if (/session limit|usage limit|rate limit|quota/i.test(resultText)) {
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
  if (recorded?.status) return recorded;

  const stdoutPath = path.join(jobDir, 'agent-stdout.json');
  const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  const session = parseAgentSession(stdout);
  const reportPresent = readFindings(path.join(jobDir, 'agent')) !== null;
  return classifyJobExecution({ processResult: { code: 0, stdout }, session, reportPresent });
}

function shouldResumeJob(jobDir) {
  if (!fs.existsSync(jobDir)) return true;
  return readJobExecution(jobDir).status !== 'completed';
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
  const direct = readJsonIfPresent(path.join(agentDir, 'findings.json'));
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
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function renderJobMarkdown(job, verdict) {
  const lines = [`## ${job.id} — ${job.title}`, ''];
  lines.push(`- Outcome reached: **${verdict.outcomeReached ?? 'not stated'}**`);
  lines.push(`- Confirmed findings: **${verdict.confirmed.length}**`);
  lines.push(`- Discarded findings: **${verdict.discarded.length}**`);
  lines.push(`- Snapshots the browser recorded: ${verdict.browserDumps}`);
  if (verdict.execution) lines.push(`- Run status: **${verdict.execution.status}**. ${verdict.execution.reason}`);
  if (verdict.ending) lines.push(`- The session ${verdict.ending}.`);
  if (verdict.whatIDid) lines.push('', `**What it did.** ${verdict.whatIDid}`);
  if (verdict.whatWouldHaveHelped) lines.push('', `**What would have helped.** ${verdict.whatWouldHaveHelped}`);

  if (verdict.confirmed.length) {
    lines.push('', '### Confirmed — evidence checked out', '');
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
  const jobDirs = fs
    .readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sections = [];
  let confirmed = 0;
  let discarded = 0;
  let completed = 0;
  let blocked = 0;
  let failed = 0;

  for (const jobDir of jobDirs) {
    const dir = path.join(runRoot, jobDir);
    const agentDir = path.join(dir, 'agent');
    const browserDir = path.join(dir, 'browser');
    if (!fs.existsSync(agentDir)) continue;

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
      ? 'did not start an agent session'
      : session.subtype !== 'success'
        ? `ended \`${session.subtype}\` after ${session.num_turns ?? '?'} steps`
        : `returned \`${session.subtype}\` after ${session.num_turns ?? '?'} steps`;
    const report = readFindings(agentDir);

    if (!report) {
      sections.push(
        [
          `## ${meta.id} — ${meta.title}`,
          '',
          `- Run status: **${execution.status}**. ${execution.reason}`,
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
    confirmed += verdict.confirmed.length;
    discarded += verdict.discarded.length;

    fs.writeFileSync(path.join(dir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
    sections.push(renderJobMarkdown(meta, verdict));
  }

  const summary = [
    '# First-week harness — discovery run',
    '',
    `- Target: ${baseUrl}`,
    `- Run directory: ${runRoot}`,
    `- Confirmed findings: **${confirmed}**`,
    `- Discarded findings: **${discarded}**`,
    `- Completed jobs: **${completed}**`,
    `- Blocked jobs: **${blocked}**`,
    `- Failed jobs: **${failed}**`,
    '',
    'A confirmed finding means the screenshot and page snapshot support what the agent said.',
    'It does not mean the behaviour is wrong — that judgement is yours. A discarded finding',
    'was contradicted by its own evidence or had none, and is not a work item.',
    '',
    ...sections,
  ].join('\n');

  fs.writeFileSync(path.join(runRoot, 'summary.md'), `${summary}\n`);
  return { confirmed, discarded, completed, blocked, failed, summaryPath: path.join(runRoot, 'summary.md') };
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
    console.log(`\n${result.confirmed} confirmed, ${result.discarded} discarded. ${result.summaryPath}`);
    if (result.blocked || result.failed) process.exitCode = 1;
    return;
  }

  let selected = args.jobs.length ? jobs.filter((job) => args.jobs.includes(job.id)) : jobs;
  if (!selected.length) {
    console.error(`No job matched ${args.jobs.join(', ')}. Run with --list.`);
    process.exit(2);
  }

  const existingEmail = (process.env.OPENPLAN_FIRST_WEEK_EMAIL || '').trim();
  const existingPassword = (process.env.OPENPLAN_FIRST_WEEK_PASSWORD || '').trim();
  if (selected.some((job) => job.account === 'existing') && (!existingEmail || !existingPassword)) {
    console.error(
      'OPENPLAN_FIRST_WEEK_EMAIL and OPENPLAN_FIRST_WEEK_PASSWORD are required for jobs that start signed in.',
    );
    process.exit(2);
  }

  const model = (process.env.OPENPLAN_FIRST_WEEK_MODEL || DEFAULT_MODEL).trim();
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
  const manifest = existingManifest || {
    createdAt: new Date().toISOString(),
    baseUrl,
    model,
    jobs: selected.map((job) => job.id),
    freshAccount: generatedFreshAccount,
  };
  const runHasFreshAccountCreator = jobs.some(
    (job) => job.account === 'fresh-run' && Array.isArray(manifest.jobs) && manifest.jobs.includes(job.id),
  );
  if (
    selected.some((job) => job.account === 'run') &&
    !runHasFreshAccountCreator &&
    (!existingEmail || !existingPassword)
  ) {
    console.error(
      'A run-account job selected by itself needs OPENPLAN_FIRST_WEEK_EMAIL and OPENPLAN_FIRST_WEEK_PASSWORD, or a run manifest that includes the fresh-account setup job.',
    );
    process.exit(2);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const contract = fs.readFileSync(path.join(JOBS_DIR, '_reporting-contract.md'), 'utf8');

  console.log(`First-week discovery against ${baseUrl}`);
  console.log(`Model: ${model}. Jobs: ${selected.map((j) => j.id).join(', ')}`);
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
    const email = useRunAccount
      ? manifest.freshAccount.email
      : job.account === 'new'
        ? `first-week-${stamp.slice(0, 19).toLowerCase()}-${job.id}@openplan.test`
        : existingEmail;
    const password = useRunAccount
      ? manifest.freshAccount.password
      : job.account === 'new'
        ? 'FirstWeek!2026'
        : existingPassword;

    fs.writeFileSync(
      path.join(dir, 'job.json'),
      `${JSON.stringify({ id: job.id, title: job.title, account: job.account, email, model }, null, 2)}\n`,
    );

    const prompt = buildPrompt(job, { baseUrl, email, password, agentDir, contract });
    fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);

    process.stdout.write(`▶ ${job.id} — ${job.title}\n`);
    if (!(await serverIsAvailable(baseUrl))) {
      const execution = {
        status: 'blocked_server',
        reason: 'The target OpenPlan server did not answer the preflight health check.',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(dir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
      process.stdout.write('  BLOCKED: target server is unavailable; safe to resume later\n');
      continue;
    }

    const startedAt = new Date().toISOString();
    const result = await runAgent({ job, agentDir, browserDir, prompt, model, timeoutMs });
    fs.writeFileSync(path.join(dir, 'agent-stdout.json'), result.stdout);
    if (result.stderr) fs.writeFileSync(path.join(dir, 'agent-stderr.log'), result.stderr);
    const session = parseAgentSession(result.stdout);
    const execution = {
      ...classifyJobExecution({
        processResult: result,
        session,
        reportPresent: readFindings(agentDir) !== null,
        serverAvailableAfter: await serverIsAvailable(baseUrl),
      }),
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: result.code,
      signal: result.signal,
      durationMs: result.durationMs,
      agentSubtype: session?.subtype ?? null,
      agentTurns: session?.num_turns ?? null,
    };
    fs.writeFileSync(path.join(dir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
    process.stdout.write(
      `  ${execution.status} in ${Math.round(result.durationMs / 1000)}s (exit ${result.code}${result.signal ? `, ${result.signal}` : ''})\n`,
    );
  }

  const result = verifyRun(runRoot, baseUrl);
  console.log(`\n${result.confirmed} confirmed, ${result.discarded} discarded.`);
  console.log(`Read: ${result.summaryPath}`);
  if (result.blocked || result.failed) process.exitCode = 1;
}

module.exports = {
  archiveAttempt,
  classifyJobExecution,
  loadJobs,
  parseAgentSession,
  parseArgs,
  readJobExecution,
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
