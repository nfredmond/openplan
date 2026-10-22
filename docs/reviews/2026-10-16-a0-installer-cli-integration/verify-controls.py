"""Exercise the ordinary connector command and restore its exact source bytes."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

REPO = Path(__file__).resolve().parents[3]
PRIVATE = Path('/home/nathaniel/.local/state/openplan/a0-installer-cli-integration-20261016/controls-01')
SOURCE = REPO / 'workers/planner_agent_connector/connector.mjs'
TEST = REPO / 'workers/planner_agent_connector/test/connector-installer-guidance.test.mjs'
POSITIVE = 'ordinary connector install-check binds each saved provider without native work or connection disclosure'
UNKNOWN = 'ordinary connector keeps undeclared installers unknown and legacy Codex configuration readable'
ARGUMENTS = 'install-check refuses incomplete declarations and write flags before using the connection'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def trial(name, selected=None):
    command = ['node', '--test', '--test-concurrency=1', '--test-reporter=tap']
    if selected:
        command += ['--test-name-pattern', '^' + re.escape(selected) + '$']
    command.append(str(TEST))
    result = subprocess.run(command, cwd=REPO, capture_output=True, timeout=30,
                            env={**os.environ, 'NODE_OPTIONS': '--max-old-space-size=256'})
    output = result.stdout + result.stderr
    log = PRIVATE / (name + '.log')
    with log.open('xb') as file:
        file.write(output)
    log.chmod(0o600)
    return {'label': name, 'exitCode': result.returncode, 'logSHA256': sha(output),
            'allThreePass': bool(re.search(rb'# pass 3\b', output)),
            'intendedAssertion': bool(selected and re.search(
                ('not ok \\d+ - ' + re.escape(selected)).encode(), output)
                and b'ERR_ASSERTION' in output)}


def main():
    PRIVATE.mkdir(mode=0o700, exist_ok=False)
    original = SOURCE.read_bytes()
    test_bytes = TEST.read_bytes()
    receipts = []
    complete = False
    faults = [
        ('command-enrollment', ': command === "install-check" ? ["config", "installer", "npm-root"]',
         ': command === "unavailable-install-check" ? ["config", "installer", "npm-root"]', POSITIVE),
        ('installer-is-literal', 'flags[key] = key === "installer" ? value : resolve(value);',
         'flags[key] = resolve(value);', POSITIVE),
        ('saved-provider', 'provider: config.setup.provider ?? "codex", binaryPath:',
         'provider: "codex", binaryPath:', POSITIVE),
        ('connection-disclosure', 'JSON.stringify(guidance, null, 2)',
         'JSON.stringify({ ...guidance, connection: config }, null, 2)', POSITIVE),
        ('infer-installer', 'installer: flags.installer ?? null, npmGlobalRoot: flags["npm-root"] ?? null',
         'installer: flags.installer ?? "npm", npmGlobalRoot: flags["npm-root"] ?? dirname(dirname(dirname(dirname(config.binaryPath))))', UNKNOWN),
        ('paired-declaration', 'Boolean(flags.installer) !== Boolean(flags["npm-root"])',
         'false', ARGUMENTS),
        ('unsupported-declaration', 'flags.installer && flags.installer !== "npm"',
         'false', ARGUMENTS),
        ('unknown-write-flag', '!allowed.includes(key)', 'false', ARGUMENTS),
        ('duplicate-declaration', 'key in flags', 'false', ARGUMENTS),
        ('unexpected-directory', 'const guidance = await installerGuidance(',
         'await privateConnectorDirectory(join(dirname(flags.config), "unexpected-install-write"));\n    const guidance = await installerGuidance(', POSITIVE),
        ('help-disclosure', 'install-check reads installation metadata without running the provider or an',
         'install-check reads installation metadata and runs the provider and an', ARGUMENTS),
    ]
    try:
        baseline = trial('baseline'); receipts.append(baseline)
        assert baseline['exitCode'] == 0 and baseline['allThreePass'], baseline
        SOURCE.write_bytes(original + b'\n// Harmless comment preserves command behavior.\n')
        harmless = trial('harmless-comment'); receipts.append(harmless)
        assert harmless['exitCode'] == 0 and harmless['allThreePass'], harmless
        SOURCE.write_bytes(original)
        for name, before, after, selected in faults:
            source = original.decode()
            assert source.count(before) == 1, (name, 'source anchor')
            try:
                SOURCE.write_text(source.replace(before, after))
                receipt = trial(name, selected); receipts.append(receipt)
                assert receipt['exitCode'] != 0 and receipt['intendedAssertion'], receipt
            finally:
                SOURCE.write_bytes(original)
                assert SOURCE.read_bytes() == original, (name, 'restoration')
        restored = trial('restored'); receipts.append(restored)
        assert restored['exitCode'] == 0 and restored['allThreePass'], restored
        assert TEST.read_bytes() == test_bytes, 'test changed during campaign'
        complete = True
    finally:
        SOURCE.write_bytes(original)
        restored_bytes = SOURCE.read_bytes() == original and TEST.read_bytes() == test_bytes
        report = {'complete': complete, 'trials': receipts, 'restored': restored_bytes,
                  'sourceSHA256': sha(original), 'testSHA256': sha(test_bytes),
                  'blindCategories': ['native binary compatibility and provider/account operation',
                    'authenticating an operator installer declaration', 'executing an update',
                    'browser UI', 'concurrent hostile filesystem changes',
                    'kernel-level observation of every file read or network syscall']}
        with (PRIVATE / 'controls.json').open('x') as file:
            json.dump(report, file, indent=2); file.write('\n')
        (PRIVATE / 'controls.json').chmod(0o600)
        assert restored_bytes, 'exact restoration failed'
    print(json.dumps({'complete': complete, 'trials': len(receipts),
                      'harmlessSurvivors': 1, 'namedFaults': len(faults), 'restored': True}))


if __name__ == '__main__':
    os.umask(0o077)
    main()
