/**
 * The discovery runner's interruption contract. These checks do not launch a
 * browser or an agent. They prove that the runner distinguishes a completed
 * journey from quota exhaustion, server loss, timeout, and a missing report,
 * then preserves the old attempt when the job resumes.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  archiveAttempt,
  buildCodexArgs,
  buildJobManifest,
  buildNewRunManifest,
  classifyJobExecution,
  classifyJobOutcome,
  codexContractViolation,
  currentBuildIdentity,
  loadJobs,
  parseAgentSession,
  parseArgs,
  readFindings,
  RUNS_DIR,
  shouldResumeJob,
  verifyRun,
} = require('./first-week-discovery');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

function jobDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'first-week-discovery-'));
}

function writeCompletedJob(dir) {
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent', 'findings.json'), JSON.stringify({ outcomeReached: 'yes', findings: [] }));
  fs.writeFileSync(
    path.join(dir, 'agent-stdout.json'),
    JSON.stringify({ subtype: 'success', is_error: false, num_turns: 12, result: 'Finished.' }),
  );
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'completed', reason: 'The agent completed and left a findings report.' }),
  );
}

console.log('first-week discovery interruption and resume rules');

check('the actual Claude quota shape is blocked, even though it says success and exits zero', () => {
  const stdout = JSON.stringify({
    subtype: 'success',
    is_error: true,
    num_turns: 1,
    result: "You've hit your session limit · resets 11:50pm (America/Los_Angeles)",
  });
  const session = parseAgentSession(stdout);
  const result = classifyJobExecution({ processResult: { code: 0, stdout }, session, reportPresent: false });
  assert.strictEqual(result.status, 'blocked_quota');
});

check('the weekly-limit 429 returned by the live run is blocked, even though Claude exits one', () => {
  const stdout = JSON.stringify({
    subtype: 'success',
    is_error: true,
    api_error_status: 429,
    num_turns: 1,
    result: "You've hit your weekly limit · resets 1pm (America/Los_Angeles)",
  });
  const session = parseAgentSession(stdout);
  const result = classifyJobExecution({ processResult: { code: 1, stdout }, session, reportPresent: false });
  assert.strictEqual(result.status, 'blocked_quota');
});

check('product page text that mentions a rate limit is not agent quota evidence', () => {
  const stdout = JSON.stringify({
    type: 'item.completed',
    item: { type: 'mcp_tool_call', result: { text: 'Workspace AI rate limit protects operator spend.' } },
  });
  const result = classifyJobExecution({
    processResult: { code: 0, stdout },
    session: null,
    reportPresent: true,
  });
  assert.strictEqual(result.status, 'completed');
});

check('server loss is blocked instead of becoming a no-report result', () => {
  const result = classifyJobExecution({
    processResult: { code: 0, stdout: '' },
    session: { subtype: 'success', is_error: false },
    reportPresent: false,
    serverAvailableAfter: false,
  });
  assert.strictEqual(result.status, 'blocked_server');
});

check('a killed wall-clock timeout is blocked', () => {
  const result = classifyJobExecution({
    processResult: { code: null, signal: 'SIGKILL' },
    session: null,
    reportPresent: false,
  });
  assert.strictEqual(result.status, 'blocked_timeout');
});

check('a clean agent exit with no report is unfinished, not completed', () => {
  const result = classifyJobExecution({
    processResult: { code: 0 },
    session: { subtype: 'success', is_error: false },
    reportPresent: false,
  });
  assert.strictEqual(result.status, 'blocked_unfinished_report');
});

check('a clean agent exit with a report is completed', () => {
  const result = classifyJobExecution({
    processResult: { code: 0 },
    session: { subtype: 'success', is_error: false },
    reportPresent: true,
  });
  assert.strictEqual(result.status, 'completed');
});

check('only a completed journey that reached its outcome passes the outcome gate', () => {
  const execution = { status: 'completed' };
  assert.strictEqual(classifyJobOutcome({ execution, report: { outcomeReached: 'yes' } }).status, 'passed');
  assert.strictEqual(classifyJobOutcome({ execution, report: { outcomeReached: 'partly' } }).status, 'failed');
  assert.strictEqual(classifyJobOutcome({ execution, report: { outcomeReached: 'no' } }).status, 'failed');
  assert.strictEqual(
    classifyJobOutcome({ execution: { status: 'blocked_quota' }, report: { outcomeReached: 'yes' } }).status,
    'inconclusive',
  );
});

check('resume skips a reached outcome and retries blocked or partly reached jobs', () => {
  const completed = jobDir();
  writeCompletedJob(completed);
  assert.strictEqual(shouldResumeJob(completed), false);

  const blocked = jobDir();
  fs.writeFileSync(path.join(blocked, 'execution.json'), JSON.stringify({ status: 'blocked_quota' }));
  assert.strictEqual(shouldResumeJob(blocked), true);

  const partly = jobDir();
  writeCompletedJob(partly);
  fs.writeFileSync(
    path.join(partly, 'agent', 'findings.json'),
    JSON.stringify({ outcomeReached: 'partly', findings: [] }),
  );
  assert.strictEqual(shouldResumeJob(partly), true);
});

check('resuming archives the old attempt without deleting any evidence', () => {
  const dir = jobDir();
  fs.mkdirSync(path.join(dir, 'agent', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent', 'findings.json'), '{"findings":[]}');
  fs.writeFileSync(path.join(dir, 'agent', 'evidence', 'blocked.png'), 'old screenshot');
  fs.writeFileSync(path.join(dir, 'execution.json'), '{"status":"blocked_quota"}');
  const archived = archiveAttempt(dir, 'attempt-2');
  assert.ok(fs.existsSync(path.join(archived, 'agent', 'findings.json')));
  assert.ok(fs.existsSync(path.join(archived, 'agent', 'evidence', 'blocked.png')));
  assert.ok(fs.existsSync(path.join(archived, 'execution.json')));
  assert.deepStrictEqual(fs.readdirSync(dir), ['attempts']);
});

check('the summary counts a quota stop as blocked and names it as resumable', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '03-public-engagement');
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id: '03-public-engagement', title: 'Public engagement' }));
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'blocked_quota', reason: 'The agent service quota was exhausted before the journey finished.' }),
  );
  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.blocked, 1);
  assert.strictEqual(result.completed, 0);
  assert.strictEqual(result.inconclusive, 1);
  assert.strictEqual(result.outcomeGatePassed, false);
  const summary = fs.readFileSync(result.summaryPath, 'utf8');
  assert.match(summary, /Run status: \*\*blocked_quota\*\*/);
  assert.match(summary, /unfinished and may be resumed/);
  assert.doesNotMatch(summary, /No report/);
});

check('the summary fails its outcome gate when a completed journey is only partly reached', () => {
  const runRoot = jobDir();
  const reachedDir = path.join(runRoot, '01-first-day-setup');
  const partlyDir = path.join(runRoot, '02-project-end-to-end');
  writeCompletedJob(reachedDir);
  writeCompletedJob(partlyDir);
  fs.writeFileSync(
    path.join(partlyDir, 'agent', 'findings.json'),
    JSON.stringify({ outcomeReached: 'partly', findings: [] }),
  );

  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.completed, 2);
  assert.strictEqual(result.reached, 1);
  assert.strictEqual(result.partlyReached, 1);
  assert.strictEqual(result.notReached, 0);
  assert.strictEqual(result.outcomeGatePassed, false);
  const summary = fs.readFileSync(result.summaryPath, 'utf8');
  assert.match(summary, /Planner outcomes partly reached: \*\*1\*\*/);
  assert.match(summary, /Outcome gate: \*\*FAILED\*\*/);
});

check('the summary passes its outcome gate when every completed journey reached its outcome', () => {
  const runRoot = jobDir();
  writeCompletedJob(path.join(runRoot, '01-first-day-setup'));
  writeCompletedJob(path.join(runRoot, '02-project-end-to-end'));

  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.reached, 2);
  assert.strictEqual(result.outcomeGatePassed, true);
  assert.match(fs.readFileSync(result.summaryPath, 'utf8'), /Outcome gate: \*\*PASSED\*\*/);
  assert.match(
    fs.readFileSync(result.summaryPath, 'utf8'),
    /Evidence-complete claims awaiting product judgment/,
  );
  assert.doesNotMatch(fs.readFileSync(result.summaryPath, 'utf8'), /Confirmed findings/);
});

check('a selected job missing from disk is inconclusive instead of disappearing from the gate', () => {
  const runRoot = jobDir();
  fs.writeFileSync(
    path.join(runRoot, 'run.json'),
    JSON.stringify({ jobs: ['01-first-day-setup', '02-project-end-to-end'] }),
  );
  writeCompletedJob(path.join(runRoot, '01-first-day-setup'));

  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.reached, 1);
  assert.strictEqual(result.inconclusive, 1);
  assert.strictEqual(result.outcomeGatePassed, false);
});

check('verify-only exits nonzero for partly reached outcomes and zero when all are reached', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '02-project-end-to-end');
  writeCompletedJob(dir);
  fs.writeFileSync(
    path.join(dir, 'agent', 'findings.json'),
    JSON.stringify({ outcomeReached: 'partly', findings: [] }),
  );
  const env = { ...process.env, OPENPLAN_BASE_URL: 'http://localhost:3200' };

  const failed = spawnSync(process.execPath, [path.join(__dirname, 'first-week-discovery.js'), '--verify-only', runRoot], {
    env,
    encoding: 'utf8',
  });
  assert.strictEqual(failed.status, 1, failed.stderr || failed.stdout);

  fs.writeFileSync(
    path.join(dir, 'agent', 'findings.json'),
    JSON.stringify({ outcomeReached: 'yes', findings: [] }),
  );
  const passed = spawnSync(process.execPath, [path.join(__dirname, 'first-week-discovery.js'), '--verify-only', runRoot], {
    env,
    encoding: 'utf8',
  });
  assert.strictEqual(passed.status, 0, passed.stderr || passed.stdout);
});

check('verification repairs a recorded generic failure when stdout proves the job hit quota', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '04-safety-case');
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id: '04-safety-case', title: 'Safety case' }));
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'failed', reason: 'The agent process failed with exit 1.', exitCode: 1 }),
  );
  fs.writeFileSync(
    path.join(dir, 'agent-stdout.json'),
    JSON.stringify({
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result: "You've hit your weekly limit · resets 1pm (America/Los_Angeles)",
    }),
  );
  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.blocked, 1);
  assert.strictEqual(result.failed, 0);
  assert.match(fs.readFileSync(result.summaryPath, 'utf8'), /blocked_quota/);
});

check('verification repairs a false recorded quota when only browser page text contains the phrase', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '03-public-engagement');
  writeCompletedJob(dir);
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'blocked_quota', reason: 'quota', exitCode: 0, backend: 'codex' }),
  );
  fs.writeFileSync(
    path.join(dir, 'agent-stdout.json'),
    `${JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', result: 'AI rate limit' } })}\n`,
  );
  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.completed, 1);
  assert.strictEqual(result.blocked, 0);
});

check('a one-layer JSON string is decoded, while a non-report string stays unfinished', () => {
  const wrappedDir = jobDir();
  fs.mkdirSync(wrappedDir, { recursive: true });
  const report = { job: 'x', outcomeReached: 'partly', whatIDid: 'Worked.', findings: [] };
  fs.writeFileSync(path.join(wrappedDir, 'findings.json'), JSON.stringify(JSON.stringify(report)));
  assert.deepStrictEqual(readFindings(wrappedDir), report);

  const invalidDir = jobDir();
  fs.writeFileSync(path.join(invalidDir, 'findings.json'), JSON.stringify('not a report'));
  assert.strictEqual(readFindings(invalidDir), null);
});

check('the command line accepts a resume directory', () => {
  assert.deepStrictEqual(parseArgs(['--resume', 'first-week-runs/a', '--job=04-safety-case']), {
    jobs: ['04-safety-case'],
    list: false,
    verifyOnly: null,
    resume: 'first-week-runs/a',
  });
});

check('the governed handoff job declares its second identity and the archive-reader seam stays explicit', () => {
  const jobs = loadJobs();
  const governed = jobs.find((job) => job.id === '10-governed-decision-handoff');
  const bundle = jobs.find((job) => job.id === '09-project-evidence-bundle');
  assert.strictEqual(governed?.requiresApprover, true);
  assert.match(governed?.body || '', /\{\{APPROVER_EMAIL\}\}/);
  assert.match(governed?.body || '', /two distinct people/i);
  assert.match(bundle?.body || '', /harness capability limit,[\s\S]*not an OpenPlan[\s\S]*product finding/i);
  assert.match(bundle?.body || '', /separate required[\s\S]*repository gate/i);
});

check('the model-validation job treats an honest inconclusive assessment as a reached outcome', () => {
  const validation = loadJobs().find((job) => job.id === '11-model-validation-evidence');
  assert.ok(validation);
  assert.match(validation.body, /An honest `inconclusive` outcome fully satisfies this job/);
  assert.match(validation.body, /validation evidence write failed/);
  assert.match(validation.body, /ActivitySim[\s\S]*separate[\s\S]*AequilibraE/i);
  assert.match(validation.body, /visible navigation/i);
});

check('new first-week manifests can bind the exact checkout and app version', () => {
  const identity = currentBuildIdentity();
  const appPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openplan', 'package.json'), 'utf8'));
  assert.match(identity.gitSha, /^[0-9a-f]{40}$/);
  assert.strictEqual(identity.appVersion, appPackage.version);

  const job = { id: '11-model-validation-evidence', title: 'Validation', account: 'run' };
  const runManifest = buildNewRunManifest({
    createdAt: '2026-08-28T00:00:00.000Z',
    baseUrl: 'http://localhost:3200',
    model: 'sonnet',
    backend: 'claude',
    jobs: [job.id],
    freshAccount: { email: 'planner@example.test', password: 'test-only' },
    build: identity,
  });
  const jobManifest = buildJobManifest({
    job,
    email: 'planner@example.test',
    approverEmail: null,
    model: 'sonnet',
    backend: 'claude',
    build: identity,
  });
  assert.deepStrictEqual(runManifest.build, identity);
  assert.deepStrictEqual(jobManifest.build, identity);
});

check('new run directories live outside the repository', () => {
  assert.ok(
    !RUNS_DIR.startsWith(`${path.resolve(__dirname)}${path.sep}`),
    `fresh agents would work inside the repository at ${RUNS_DIR}`,
  );
});

check('the Codex fallback isolates user context and exposes the browser MCP', () => {
  const args = buildCodexArgs({ agentDir: '/tmp/agent', browserDir: '/tmp/browser' });
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('--approve-for-me'));
  assert.ok(!args.includes('--sandbox'), '--approve-for-me and --sandbox are mutually exclusive in this Codex CLI');
  assert.ok(args.some((arg) => arg === 'mcp_servers.browser.command="npx"'));
  assert.ok(args.some((arg) => arg.includes('@playwright/mcp@0.0.79')));
});

check('a Codex journey that uses shell or web search violates the fresh-browser contract', () => {
  const command = JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'rg routes' } });
  const search = JSON.stringify({ type: 'item.started', item: { type: 'web_search', query: 'OpenPlan routes' } });
  const browser = JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'browser' } });
  assert.match(codexContractViolation(command), /shell command/);
  assert.match(codexContractViolation(search), /web search/);
  assert.strictEqual(codexContractViolation(browser), null);
});

console.log(failures === 0 ? '\nInterruption states are durable and resumable.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
