import os,signal,subprocess,time
from pathlib import Path

def run_bounded(args,cwd,env,log_path,timeout):
    start=time.monotonic();reason=None
    with Path(log_path).open("w") as log:
        process=subprocess.Popen(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            while process.poll() is None:
                with Path(log_path).open("rb") as check:
                    check.seek(max(0,Path(log_path).stat().st_size-8192));tail=check.read()
                if b"\nFATAL ERROR:" in tail: reason="fatal-worker-error"
                elif time.monotonic()-start>timeout: reason="deadline"
                if reason:
                    os.killpg(process.pid,signal.SIGTERM)
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid,signal.SIGKILL);process.wait()
                    break
                time.sleep(0.1)
            return process.returncode,reason
        finally:
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=5)
