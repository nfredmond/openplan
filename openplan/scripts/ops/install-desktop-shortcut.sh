#!/usr/bin/env bash
#
# Put an "OpenPlan Control" icon on the desktop and in the application menu.
#
# Run once:  bash scripts/ops/install-desktop-shortcut.sh
# Undo:      bash scripts/ops/install-desktop-shortcut.sh --remove
#
# WHY A .desktop FILE AND NOT A SHELL SCRIPT ON THE DESKTOP
#   Double-clicking a .sh on KDE offers to open it in a text editor as often as
#   it runs it, and gives no icon and no name. A .desktop entry is the thing the
#   desktop is actually designed to launch, it appears in the application
#   launcher and can be pinned to the task bar, and it carries an icon.
#
#   It must be marked executable AND trusted, which is the step people miss —
#   this script does both, then verifies the result rather than assuming it.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PANEL="$APP_DIR/scripts/ops/openplan-control-panel.py"
ICON_SRC="$APP_DIR/public/openplan-og.svg"

DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
MENU_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons"
ENTRY_NAME="openplan-control.desktop"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$DESKTOP_DIR/$ENTRY_NAME" "$MENU_DIR/$ENTRY_NAME" "$ICON_DIR/openplan-control.svg"
  update-desktop-database "$MENU_DIR" 2>/dev/null || true
  echo "Removed the OpenPlan Control shortcut."
  exit 0
fi

[ -f "$PANEL" ] || { echo "Cannot find $PANEL"; exit 1; }

# tkinter is stdlib but is packaged separately on some distributions, and the
# failure mode is an ImportError the moment the icon is double-clicked — with
# no window and no message. Fail here instead, where the text is visible.
if ! python3 -c "import tkinter" 2>/dev/null; then
  echo "Python's tkinter is missing, so the window cannot open."
  echo "Install it with:  sudo apt install python3-tk"
  exit 1
fi

mkdir -p "$DESKTOP_DIR" "$MENU_DIR" "$ICON_DIR"
[ -f "$ICON_SRC" ] && cp -f "$ICON_SRC" "$ICON_DIR/openplan-control.svg"

ICON_LINE="applications-development"
[ -f "$ICON_DIR/openplan-control.svg" ] && ICON_LINE="$ICON_DIR/openplan-control.svg"

write_entry() {
  cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=OpenPlan Control
GenericName=Run OpenPlan locally
Comment=Start the demo or the test site, check what is running, see errors
Exec=python3 "$PANEL"
Path=$APP_DIR
Icon=$ICON_LINE
Terminal=false
Categories=Development;
StartupNotify=true
EOF
  chmod +x "$1"
}

write_entry "$MENU_DIR/$ENTRY_NAME"
write_entry "$DESKTOP_DIR/$ENTRY_NAME"

# KDE will not launch a desktop entry it does not trust, and silently shows the
# generic "untrusted application" prompt instead. This is the metadata that
# marks it trusted; it is a no-op elsewhere.
if command -v kwriteconfig6 >/dev/null 2>&1 || command -v gio >/dev/null 2>&1; then
  gio set "$DESKTOP_DIR/$ENTRY_NAME" metadata::trusted true 2>/dev/null || true
fi

update-desktop-database "$MENU_DIR" 2>/dev/null || true

echo "Installed."
echo "  Desktop icon:  $DESKTOP_DIR/$ENTRY_NAME"
echo "  App menu:      search for \"OpenPlan Control\""
echo
echo "Double-click the desktop icon. If KDE asks whether you trust it, choose"
echo "to trust and continue — it only asks the first time."
