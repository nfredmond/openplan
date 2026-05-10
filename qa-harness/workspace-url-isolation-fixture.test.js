const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const harnessPath = path.join(__dirname, 'openplan-local-workspace-url-isolation-smoke.js');

function writeFixture(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openplan-workspace-fixture-'));
  const fixturePath = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
  return fixturePath;
}

function runValidate(fixture) {
  const fixturePath = writeFixture(fixture);
  return spawnSync(process.execPath, [harnessPath, '--fixture', fixturePath, '--validate-fixture'], {
    cwd: __dirname,
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD: 'local-a-password',
      OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD: 'local-b-password',
    },
  });
}

const validFixture = {
  baseUrl: 'http://localhost:3000',
  users: {
    workspaceA: {
      email: 'openplan-workspace-a@example.test',
      passwordEnv: 'OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD',
      workspaceName: 'Synthetic Workspace A',
    },
    workspaceB: {
      email: 'openplan-workspace-b@example.test',
      passwordEnv: 'OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD',
      workspaceName: 'Synthetic Workspace B',
    },
  },
  checks: [
    {
      name: 'Workspace A project detail is visible to A and blocked for B',
      url: '/projects/00000000-0000-4000-8000-0000000000a1',
      allowedUser: 'workspaceA',
      allowedText: 'Synthetic A Project',
      leakText: ['Synthetic A Project', 'Synthetic Workspace A'],
    },
    {
      name: 'Workspace B project detail is visible to B and blocked for A',
      url: '/projects/00000000-0000-4000-8000-0000000000b1',
      allowedUser: 'workspaceB',
      allowedText: 'Synthetic B Project',
      leakText: ['Synthetic B Project', 'Synthetic Workspace B'],
    },
  ],
};

{
  const result = runValidate(validFixture);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Validated 2 synthetic users and 2 workspace URL checks/);
}

{
  const fixture = structuredClone(validFixture);
  delete fixture.checks[0].allowedText;
  const result = runValidate(fixture);
  assert.notStrictEqual(result.status, 0, 'fixture without allowedText should fail validation');
  assert.match(result.stderr, /needs allowedText/);
}

{
  const fixture = structuredClone(validFixture);
  delete fixture.checks[0].leakText;
  const result = runValidate(fixture);
  assert.notStrictEqual(result.status, 0, 'fixture without leakText should fail validation');
  assert.match(result.stderr, /needs leakText/);
}

{
  const fixture = structuredClone(validFixture);
  fixture.users.workspaceAOnly = {
    email: 'openplan-workspace-a-only@example.test',
    passwordEnv: 'OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD',
    workspaceName: 'Synthetic Workspace A',
  };
  fixture.checks = [
    {
      name: 'Workspace A explicit no-op denial is rejected',
      url: '/projects/00000000-0000-4000-8000-0000000000a1',
      allowedUser: 'workspaceA',
      allowedText: 'Synthetic A Project',
      leakText: ['Synthetic A Project', 'Synthetic Workspace A'],
      deniedUsers: ['workspaceAOnly'],
    },
    {
      name: 'Workspace A-only project detail keeps the denied user continuity coverage satisfied',
      url: '/projects/00000000-0000-4000-8000-0000000000a2',
      allowedUser: 'workspaceAOnly',
      allowedText: 'Synthetic A-only Project',
      leakText: ['Synthetic A-only Project', 'Synthetic Workspace A'],
      deniedUsers: ['workspaceA'],
    },
  ];
  const result = runValidate(fixture);
  assert.notStrictEqual(result.status, 0, 'same-workspace deniedUsers should fail validation');
  assert.match(result.stderr, /must target a different workspace/);
}

console.log('workspace URL isolation fixture contract tests passed.');
