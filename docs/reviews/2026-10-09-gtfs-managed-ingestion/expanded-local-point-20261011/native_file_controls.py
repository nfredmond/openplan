"""Corrupt only a copied retained archive, then restore it in finally."""
import json,os,secrets,shutil,subprocess
from pathlib import Path
import run as r
from verify_final_resume import verify_files
OUT=Path(__file__).parent

def main():
    os.umask(0o077);point=OUT/'source-point-private';restored=OUT/'target-restored-private'/point.relative_to('/');archive=next((restored/'gtfs-capacity').glob('*/version-*/source/archive.zip'));original_sha=r.files.digest(archive);control=OUT/'copied-file-control-private';control.mkdir(mode=0o700);copy=control/'archive.zip';shutil.copy2(archive,copy);baseline=r.files.inventory(control);verify_files(baseline,r.files.inventory(control),set())
    first=copy.open('rb').read(1);refused=False
    try:
        with copy.open('r+b') as stream:stream.write(bytes([first[0]^255]));stream.flush();os.fsync(stream.fileno())
        try:verify_files(baseline,r.files.inventory(control),set())
        except ValueError as error:r.s.require(str(error)=='expanded-final-unrelated-file','expanded-control-refusal');refused=True
        r.s.require(refused,'expanded-control-corruption-survived')
    finally:
        with copy.open('r+b') as stream:stream.write(first);stream.flush();os.fsync(stream.fileno())
    verify_files(baseline,r.files.inventory(control),set());r.s.require(r.files.digest(archive)==original_sha,'expanded-control-target-changed')
    wrong=OUT/'wrong-restic-password-private';wrong.write_text(secrets.token_hex(32));wrong.chmod(0o600)
    env={k:v for k,v in os.environ.items() if not k.startswith('RESTIC_')};env.update(GOMAXPROCS='1',GOMEMLIMIT='384MiB')
    result=subprocess.run([str(r.TOOL),'--no-cache','--repo',str(OUT/'repository-private'),'--password-file',str(wrong),'snapshots','--json'],env=env,capture_output=True,timeout=30);(OUT/'wrong-restic-password-private.log').write_bytes(result.stdout+result.stderr);r.s.require(result.returncode!=0,'expanded-control-password-survived')
    record={'baselineActualCopyPassed':True,'actualOneByteCorruptionRefused':True,'restoredActualCopyPassed':True,'exactTargetArchiveUnchanged':True,'wrongCurrentSnapshotPasswordRefused':True,'wrongPasswordExitCode':result.returncode,'limits':'Only a separate archive copy mutates; restored in finally. Original, captured and target roots remain unchanged. Wrong password uses read-only repository operation. Pure omitted-guard checks are retained separately.'};(OUT/'native-file-controls.json').write_text(json.dumps(record,indent=2)+'\n');print(record)
if __name__=='__main__':main()
