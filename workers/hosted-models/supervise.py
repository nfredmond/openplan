"""Keep both pollers on one private volume and fail when either disappears."""
import signal
import subprocess
import time


def supervise(commands, *, grace_seconds=20):
    children = []
    stopping = False
    previous = {}

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGTERM, signal.SIGINT):
        previous[signum] = signal.signal(signum, stop)
    try:
        for command, directory in commands:
            children.append(subprocess.Popen(command, cwd=directory))
        while not stopping:
            if any(child.poll() is not None for child in children):
                print("OpenPlan model poller stopped unexpectedly; restarting the host.", flush=True)
                return 1
            time.sleep(0.2)
        return 0
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + grace_seconds
        for child in children:
            try:
                child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(supervise([
        (["/opt/aequilibrae/bin/python", "-u", "main.py"], "/app/workers/aequilibrae_worker"),
        (["/opt/activitysim/bin/python", "-u", "supabase_poll.py"], "/app/workers/activitysim_worker"),
    ]))
