#!/bin/sh
set -eu
entrypoint_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$entrypoint_dir/scripts/runtime/launch.mjs" "$@"
