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
import re
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
from dataclasses import dataclass
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
from check_status import BAD, IDLE, OK, WARN  # noqa: E402

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


def port_in_use(port: int) -> bool | None:
    """Keep an unreadable socket table distinct from an available port."""
    code, out = run_quiet(["ss", "-H", "-ltn", f"sport = :{port}"])
    return bool(out.strip()) if code == 0 else None


@dataclass(frozen=True)
class ProcessIdentity:
    pid: int
    session: int
    started: int


def process_identity(pid: int) -> ProcessIdentity | None:
    """Read Linux process identity without logging arguments or environment."""
    try:
        # comm may contain spaces or parentheses; fields after its final ')' are fixed.
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return ProcessIdentity(pid, int(fields[3]), int(fields[19]))
    except (OSError, ValueError, IndexError):
        return None


def owned_session_alive(proc: subprocess.Popen | None, owner: ProcessIdentity | None) -> bool:
    return bool(
        proc is not None and owner is not None and proc.pid == owner.pid
        and owner.session == owner.pid and proc.poll() is None
        and process_identity(owner.pid) == owner
    )


def stop_owned_session(proc: subprocess.Popen | None, owner: ProcessIdentity | None) -> bool:
    """Signal only a session this window created, using PID handles against reuse.

    Never fall back to a port PID or killpg. If the original leader has exited,
    ownership cannot be revalidated and cleanup must be handled separately.
    """
    if not owned_session_alive(proc, owner):
        return False
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        return False
    assert owner is not None
    members = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdecimal():
            identity = process_identity(int(entry.name))
            if identity is not None and identity.session == owner.pid:
                members.append(identity)
    # Pin the complete target set before TERM can make the npm leader exit.
    members.sort(key=lambda identity: identity.pid == owner.pid)
    handles: list[int] = []
    try:
        for identity in members:
            try:
                fd = os.pidfd_open(identity.pid)
            except ProcessLookupError:
                continue
            handles.append(fd)
            if process_identity(identity.pid) != identity:
                return False
        if not owned_session_alive(proc, owner):
            return False
        for fd in handles:
            try:
                signal.pidfd_send_signal(fd, signal.SIGTERM)
            except ProcessLookupError:
                continue
    finally:
        for fd in handles:
            os.close(fd)
    return True


def database_up() -> bool:
    code, out = run_quiet(
        ["docker", "inspect", "-f", "{{.State.Running}}", "supabase_db_openplan"]
    )
    return code == 0 and out.strip() == "true"


def commits_behind(commit: str, target: str = "HEAD") -> int | None:
    """Count ancestors of a known target; divergence stays unknown."""
    if not commit or commit == "unknown":
        return None
    code, _ = run_quiet(["git", "cat-file", "-e", f"{commit}^{{commit}}"], cwd=REPO_DIR)
    if code != 0:
        return None
    code, _ = run_quiet(["git", "merge-base", "--is-ancestor", commit, target], cwd=REPO_DIR)
    if code != 0:
        return None
    code, out = run_quiet(["git", "rev-list", "--count", f"{commit}..{target}"], cwd=REPO_DIR)
    if code != 0:
        return None
    try:
        return int(out.strip())
    except ValueError:
        return None


def github_main() -> tuple[str | None, str]:
    """Fetch the update target without moving the checkout or hiding fetch failure."""
    code, _ = run_quiet(["git", "fetch", "--quiet", "origin",
                         "refs/heads/main:refs/remotes/origin/main"], cwd=REPO_DIR, timeout=20)
    if code:
        return None, "GitHub main unavailable. Check network and GitHub sign-in."
    code, sha = run_quiet(["git", "rev-parse", "refs/remotes/origin/main"], cwd=REPO_DIR)
    if code or not re.fullmatch(r"[0-9a-f]{40,64}", sha):
        return None, "GitHub main commit could not be read."
    return sha, "Checked " + time.strftime("%H:%M:%S")


def demo_status(demo: dict | None, target: str | None, checked: str) -> tuple[str, str]:
    """Keep the served commit visible even when GitHub or ancestry is unavailable."""
    main = f"GitHub main · {target[:12]}" if target else "GitHub main · not checked"
    if demo is None:
        return BAD, f"Demo is not answering.\n{main}\n{checked}"
    commit = demo.get("commit") or "unrecorded"
    version = demo.get("version") or "unknown"
    behind = commits_behind(commit, target) if target else None
    state = "Comparison unavailable"
    colour = WARN
    if behind == 0:
        state, colour = "Up to date with main", OK
    elif behind is not None:
        state = f"Update available · {behind} {'commit' if behind == 1 else 'commits'} behind main"
    return colour, f"Demo v{version} · {commit[:12]}\n{main}\n{state}. {checked}"


def automated_checks() -> tuple[str, str]:
    """Report exact-commit CI and a separately dated nightly, never older green CI."""
    code, target = run_quiet(["git", "rev-parse", "HEAD"], cwd=REPO_DIR)
    if code or not re.fullmatch(r"[0-9a-f]{40,64}", target):
        return IDLE, "cannot check: this checkout's commit is unknown"

    def latest(workflow: str, exact_commit: bool) -> tuple[str, str]:
        args = ["gh", "run", "list", "--branch", "main", "--workflow", workflow,
                "--limit", "1", "--json", "headSha,conclusion,status,url,updatedAt"]
        if exact_commit:
            args += ["--commit", target, "--event", "push"]
        code, out = run_quiet(args, cwd=REPO_DIR, timeout=20)
        if code:
            return IDLE, "unavailable (check network and GitHub sign-in)"
        try:
            runs = json.loads(out)
            if not isinstance(runs, list) or not runs:
                return IDLE, "no run reported"
            run = runs[0]
            sha, updated, url = run["headSha"], run["updatedAt"], run["url"]
            if not all(isinstance(value, str) and value for value in (sha, updated, url)):
                raise ValueError("missing run identity")
            if exact_commit and sha != target:
                return IDLE, "no matching commit evidence"
            identity = f"{sha[:12]} at {updated}\n{url}"
            if run["status"] != "completed":
                return WARN, f"{run['status']} on {identity}"
            conclusion = run.get("conclusion") or "unknown conclusion"
            return (OK if conclusion == "success" else BAD), f"{conclusion} on {identity}"
        except (ValueError, TypeError, KeyError, IndexError):
            return IDLE, "unreadable run evidence"

    ci_colour, ci = latest("ci.yml", True)
    nightly_colour, nightly = latest("qa-harness-nightly.yml", False)
    colour = ci_colour
    if nightly_colour == BAD:
        colour = BAD
    elif ci_colour == OK and nightly_colour != OK:
        colour = WARN
    checked = time.strftime("%H:%M:%S %Z")
    return colour, (f"CI for {target[:12]}: {ci}\n"
                    f"Latest nightly (separate evidence): {nightly}\n"
                    f"Checked {checked}. Other workflows and uncommitted edits are not assessed.")


# ---------------------------------------------------------------------------
# The window.
# ---------------------------------------------------------------------------


class ControlPanel:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.output_q: queue.Queue[str] = queue.Queue()
        self.busy = False
        self.dev_proc: subprocess.Popen | None = None
        self.dev_owner: ProcessIdentity | None = None
        self._status_timer: str | None = None
        self._status_running = False
        self._main_cache = (None, "Checking GitHub main…")
        self._main_at = 0.0

        LOG_DIR.mkdir(parents=True, exist_ok=True)

        root.title("OpenPlan Control")
        root.geometry("820x760+60+60")
        root.minsize(640, 700)
        root.configure(background="#101b25")
        root.option_add("*Font", "{DejaVu Sans} 10")
        root.option_add("*Label.Background", "#182735")
        root.option_add("*Label.Foreground", "#edf4f3")
        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure(".", background="#182735", foreground="#edf4f3")
        style.configure("TFrame", background="#182735")
        style.configure("TButton", padding=(14, 10), background="#293f50", borderwidth=0)
        style.map("TButton", background=[("active", "#36576b"), ("disabled", "#25333e")],
                  foreground=[("disabled", "#8c9ba5")])
        style.configure("Primary.TButton", background="#95dbc4", foreground="#10251e")
        style.map("Primary.TButton", background=[("active", "#b4ecd9"), ("disabled", "#3c6157")],
                  foreground=[("disabled", "#b0c2bc")])
        style.configure("TNotebook", background="#101b25", borderwidth=0)
        style.configure("TNotebook.Tab", padding=(18, 10), background="#101b25", foreground="#b1c1cc")
        style.map("TNotebook.Tab", background=[("selected", "#182735")], foreground=[("selected", "#95dbc4")])
        style.configure("TLabel", background="#182735", foreground="#edf4f3")
        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1, minsize=290)
        root.rowconfigure(2, weight=2, minsize=200)

        header = tk.Frame(root, background="#101b25")
        header.grid(row=0, column=0, sticky="ew", padx=24, pady=(20, 16))
        tk.Label(header, text="OpenPlan", font=("DejaVu Sans", 24, "bold"),
                 background="#101b25", foreground="#edf4f3").pack(anchor="w")
        tk.Label(header, text="Your local workspace", background="#101b25",
                 foreground="#b1c1cc").pack(anchor="w")

        self.tabs = ttk.Notebook(root, height=250)
        self.tabs.grid(row=1, column=0, sticky="nsew", padx=20)
        demo = ttk.Frame(self.tabs, padding=16)
        dev = ttk.Frame(self.tabs, padding=16)
        diagnostics = ttk.Frame(self.tabs)
        self.tabs.add(demo, text="Demo")
        self.tabs.add(dev, text="Development")
        self.tabs.add(diagnostics, text="Diagnostics")

        self.demo_summary = tk.Label(demo, text="Checking the demo…", anchor="w", justify="left", wraplength=500)
        self.demo_summary.pack(fill="x", pady=(8, 12))
        self._wrap_to_width(self.demo_summary)
        actions = ttk.Frame(demo)
        actions.pack(fill="x")
        self.open_demo_btn = ttk.Button(actions, text="Open demo", command=self.open_demo, style="Primary.TButton")
        self.open_demo_btn.pack(side="left", padx=(0, 12))
        self.update_demo_btn = ttk.Button(actions, text="Update to main", command=self.refresh_demo)
        self.update_demo_btn.pack(side="left")
        self._track(self.open_demo_btn)
        self._track(self.update_demo_btn)
        hint = tk.Label(demo, text="Updates code and database. Keeps recovery copies.",
                        fg="#b1c1cc", anchor="w", justify="left", wraplength=500)
        hint.pack(fill="x", pady=(6, 0))
        self._wrap_to_width(hint)

        tk.Label(dev, text="Try the current work", font=("DejaVu Sans", 14, "bold"), anchor="w").pack(fill="x", pady=(0, 8))
        dev_hint = tk.Label(dev, text="Runs this checkout locally. Usually ready in 10–30 seconds.",
                            fg="#b1c1cc", anchor="w", justify="left", wraplength=500)
        dev_hint.pack(fill="x", pady=(0, 16))
        self._wrap_to_width(dev_hint)
        dev_actions = ttk.Frame(dev)
        dev_actions.pack(fill="x")
        self.dev_btn = ttk.Button(dev_actions, text="Start test site", command=self.toggle_dev)
        self.dev_btn.pack(side="left", padx=(0, 12))
        open_dev_btn = ttk.Button(dev_actions, text="Open test site", command=self.open_dev)
        open_dev_btn.pack(side="left")
        self._track(self.dev_btn)
        self._track(open_dev_btn)

        self.controls_canvas = tk.Canvas(diagnostics, background="#182735", highlightthickness=0, takefocus=0)
        scrollbar = ttk.Scrollbar(diagnostics, orient="vertical", command=self.controls_canvas.yview)
        scrollbar.pack(side="right", fill="y")
        self.controls_canvas.pack(side="left", fill="both", expand=True)
        self.controls_canvas.configure(yscrollcommand=scrollbar.set)
        self.controls = ttk.Frame(self.controls_canvas, padding=16)
        content = self.controls_canvas.create_window((0, 0), window=self.controls, anchor="nw")
        self.controls_canvas.bind("<Configure>", lambda event: self.controls_canvas.itemconfigure(content, width=event.width))
        self.controls.bind("<Configure>", lambda event: self.controls_canvas.configure(scrollregion=self.controls_canvas.bbox("all")))
        root.bind("<FocusIn>", self._reveal_control, add="+")
        root.bind("<Button-4>", self._scroll_controls, add="+")
        root.bind("<Button-5>", self._scroll_controls, add="+")
        root.bind("<MouseWheel>", self._scroll_controls, add="+")
        self._build_status(self.controls)
        for label, action in [("Check running versions", self.check_which),
                              ("Check local setup", self.run_doctor),
                              ("Show test-site errors", self.show_log),
                              ("Show last update log", self.show_update_log),
                              ("Recover previous demo", self.recover_demo)]:
            self._button(self.controls, label, action, "")
        self._build_output(root)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._pump_output()
        self._refresh_status()
        self.say("Ready. Open the demo to start planning, or update it to get the latest work.")

    # -- layout ------------------------------------------------------------

    def _in_controls(self, widget) -> bool:
        while widget is not None:
            if widget in (self.controls, self.controls_canvas):
                return True
            widget = getattr(widget, "master", None)
        return False

    def _scroll_controls(self, event) -> None:
        if self._in_controls(event.widget):
            direction = -1 if event.num == 4 or getattr(event, "delta", 0) > 0 else 1
            self.controls_canvas.yview_scroll(direction * 3, "units")

    def _reveal_control(self, event) -> None:
        if not self._in_controls(event.widget):
            return
        self.root.update_idletasks()
        canvas = self.controls_canvas
        top = event.widget.winfo_rooty() - self.controls.winfo_rooty()
        bottom = top + event.widget.winfo_height()
        visible_top = canvas.canvasy(0)
        height = canvas.winfo_height()
        if top < visible_top or bottom > visible_top + height:
            target = top - 8 if top < visible_top else bottom - height + 8
            canvas.yview_moveto(max(0, target) / max(1, self.controls.winfo_height()))

    def _wrap_to_width(self, label: tk.Label) -> None:
        label.bind("<Configure>", lambda event: label.configure(wraplength=max(40, event.width - 4)))

    def _build_status(self, root) -> None:
        self.status_labels = {}
        self.status_dots = {}
        self._checks_cache = None
        self._checks_at = 0.0
        for key, title in [("demo", "Demo · localhost:3000"), ("dev", f"Development · localhost:{DEV_PORT}"),
                           ("db", "Local database"), ("checks", "GitHub checks")]:
            row = ttk.Frame(root)
            row.pack(fill="x", pady=(0, 12))
            dot = tk.Label(row, text="●", fg=IDLE)
            dot.grid(row=0, column=0, rowspan=2, padx=(0, 10), sticky="n")
            tk.Label(row, text=title, font=("DejaVu Sans", 10, "bold"), anchor="w").grid(row=0, column=1, sticky="w")
            lab = tk.Label(row, text="Checking…", anchor="w", justify="left", wraplength=500, fg="#b1c1cc")
            lab.grid(row=1, column=1, sticky="ew", pady=(3, 0))
            row.columnconfigure(1, weight=1)
            self._wrap_to_width(lab)
            self.status_labels[key] = lab
            self.status_dots[key] = dot

    def _build_output(self, root) -> None:
        box = ttk.Frame(root, padding=14)
        box.grid(row=2, column=0, sticky="nsew", padx=20, pady=(14, 20))
        bar = ttk.Frame(box)
        bar.pack(fill="x", pady=(0, 10))
        tk.Label(bar, text="Activity", font=("DejaVu Sans", 11, "bold")).pack(side="left")
        ttk.Button(bar, text="Clear", command=self.clear_output).pack(side="right")
        self.copy_btn = ttk.Button(bar, text="Copy log", command=self.copy_output)
        self.copy_btn.pack(side="right", padx=(0, 8))
        self.spinner = tk.Label(box, text="", fg="#b1c1cc", anchor="w", wraplength=500)
        self.spinner.pack(side="bottom", fill="x", pady=(6, 0))
        self._wrap_to_width(self.spinner)
        self.copy_note = tk.Label(box, text="", fg="#95dbc4", anchor="w", wraplength=500)
        self.copy_note.pack(side="bottom", fill="x")
        self._wrap_to_width(self.copy_note)
        self.out = scrolledtext.ScrolledText(
            box, wrap="word", height=7, font=("DejaVu Sans Mono", 9),
            background="#101b25", foreground="#d4e3e8", insertbackground="#edf4f3",
            relief="flat", borderwidth=0, padx=12, pady=10,
        )
        self.out.pack(fill="both", expand=True)
        self.out.configure(state="disabled")

    def _button(self, parent, label, cmd, hint) -> ttk.Button:
        b = ttk.Button(parent, text=label, command=cmd)
        b.pack(fill="x", pady=(2, 6))
        if hint:
            lab = tk.Label(parent, text=hint, fg="#b1c1cc", justify="left", anchor="w", wraplength=500)
            lab.pack(fill="x", pady=(0, 8))
            self._wrap_to_width(lab)
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
            self.out.insert("end", re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", line) + "\n")
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
        self.spinner.configure(text=(f"Working: {what}" if busy else "Ready"))

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
        if self._status_timer is not None:
            self.root.after_cancel(self._status_timer)
        self._status_timer = self.root.after(12000, self._refresh_status)
        if self._status_running:
            return
        self._status_running = True

        def runner() -> None:
            try:
                self._status_worker()
            finally:
                self._status_running = False

        threading.Thread(target=runner, daemon=True).start()

    def _status_worker(self) -> None:
        demo = http_health(DEMO_URL)
        d = demo_status(demo, *self._main_cache)
        self.root.after(0, lambda: self._apply_demo_status(d))
        now = time.monotonic()
        if now - self._main_at > 60:
            self._main_cache = github_main()
            self._main_at = now
            d = demo_status(demo, *self._main_cache)
            self.root.after(0, lambda: self._apply_demo_status(d))

        owner = port_owner_dir(DEV_PORT)
        owned = owned_session_alive(self.dev_proc, self.dev_owner)
        if owner is None:
            v = (IDLE, "no readable listener; Start checks whether the port is available")
        elif Path(owner).resolve() == APP_DIR.resolve():
            v = (OK if owned else WARN, "listener in this checkout; " +
                 ("this window owns a test session" if owned else "external session, protected from Stop"))
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
            self.dev_btn.configure(
                text=("Stop test site" if owned else "Start test site")
            )

        self.root.after(0, apply)

    def _apply_demo_status(self, status: tuple[str, str]) -> None:
        colour, text = status
        self.demo_summary.configure(text=text, fg="#edf4f3")
        self.status_labels["demo"].configure(text=text)
        self.status_dots["demo"].configure(fg=colour)

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
        script = APP_DIR / "scripts" / "ops" / "safe-refresh-walkthrough.py"
        if not script.exists():
            self.say(f"Could not find {script}.")
            return

        def job() -> None:
            self.say("=" * 66)
            self.say("UPDATING THE DEMO. This rebuilds it and restarts it — a few minutes.")
            self.say("A separate candidate is built and the previous demo is retained.")
            self.say("Pending local database migrations are backed up and applied automatically.")
            self.say("=" * 66)
            code = self._stream([sys.executable, str(script)], cwd=APP_DIR)
            self.say("")
            if code == 0:
                self.say("Update command finished. Checking the reported build separately.")
                status, expected = run_quiet(["git", "rev-parse", "HEAD"], cwd=DEMO_DIR)
                health = http_health(DEMO_URL)
                reported = (health or {}).get("commit")
                if (status == 0 and re.fullmatch(r"[0-9a-f]{40,64}", expected)
                        and isinstance(reported, str) and len(reported) >= 12
                        and expected.startswith(reported)):
                    self.say(f"Demo updated to {reported}. Open demo to continue.")
                else:
                    self.say("BUILD IDENTITY UNVERIFIED: the demo did not report its checkout commit.")
                self._main_at = 0.0
            else:
                self.say(f"UPDATE STOPPED (exit {code}). Review the last completed step above.")
                self.say("The demo may need recovery. Check what's running and check the setup.")

        self._work("updating the demo", job)

    def show_update_log(self) -> None:
        def job() -> None:
            receipt = DEMO_DIR.parent.parent / ".openplan-updates/latest.json"
            if not receipt.exists():
                self.say("No update has been recorded yet.")
                return
            record = json.loads(receipt.read_text())
            self.say(f"Last update: {record.get('phase', 'unknown')}")
            if record.get("error"):
                self.say(record["error"])
            path = Path(record["log"]) if record.get("log") else None
            if path and path.is_file():
                self.say(f"Saved log: {path}")
                for line in path.read_text(errors="replace").splitlines()[-120:]:
                    self.say(line)
            else:
                self.say("This older update did not retain a build log. New updates save one automatically.")
        self._work("reading the last update", job)

    def recover_demo(self) -> None:
        script = APP_DIR / "scripts" / "ops" / "safe-refresh-walkthrough.py"

        def job() -> None:
            self.say("RECOVERING THE PREVIOUS DEMO. The service target is checked first.")
            code = self._stream([sys.executable, str(script), "--recover"], cwd=APP_DIR)
            self.say("Recovery command finished." if code == 0 else f"RECOVERY STOPPED (exit {code}). Review the reason above.")

        self._work("recovering the previous demo", job)

    def toggle_dev(self) -> None:
        if owned_session_alive(self.dev_proc, self.dev_owner):
            self.stop_dev()
        else:
            self.start_dev()

    def start_dev(self) -> None:
        def job() -> None:
            if owned_session_alive(self.dev_proc, self.dev_owner):
                self.say("This window already owns a test session.")
                return
            if port_in_use(DEV_PORT) is not False:
                self.say("Start refused: the port is occupied or its availability is unknown.")
                self.say("An external session must be managed by the window that started it.")
                return
            self.say("=" * 66)
            self.say(f"STARTING THE TEST SITE on port {DEV_PORT}.")
            self.say("This serves the code exactly as it is right now. It stays running")
            self.say("until you stop it or close this window.")
            self.say("=" * 66)
            with DEV_LOG.open("w", encoding="utf-8") as log:
                self.dev_proc = subprocess.Popen(
                    ["npm", "run", "dev", "--", "-p", str(DEV_PORT)],
                    cwd=APP_DIR, stdout=log, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            self.dev_owner = process_identity(self.dev_proc.pid)
            if not owned_session_alive(self.dev_proc, self.dev_owner):
                self.say("Started process ownership could not be verified. Automatic Stop is unavailable.")
                return
            self.say(f"Started. Waiting for it to answer (usually 10–30 seconds)…")
            for _ in range(90):
                time.sleep(1)
                listener = port_pid(DEV_PORT)
                identity = process_identity(listener) if listener is not None else None
                if (owned_session_alive(self.dev_proc, self.dev_owner)
                        and identity is not None and identity.session == self.dev_owner.pid
                        and http_health(DEV_URL, timeout=1.5) is not None):
                    self.say("This window's test site is answering.")
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
            if stop_owned_session(self.dev_proc, self.dev_owner):
                self.say("Stop requested for this window's session. Remaining listeners may be external.")
            else:
                self.say("Stop refused: no verified live session owned by this window.")

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
        if self.busy:
            self.say("Wait for the current action to finish before closing this window.")
            return
        if owned_session_alive(self.dev_proc, self.dev_owner):
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
                try:
                    stopped = stop_owned_session(self.dev_proc, self.dev_owner)
                except OSError as exc:
                    self.say(f"Stop failed: {exc}")
                    return
                if not stopped:
                    self.say("Stop refused: process ownership changed. The window remains open.")
                    win.destroy()
                    return
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
