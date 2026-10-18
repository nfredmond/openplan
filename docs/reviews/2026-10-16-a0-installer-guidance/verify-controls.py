"""Prove installer guidance refuses specific faults; restore exact source bytes."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

REPO = Path(__file__).resolve().parents[3]
PRIVATE = Path('/home/nathaniel/.local/state/openplan/a0-installer-guidance-20261016/controls-02')
LIB = REPO/'workers/planner_agent_connector/installer-guidance.mjs'
CLI = REPO/'workers/planner_agent_connector/installer-guidance-cli.mjs'
TEST = REPO/'workers/planner_agent_connector/test/installer-guidance.test.mjs'
POSITIVE = 'npm entry guidance pins all providers without executing or changing files'
DECLARATION = 'installer and platform need explicit supported declarations'
BINARY = 'a declared global root must own the exact selected binary'
ENTRY = 'package entries cannot escape their declared package'
METADATA = 'metadata must be bounded regular provider metadata'
LINK = 'linked package metadata does not produce an update command'
ARGS = 'CLI enforces complete unique flags and emits safe metadata only'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def trial(name, test=None):
    command = ['node', '--test', '--test-concurrency=1', '--test-reporter=tap']
    if test:
        command += ['--test-name-pattern', '^'+re.escape(test)+'$']
    command.append(str(TEST))
    result = subprocess.run(command, cwd=REPO, capture_output=True, timeout=30,
                            env={**os.environ, 'NODE_OPTIONS':'--max-old-space-size=256'})
    output = result.stdout+result.stderr
    log = PRIVATE/(name+'.log')
    with log.open('xb') as f:
        f.write(output)
    log.chmod(0o600)
    return {'label':name, 'exitCode':result.returncode, 'logSHA256':sha(output),
            'passed':bool(re.search(rb'# pass 8\b',output)),
            'intendedAssertion':bool(test and re.search(('not ok \\d+ - '+re.escape(test)).encode(),output)
                                     and b'ERR_ASSERTION' in output)}


def main():
    original = {p:p.read_bytes() for p in [LIB,CLI,TEST]}
    receipts = []
    try:
        baseline = trial('controls-baseline'); receipts.append(baseline)
        assert baseline['exitCode']==0 and baseline['passed'],baseline
        for path in [LIB,CLI]:
            path.write_bytes(original[path]+b'\n// Harmless comment leaves discovery and commands unchanged.\n')
            harmless=trial('harmless-'+path.stem);receipts.append(harmless)
            assert harmless['exitCode']==0 and harmless['passed'],harmless
            path.write_bytes(original[path])
        faults = [
          ('pin-version',LIB,'`${PACKAGES[provider]}@${record.version}`','`${PACKAGES[provider]}@latest`',POSITIVE,'behavior'),
          ('owning-prefix',LIB,'"--prefix", dirname(dirname(root)),','', 'npm command stays in the inspected global prefix','behavior'),
          ('npm-layout',LIB,'basename(dirname(root)) !== "lib"','false', 'npm command stays in the inspected global prefix','behavior'),
          ('installer-declaration',LIB,'if (installer !== "npm")','if (false)',DECLARATION,'behavior'),
          ('platform',LIB,'if (platform !== "linux")','if (false)',DECLARATION,'behavior'),
          ('binary-entry',LIB,'resolvedEntry !== await realpath(binaryPath)','false',BINARY,'behavior'),
          ('entry-boundary',LIB,'!within(packagePath, resolvedEntry)','false',ENTRY,'behavior'),
          ('metadata-size',LIB,'stat.size > 65_536','false',METADATA,'diagnostic; secondary read-size guard still refuses'),
          ('metadata-provider',LIB,'metadata.name !== PACKAGES[provider]','false',METADATA,'behavior'),
          ('metadata-symlink',LIB,'constants.O_NOFOLLOW','0',LINK,'behavior'),
          ('duplicate-flags',CLI,'Object.hasOwn(flags, key)','false',ARGS,'behavior'),
          ('unknown-flags',CLI,'!["--provider", "--binary", "--installer", "--npm-root"].includes(key)','false',ARGS,'behavior'),
          ('execute-binary',LIB,'const record = testedCliRecord(provider);',
           'const record = testedCliRecord(provider);\n  (await import("node:child_process")).execFileSync(binaryPath, [], { env: { PATH: "/usr/bin:/bin" } });',POSITIVE,'behavior; only synthetic fixture shell binary executes'),
        ]
        for name,path,before,after,test,scope in faults:
            source=original[path].decode();assert source.count(before)==1,(name,'anchor')
            try:
                path.write_text(source.replace(before,after))
                receipt=trial(name,test);receipt['scope']=scope;receipts.append(receipt)
                assert receipt['exitCode']!=0 and receipt['intendedAssertion'],receipt
            finally:
                path.write_bytes(original[path])
                assert path.read_bytes()==original[path],(name,'restoration')
        restored=trial('controls-restored');receipts.append(restored)
        assert restored['exitCode']==0 and restored['passed'],restored
    finally:
        for path,data in original.items():
            path.write_bytes(data)
            assert path.read_bytes()==data,(str(path),'restoration')
        report={'trials':receipts,'restoredSHA256':{str(p.relative_to(REPO)):sha(data) for p,data in original.items()},
                'blindCategories':['actual package-manager ownership beyond operator declaration',
                  'native binary version or compatibility','provider/account/model operation',
                  'executing an update command','planner browser UI','other installers and platforms',
                  'concurrent hostile filesystem changes']}
        with (PRIVATE/'controls.json').open('x') as f:
            json.dump(report,f,indent=2);f.write('\n')
        (PRIVATE/'controls.json').chmod(0o600)
    print(json.dumps({'trials':len(receipts),'harmlessSurvivors':2,'namedFaults':len(faults),'restored':True}))


if __name__=='__main__':
    os.umask(0o077)
    main()
