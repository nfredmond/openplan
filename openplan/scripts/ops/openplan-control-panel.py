#!/usr/bin/env python3
"""
OpenPlan Control — a double-click window for running OpenPlan locally.

WHO THIS IS FOR
  Nathaniel, who directs this product and does not read code. Every action a
  demo or a testing session needs is a labelled button here, so none of it
  depends on remembering a command or noticing which of several OpenPlans a
  browser happened to open.

WHY IT EXISTS
  Three things on this machine answer on localhost and none of them says which
  it is. The demo instance is a SEPARATE checkout served by a systemd service
  on :3000; the working tree has no always-on server at all; and :3100 and
  :3101 belong to other software entirely. On 2026-08-08 half an hour went into
  diagnosing a bug on :3000 that had already been fixed in the tree being
  edited. The status panel at the top of this window exists so that mistake
  costs a glance instead of an afternoon.

WHAT IT DELIBERATELY DOES NOT DO
  It never edits, commits, or discards anything in git, and it starts no
  long-running job without saying how long that job takes. The refresh script
  it calls refuses to run against a dirty tree, and this window does not
  override that.

Run:  python3 scripts/ops/openplan-control-panel.py
Or double-click the desktop shortcut that install-desktop-shortcut.sh creates.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from pathlib import Path
from tkinter import scrolledtext, ttk

# ---------------------------------------------------------------------------
# Where things live. APP_DIR is derived from this file's own location so the
# panel keeps working if the checkout moves; the demo instance is a genuinely
# separate clone and has no relationship to it.
# ---------------------------------------------------------------------------

APP_DIR = Path(__file__).resolve().parents[2]          # …/openplan/openplan
REPO_DIR = APP_DIR.parent                              # …/openplan
DEMO_DIR = Path.home() / "apps" / "openplan" / "openplan"
LOG_DIR = Path.home() / ".cache" / "openplan-control"
DEV_LOG = LOG_DIR / "dev-server.log"
DEV_PORT = 3200
DEMO_URL = "http://localhost:3000"
DEV_URL = f"http://localhost:{DEV_PORT}"

CHROME = shutil.which("google-chrome") or shutil.which("google-chrome-stable")

# Status colours live in `check_status`, beside the rule that chooses between
# them, so the verdict logic can be tested without importing a GUI.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_status import BAD, IDLE, OK, WARN, summarize_check_conclusions  # noqa: E402

_ = (WARN,)  # re-exported for the rest of the panel


# ---------------------------------------------------------------------------
# Small helpers. Each returns plain data; none of them touches the UI, so they
# are safe to call from a worker thread.
# ---------------------------------------------------------------------------


def run_quiet(args: list[str], cwd: Path | None = None, timeout: int = 15) -> tuple[int, str]:
    """Run a command and capture everything. Never raises on a non-zero exit."""
    try:
        p = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return p.returncode, (p.stdout + p.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    except FileNotFoundError:
        return 127, f"{args[0]} is not installed"
    except OSError as exc:
        return 1, str(exc)


def http_health(url: str, timeout: float = 3.0) -> dict | None:
    """
    Ask an instance which build it is. None means nothing answered.

    The build stamp lives under `deployment`, not at the top level. Reading the
    top level returns None for both fields, which renders as "cannot tell how
    current it is" — a panel that always says it does not know is worse than no
    panel, because the whole point is catching a stale demo. Both shapes are
    accepted so this keeps working if the endpoint is ever flattened.
    """
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as r:
            raw = json.loads(r.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    deployment = raw.get("deployment") if isinstance(raw.get("deployment"), dict) else {}
    return {
        "version": deployment.get("version") or raw.get("version"),
        "commit": deployment.get("commit") or raw.get("commit"),
        "raw": raw,
    }


def port_owner_dir(port: int) -> str | None:
    """
    Which directory is the process on this port serving?

    The kernel knows the working directory of whatever holds the socket, and
    that beats every heuristic — a port number is not an identity.
    """
    code, out = run_quiet(["ss", "-ltnp"])
    if code != 0:
        return None
    for line in out.splitlines():
        if f":{port} " not in line and f":{port}\t" not in line:
            continue
        for token in line.split():
            if token.startswith("pid=") or ",pid=" in token:
                pid = token.split("pid=")[1].split(",")[0].strip(")")
                try:
                    return os.readlink(f"/proc/{pid}/cwd")
                except OSError:
                    return None
    return None


def port_pid(port: int) -> int | None:
    code, out = run_quiet(["ss", "-ltnp"])
    if code != 0:
        return None
    for line in out.splitlines():
        if f":{port} " not in line and f":{port}\t" not in line:
            continue
        for token in line.split():
            if "pid=" in token:
                try:
                    return int(token.split("pid=")[1].split(",")[0].strip(")"))
                except ValueError:
                    return None
    return None


def database_up() -> bool:
    code, out = run_quiet(
        ["docker", "inspect", "-f", "{{.State.Running}}", "supabase_db_openplan"]
    )
    return code == 0 and out.strip() == "true"


def commits_behind(commit: str) -> int | None:
    """How far behind this checkout's HEAD a reported build is. None = unknown."""
    if not commit or commit == "unknown":
        return None
    code, _ = run_quiet(["git", "cat-file", "-e", f"{commit}^{{commit}}"], cwd=REPO_DIR)
    if code != 0:
        return None
    code, out = run_quiet(["git", "rev-list", "--count", f"{commit}..HEAD"], cwd=REPO_DIR)
    if code != 0:
        return None
    try:
        return int(out.strip())
    except ValueError:
        return None


def automated_checks() -> tuple[str, str]:
    """
    WHETHER THE ROBOTS ON GITHUB ARE HAPPY, in one line.

    WHY THIS ROW EXISTS. On 2026-08-15 two of these had been red for a long time
    with nobody looking: the tenant-isolation proof for three and a half days
    and 48 pushes, and the nightly browser walk-through since the day it was
    created — thirteen runs, never once green. Both were CORRECT. One of them
    had been trying to say, for ten days, that residents' comments were being
    posted before anyone could read them back.

    The isolation proof now runs inside `npm run qa:gate`, so that one cannot go
    unnoticed again. The nightly cannot: it needs a whole stack and eight
    minutes, which is too much to put in front of every push. So it reports
    here, on the window Nathaniel opens to start work.

    IT MUST NEVER SHOW GREEN WHEN IT DOES NOT KNOW. No network, no `gh`, not
    signed in — all of those say so in words and stay grey. A check that reads
    as fine when it failed to look is the exact thing this row exists to end.
    """
    code, out = run_quiet(
        [
            "gh", "run", "list", "--branch", "main", "--limit", "40",
            "--json", "name,conclusion,status",
        ],
        cwd=REPO_DIR,
        timeout=20,
    )
    if code != 0:
        if code == 127:
            return IDLE, "cannot check — the GitHub command line is not installed"
        return IDLE, "cannot check right now (no network, or not signed in to GitHub)"

    try:
        runs = json.loads(out)
    except (ValueError, TypeError):
        return IDLE, "cannot check — GitHub answered something unexpected"

    # Newest first, so per workflow the first COMPLETED run is its current
    # state and the unbroken run of failures above the first success is how
    # long it has been broken. "3 runs in a row" is the number that turns
    # "something is red" into "this has been red since Tuesday".
    by_workflow: dict[str, list[str]] = {}
    for run in runs:
        name, conclusion = run.get("name"), run.get("conclusion")
        if run.get("status") != "completed" or not name or not conclusion:
            continue  # still running: not an answer yet
        by_workflow.setdefault(name, []).append(conclusion)

    return summarize_check_conclusions(by_workflow)


# ---------------------------------------------------------------------------
# The window.
# ---------------------------------------------------------------------------


class ControlPanel:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.output_q: queue.Queue[str] = queue.Queue()
        self.busy = False
        self.dev_proc: subprocess.Popen | None = None

        LOG_DIR.mkdir(parents=True, exist_ok=True)

        # Sized so the output pane still has room after everything above it.
        # At 880x680 the panes above claimed the space and the output area
        # collapsed to a single line — which is where every long-running job
        # reports its progress, so it cannot be the part that gets squeezed.
        root.title("OpenPlan Control")
        # Offset from the corner rather than centred: centred, it opens directly
        # underneath whatever terminal or editor is already there.
        root.geometry("980x1000+60+60")
        root.minsize(860, 720)

        self._build_status(root)
        self._build_actions(root)
        self._build_output(root)

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._pump_output()
        self._refresh_status()

        self.say("Ready. Press “Check what's running” any time you're not sure what")
        self.say("a browser is showing you.")
        self.say("")

    # -- layout ------------------------------------------------------------

    def _build_status(self, root: tk.Tk) -> None:
        box = ttk.LabelFrame(root, text="  What's running right now  ", padding=12)
        box.pack(fill="x", padx=14, pady=(14, 8))

        self.status_labels: dict[str, tk.Label] = {}
        self.status_dots: dict[str, tk.Label] = {}
        # Last answer from GitHub, and when it was taken. See _status_worker.
        self._checks_cache: tuple[str, str] | None = None
        self._checks_at: float = 0.0

        # The title column carries the "which is which" hint inline. An earlier
        # version put it in a right-aligned label on the same row, and on a
        # long status message the two collided and overprinted each other.
        rows = [
            ("demo", "Demo site — port 3000", "the one you show people"),
            ("dev", f"Test site — port {DEV_PORT}", "the code being worked on now"),
            ("db", "Database", "everything needs this"),
            ("checks", "Automated checks", "the robots that test every change"),
        ]
        for key, title, hint in rows:
            row = ttk.Frame(box)
            row.pack(fill="x", pady=4)
            dot = tk.Label(row, text="●", fg=IDLE, font=("", 15))
            dot.grid(row=0, column=0, rowspan=2, padx=(0, 10), sticky="n")
            tk.Label(row, text=title, font=("", 11, "bold"), anchor="w", width=28).grid(
                row=0, column=1, sticky="w"
            )
            tk.Label(row, text=hint, fg=IDLE, anchor="w", width=28).grid(
                row=1, column=1, sticky="w"
            )
            lab = tk.Label(row, text="checking…", anchor="w", justify="left", wraplength=560)
            lab.grid(row=0, column=2, rowspan=2, sticky="w", padx=(14, 0))
            row.columnconfigure(2, weight=1)
            self.status_dots[key] = dot
            self.status_labels[key] = lab

    def _build_actions(self, root: tk.Tk) -> None:
        wrap = ttk.Frame(root)
        wrap.pack(fill="x", padx=14, pady=4)

        demo = ttk.LabelFrame(wrap, text="  Showing OpenPlan to someone  ", padding=10)
        demo.pack(side="left", fill="both", expand=True, padx=(0, 7))
        self._button(
            demo, "Open the demo", self.open_demo,
            "Opens port 3000 in Chrome.",
        )
        self._button(
            demo, "Update the demo to the latest", self.refresh_demo,
            "Takes a few minutes. Do this BEFORE showing anyone —\n"
            "the demo does not update itself.",
        )

        dev = ttk.LabelFrame(wrap, text="  Testing the current work  ", padding=10)
        dev.pack(side="left", fill="both", expand=True, padx=(7, 0))
        self.dev_btn = self._button(
            dev, "Start the test site", self.toggle_dev,
            f"Runs the code as it is right now, on port {DEV_PORT}.\n"
            "Opens in Chrome once ready — usually 10–30 seconds.",
        )
        self._button(
            dev, "Open the test site", self.open_dev,
            "If it's already running.",
        )

        checks = ttk.LabelFrame(root, text="  When something looks wrong  ", padding=10)
        checks.pack(fill="x", padx=14, pady=(8, 4))
        # Buttons in a row with their hints BENEATH them, not beside: side-by-side
        # the third pair ran off the edge of the window.
        strip = ttk.Frame(checks)
        strip.pack(fill="x")
        for col, (label, cmd, hint) in enumerate([
            ("Check what's running", self.check_which, "which code each site is serving"),
            ("Check the setup", self.run_doctor, "database, settings, missing pieces"),
            ("Show the recent errors", self.show_log, "last 80 lines from the test site"),
        ]):
            b = ttk.Button(strip, text=label, command=cmd)
            b.grid(row=0, column=col, sticky="ew", padx=(0, 10))
            tk.Label(strip, text=hint, fg=IDLE, anchor="w").grid(
                row=1, column=col, sticky="w", padx=(0, 10)
            )
            strip.columnconfigure(col, weight=1)
            self._track(b)

    def _build_output(self, root: tk.Tk) -> None:
        box = ttk.LabelFrame(root, text="  What's happening  ", padding=8)
        box.pack(fill="both", expand=True, padx=14, pady=(6, 14))
        self.out = scrolledtext.ScrolledText(
            box, wrap="word", height=14, font=("monospace", 10),
            background="#111418", foreground="#e6e6e6", insertbackground="#e6e6e6",
            relief="flat", padx=10, pady=8,
        )
        self.out.pack(fill="both", expand=True)
        self.out.configure(state="disabled")

        bar = ttk.Frame(box)
        bar.pack(fill="x", pady=(6, 0))
        self.spinner = tk.Label(bar, text="", fg=IDLE)
        self.spinner.pack(side="left")
        ttk.Button(bar, text="Clear", command=self.clear_output).pack(side="right")
        self.copy_btn = ttk.Button(bar, text="Copy all text", command=self.copy_output)
        self.copy_btn.pack(side="right", padx=(0, 8))
        self.copy_note = tk.Label(bar, text="", fg=OK)
        self.copy_note.pack(side="right", padx=(0, 10))

    def _button(self, parent, label, cmd, hint) -> ttk.Button:
        b = ttk.Button(parent, text=label, command=cmd)
        b.pack(fill="x", pady=(2, 0))
        # wraplength, because the two action columns are each about half the
        # window and a hint written as one line ran off the right edge.
        tk.Label(
            parent, text=hint, fg=IDLE, justify="left", anchor="w", wraplength=400
        ).pack(fill="x", pady=(1, 9))
        self._track(b)
        return b

    def _track(self, widget) -> None:
        if not hasattr(self, "_buttons"):
            self._buttons: list[ttk.Button] = []
        self._buttons.append(widget)

    # -- output ------------------------------------------------------------

    def say(self, line: str = "") -> None:
        self.output_q.put(line)

    def _pump_output(self) -> None:
        """
        Drain the worker queue on the UI thread.

        Everything a worker prints arrives here; workers never touch a widget,
        which is what keeps a multi-minute rebuild from freezing the window.
        """
        drained = False
        while True:
            try:
                line = self.output_q.get_nowait()
            except queue.Empty:
                break
            drained = True
            self.out.configure(state="normal")
            self.out.insert("end", line + "\n")
            self.out.configure(state="disabled")
        if drained:
            self.out.see("end")
        self.root.after(120, self._pump_output)

    def clear_output(self) -> None:
        self.out.configure(state="normal")
        self.out.delete("1.0", "end")
        self.out.configure(state="disabled")

    def copy_output(self) -> None:
        """
        Put everything in the output pane on the clipboard, for pasting into a
        message when something has gone wrong.

        wl-copy is preferred over Tk's own clipboard because this is a Wayland
        session: Tk hands the selection back the moment the window closes, so a
        copy made just before quitting the panel — exactly when someone is
        copying an error to send on — would paste nothing. wl-copy forks a small
        process that keeps holding it. Tk is the fallback for anywhere wl-copy
        is absent.
        """
        text = self.out.get("1.0", "end-1c")
        if not text.strip():
            self._flash_copy("Nothing to copy yet.", BAD)
            return

        if shutil.which("wl-copy"):
            try:
                subprocess.run(["wl-copy"], input=text, text=True, timeout=10, check=True)
                self._flash_copy(f"Copied {len(text.splitlines())} lines.", OK)
                return
            except (subprocess.SubprocessError, OSError):
                pass  # fall through to Tk rather than telling them it worked

        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
            self.root.update_idletasks()
            self._flash_copy("Copied — paste it before closing this window.", WARN)
        except tk.TclError as exc:
            self._flash_copy(f"Could not copy: {exc}", BAD)

    def _flash_copy(self, message: str, colour: str) -> None:
        self.copy_note.configure(text=message, fg=colour)
        self.root.after(6000, lambda: self.copy_note.configure(text=""))

    # -- busy state --------------------------------------------------------

    def _set_busy(self, busy: bool, what: str = "") -> None:
        self.busy = busy
        for b in getattr(self, "_buttons", []):
            try:
                b.state(["disabled"] if busy else ["!disabled"])
            except tk.TclError:
                pass
        self.spinner.configure(text=(f"⏳  {what}" if busy else ""))

    def _work(self, what: str, fn) -> None:
        """Run fn on a worker thread with the buttons disabled meanwhile."""
        if self.busy:
            self.say("Something is already running — let it finish first.")
            return
        self._set_busy(True, what)

        def runner() -> None:
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 — surface, never swallow
                self.say(f"\nThat did not work: {exc}")
            finally:
                self.root.after(0, lambda: self._set_busy(False))
                self.root.after(300, self._refresh_status)

        threading.Thread(target=runner, daemon=True).start()

    def _stream(self, args: list[str], cwd: Path) -> int:
        """Run a command and print its output line by line as it arrives."""
        try:
            p = subprocess.Popen(
                args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
            )
        except FileNotFoundError:
            self.say(f"Could not find {args[0]}.")
            return 127
        assert p.stdout is not None
        for line in p.stdout:
            self.say(line.rstrip())
        return p.wait()

    # -- status ------------------------------------------------------------

    def _refresh_status(self) -> None:
        threading.Thread(target=self._status_worker, daemon=True).start()
        self.root.after(12000, self._refresh_status)

    def _status_worker(self) -> None:
        demo = http_health(DEMO_URL)
        if demo is None:
            d = (BAD, "not running — the demo should start by itself when you log in")
        else:
            version = demo.get("version", "?")
            commit = (demo.get("commit") or "")[:12]
            behind = commits_behind(commit)
            if behind is None:
                d = (WARN, f"running v{version} — cannot tell how current it is")
            elif behind == 0:
                d = (OK, f"running v{version}, up to date")
            else:
                d = (WARN, f"running v{version} — {behind} commits behind. "
                           f"Update it before showing anyone.")

        owner = port_owner_dir(DEV_PORT)
        if owner is None:
            v = (IDLE, "not running — press “Start the test site” when you want it")
        elif Path(owner).resolve() == APP_DIR.resolve():
            v = (OK, "running, serving the code being worked on now")
        else:
            v = (WARN, f"running, but serving a different folder: {owner}")

        b = (OK, "running") if database_up() else (BAD, "not running — start Docker")

        # The other three rows are local and cheap; this one is a network call
        # to GitHub, so it refreshes on its own slower clock instead of every
        # twelve seconds. The last answer stays on screen in between, which is
        # honest — it was true when it was taken.
        now = time.monotonic()
        if self._checks_cache is None or now - self._checks_at > 300:
            self._checks_cache = automated_checks()
            self._checks_at = now
        c = self._checks_cache

        def apply() -> None:
            for key, (colour, text) in (("demo", d), ("dev", v), ("db", b), ("checks", c)):
                self.status_dots[key].configure(fg=colour)
                self.status_labels[key].configure(text=text)
            running = v[0] in (OK, WARN)
            self.dev_btn.configure(
                text=("Stop the test site" if running else "Start the test site")
            )

        self.root.after(0, apply)

    # -- actions -----------------------------------------------------------

    def _open_in_chrome(self, url: str) -> None:
        if CHROME:
            subprocess.Popen(
                [CHROME, url],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            self.say(f"Opened {url} in Chrome.")
        else:
            subprocess.Popen(["xdg-open", url], start_new_session=True)
            self.say(f"Chrome was not found, so {url} opened in your default browser.")

    def open_demo(self) -> None:
        if http_health(DEMO_URL) is None:
            self.say("The demo is not answering on port 3000.")
            self.say("It normally starts by itself when you log in. If it hasn't,")
            self.say("press “Check the setup” and read what it says.")
            return
        self._open_in_chrome(DEMO_URL)

    def open_dev(self) -> None:
        if port_owner_dir(DEV_PORT) is None:
            self.say(f"Nothing is running on port {DEV_PORT} yet.")
            self.say("Press “Start the test site” first.")
            return
        self._open_in_chrome(DEV_URL)

    def refresh_demo(self) -> None:
        script = APP_DIR / "scripts" / "ops" / "refresh-walkthrough-instance.sh"
        if not script.exists():
            self.say(f"Could not find {script}.")
            return

        def job() -> None:
            self.say("=" * 66)
            self.say("UPDATING THE DEMO. This rebuilds it and restarts it — a few minutes.")
            self.say("It will refuse to run if there is unsaved work in the demo copy,")
            self.say("so nothing can be lost.")
            self.say("=" * 66)
            code = self._stream(["bash", str(script)], cwd=APP_DIR)
            self.say("")
            if code == 0:
                self.say("DONE — the demo is now on the latest code.")
                self.say("Press “Open the demo” to look at it.")
            else:
                self.say(f"IT STOPPED (exit {code}). Nothing was lost — read the lines above;")
                self.say("the last few usually say plainly what it wanted.")

        self._work("updating the demo", job)

    def toggle_dev(self) -> None:
        if port_owner_dir(DEV_PORT) is not None:
            self.stop_dev()
        else:
            self.start_dev()

    def start_dev(self) -> None:
        def job() -> None:
            self.say("=" * 66)
            self.say(f"STARTING THE TEST SITE on port {DEV_PORT}.")
            self.say("This serves the code exactly as it is right now. It stays running")
            self.say("until you stop it or close this window.")
            self.say("=" * 66)
            log = DEV_LOG.open("w", encoding="utf-8")
            self.dev_proc = subprocess.Popen(
                ["npm", "run", "dev", "--", "-p", str(DEV_PORT)],
                cwd=APP_DIR, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            self.say(f"Started. Waiting for it to answer (usually 10–30 seconds)…")
            for _ in range(90):
                time.sleep(1)
                if http_health(DEV_URL, timeout=1.5) is not None:
                    self.say("It's up.")
                    self.root.after(0, lambda: self._open_in_chrome(DEV_URL))
                    return
                if self.dev_proc.poll() is not None:
                    self.say("It stopped on its own. Press “Show the recent errors”.")
                    return
            self.say("It has not answered after 90 seconds — something is wrong.")
            self.say("Press “Show the recent errors” to see what it said.")

        self._work("starting the test site", job)

    def stop_dev(self) -> None:
        def job() -> None:
            pid = port_pid(DEV_PORT)
            if pid is None:
                self.say("Nothing to stop.")
                return
            # The dev server spawns children; killing the group stops all of it.
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError as exc:
                    self.say(f"Could not stop it: {exc}")
                    return
            for _ in range(15):
                time.sleep(0.4)
                if port_pid(DEV_PORT) is None:
                    self.say("Test site stopped.")
                    return
            self.say("It is taking a while to stop. Give it a moment.")

        self._work("stopping the test site", job)

    def check_which(self) -> None:
        script = APP_DIR / "scripts" / "ops" / "which-openplan.sh"

        def job() -> None:
            self.say("=" * 66)
            self.say("WHICH CODE IS EACH SITE SERVING?")
            self.say("=" * 66)
            for label, url in (("Demo site", DEMO_URL), ("Test site", DEV_URL)):
                self.say("")
                self.say(f"--- {label} ({url}) ---")
                if script.exists():
                    self._stream(["bash", str(script), url], cwd=APP_DIR)
                else:
                    info = http_health(url)
                    self.say(str(info) if info else "nothing answered")

        self._work("checking", job)

    def run_doctor(self) -> None:
        doctor = APP_DIR / "scripts" / "doctor.mjs"

        def job() -> None:
            self.say("=" * 66)
            self.say("CHECKING THE SETUP")
            self.say("=" * 66)
            if doctor.exists():
                self._stream(["node", str(doctor)], cwd=APP_DIR)
            else:
                self.say("The setup checker is not in this copy of the code.")
            self.say("")
            self.say("--- Background services ---")
            code, out = run_quiet(
                ["docker", "ps", "--format", "{{.Names}}\t{{.Status}}"], timeout=20
            )
            for line in (out.splitlines() if code == 0 else ["could not ask Docker"]):
                if "openplan" in line.lower() or "nodeodm" in line.lower():
                    self.say("  " + line)

        self._work("checking the setup", job)

    def show_log(self) -> None:
        def job() -> None:
            self.say("=" * 66)
            self.say(f"LAST 80 LINES FROM THE TEST SITE  ({DEV_LOG})")
            self.say("=" * 66)
            if not DEV_LOG.exists():
                self.say("No log yet — the test site has not been started from this window.")
                return
            lines = DEV_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
            for line in lines[-80:]:
                self.say(line)
            if not lines:
                self.say("(the log is empty)")

        self._work("reading the log", job)

    # -- shutdown ----------------------------------------------------------

    def _on_close(self) -> None:
        """
        Offer to stop the test site rather than orphaning it.

        Leaving it running is a legitimate choice — it is how the port ends up
        occupied by a server nobody remembers starting, so the question is
        asked explicitly rather than decided silently.
        """
        if port_owner_dir(DEV_PORT) is not None:
            win = tk.Toplevel(self.root)
            win.title("Before you go")
            win.transient(self.root)
            win.grab_set()
            tk.Label(
                win,
                text=("The test site on port %d is still running.\n\n"
                      "Leave it running and it stays available until you\n"
                      "restart the computer." % DEV_PORT),
                justify="left", padx=18, pady=16,
            ).pack()
            row = ttk.Frame(win)
            row.pack(pady=(0, 14))

            def stop_and_quit() -> None:
                pid = port_pid(DEV_PORT)
                if pid:
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGTERM)
                    except OSError:
                        pass
                win.destroy()
                self.root.destroy()

            ttk.Button(row, text="Stop it and close", command=stop_and_quit).pack(
                side="left", padx=6
            )
            ttk.Button(
                row, text="Leave it running", command=lambda: (win.destroy(), self.root.destroy())
            ).pack(side="left", padx=6)
            ttk.Button(row, text="Cancel", command=win.destroy).pack(side="left", padx=6)
            return
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    try:
        ttk.Style().theme_use("clam")
    except tk.TclError:
        pass
    ControlPanel(root)
    root.mainloop()


if __name__ == "__main__":
    main()
