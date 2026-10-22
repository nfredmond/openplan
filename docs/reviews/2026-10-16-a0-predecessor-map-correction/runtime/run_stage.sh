#!/bin/sh
# Root's parent invokes exactly one independently reviewed stage per call.
set -eu
umask 077
[ "$#" -eq 1 ] || exit 2
exec /usr/bin/python3 -B "$(dirname "$0")/controller.py" --launch "$1"
