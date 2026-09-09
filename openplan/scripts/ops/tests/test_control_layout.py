#!/usr/bin/env python3
"""Real Tk geometry and keyboard checks for the desktop controller.

Run separately from the inert controller suite. Status collection and app
commands are forbidden. Optional native Wayland captures use Spectacle and
CONTROL_LAYOUT_CAPTURE_DIR. This does not test running services.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tkinter as tk
from tkinter import ttk
import types
import unittest
from unittest.mock import patch

REAL_POPEN = subprocess.Popen

SOURCE = Path(__file__).resolve().parents[1] / "openplan-control-panel.py"
sys.path.insert(0, str(SOURCE.parent))
panel = types.ModuleType("layout_panel")
panel.__file__ = str(SOURCE)
sys.modules[panel.__name__] = panel
source = Path(os.environ.get("CONTROL_PANEL_TEST_SOURCE", SOURCE)).read_text()
exec(compile(source, str(SOURCE), "exec"), panel.__dict__)


class LayoutTests(unittest.TestCase):
    def test_output_wrapping_and_keyboard_at_sizes_and_scales(self):
        for scale in (1.33, 2.0):
            for width, height in ((820, 760), (640, 700)):
                with self.subTest(scale=scale, size=(width, height)):
                    self.check_layout(scale, width, height)

    def check_layout(self, scale, width, height):
        with tempfile.TemporaryDirectory(prefix="openplan-layout-") as temp:
            with patch.object(panel, "LOG_DIR", Path(temp)), \
                 patch.object(panel.ControlPanel, "_refresh_status"), \
                 patch.object(panel.subprocess, "Popen", side_effect=AssertionError("command forbidden")), \
                 patch.object(panel, "run_quiet", side_effect=AssertionError("command forbidden")):
                root = tk.Tk()
                try:
                    root.tk.call("tk", "scaling", scale)
                    app = panel.ControlPanel(root)
                    root.geometry(f"{width}x{height}+0+0")
                    # Explicit stress text, never represented as operational evidence.
                    for key, label in app.status_labels.items():
                        label.configure(text=f"Layout exercise: {key}. " + "Long status with a retained source path and unverified build identity. " * 3)
                    app.demo_summary.configure(text="Demo v0.46.0 · aaaaaaaaaaaa\nGitHub main · bbbbbbbbbbbb\nUpdate available · 128 commits behind main. Checked 23:59:59")
                    app.say("Layout exercise output: retained while resizing and tabbing.")
                    app._pump_output()
                    app.spinner.configure(text="Layout exercise: recovering the previous demo")
                    app.copy_note.configure(text="Layout exercise: copied 120 lines")
                    app.tabs.select(2)
                    for _ in range(8):
                        root.update()
                    self.assertGreaterEqual(app.out.winfo_height(), 100, "output collapsed")
                    for widget in (app.out, app.copy_btn):
                        self.assert_visible(widget, root)
                    for label in app.status_labels.values():
                        self.assertLessEqual(label.winfo_rootx() + label.winfo_width(), root.winfo_rootx() + width, "status exceeds window")
                        self.assertLessEqual(int(label.cget("wraplength")), label.winfo_width(), "status wraps beyond its allocation")
                        self.assertGreaterEqual(label.winfo_height(), label.winfo_reqheight(), "status text vertically clipped")
                    root.focus_force()
                    seen = set()
                    for tab in range(3):
                        app.tabs.select(tab)
                        root.update()
                        app.tabs.focus_set()
                        for _ in range(40):
                            root.event_generate("<Tab>")
                            root.update()
                            focus = root.focus_get()
                            if focus in app._buttons:
                                seen.add(focus)
                                self.assert_visible(focus, app.controls_canvas if app._in_controls(focus) else app.tabs)
                                self.assertGreaterEqual(focus.winfo_height(), focus.winfo_reqheight(), "button vertically clipped")
                            if focus == app.copy_btn:
                                seen.add(focus)
                        self.assert_visible(app.out, root)
                        if tab < 2:
                            def check_labels(widget):
                                for child in widget.winfo_children():
                                    if isinstance(child, tk.Label):
                                        self.assertGreaterEqual(child.winfo_height(), child.winfo_reqheight(), f"label vertically clipped: {child.cget('text')}")
                                        self.assert_visible(child, app.tabs)
                                    check_labels(child)
                            check_labels(root.nametowidget(app.tabs.select()))
                        capture = os.environ.get("CONTROL_LAYOUT_CAPTURE_DIR")
                        if capture:
                            folder = Path(capture)
                            folder.mkdir(parents=True, exist_ok=True)
                            # The only real command in this fixture takes a screenshot.
                            with patch.object(subprocess, "Popen", REAL_POPEN):
                                subprocess.run(["spectacle", "-a", "-b", "-n", "-o",
                                    str(folder / f"control-{width}-{height}-scale-{scale}-tab-{tab}.png")],
                                    check=True, capture_output=True, timeout=10)
                            (folder / "source-sha256.txt").write_text(hashlib.sha256(source.encode()).hexdigest() + "\n")
                    self.assertTrue(set(app._buttons + [app.copy_btn]).issubset(seen), "keyboard cannot reach all controls")
                    self.assertIn("retained while resizing", app.out.get("1.0", "end"))
                finally:
                    for timer in root.tk.call("after", "info"):
                        root.after_cancel(timer)
                    root.destroy()

    def assert_visible(self, widget, boundary):
        self.assertTrue(widget.winfo_ismapped(), "widget is unmapped")
        self.assertGreaterEqual(widget.winfo_rootx(), boundary.winfo_rootx(), "widget left of viewport")
        self.assertLessEqual(widget.winfo_rootx() + widget.winfo_width(), boundary.winfo_rootx() + boundary.winfo_width(), "widget right of viewport")
        self.assertGreaterEqual(widget.winfo_rooty(), boundary.winfo_rooty(), "keyboard focus above viewport")
        self.assertLessEqual(widget.winfo_rooty() + widget.winfo_height(), boundary.winfo_rooty() + boundary.winfo_height(), "widget below viewport")


def prove_mutations():
    mutations = [
        ("comment", "# -- layout", "# layout", True),
        ("collapsed output", 'self.out.pack(fill="both", expand=True)', 'self.out.pack_forget()', False),
        ("overflowing status", "wraplength=max(40, event.width - 4)", "wraplength=10000", False),
        ("hidden keyboard focus", 'root.bind("<FocusIn>", self._reveal_control, add="+")', 'root.bind("<FocusIn>", lambda event: None, add="+")', False),
    ]
    with tempfile.TemporaryDirectory(prefix="openplan-layout-mutations-") as temp:
        for label, old, new, expected_survivor in mutations:
            assert source.count(old) == 1, f"Ambiguous mutation: {label}"
            mutant = Path(temp) / "panel.py"
            mutant.write_text(source.replace(old, new))
            env = {**os.environ, "CONTROL_PANEL_TEST_SOURCE": str(mutant), "PYTHONDONTWRITEBYTECODE": "1"}
            env.pop("CONTROL_LAYOUT_CAPTURE_DIR", None)
            result = subprocess.run([sys.executable, "-B", __file__], env=env, capture_output=True, text=True, timeout=30)
            survived = result.returncode == 0
            print(f"{label}: {'SURVIVED' if survived else 'KILLED'}", flush=True)
            if not survived:
                print(result.stderr, flush=True)
                assert "AssertionError" in result.stderr and "FAILED (" in result.stderr
            assert survived == expected_survivor, label


if __name__ == "__main__":
    if sys.argv[1:] == ["--prove-mutations"]:
        prove_mutations()
    else:
        unittest.main()
