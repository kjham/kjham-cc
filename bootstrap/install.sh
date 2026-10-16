#!/usr/bin/env bash
# macOS·Linux: ./bootstrap/install.sh [--dev] [--settings-only] [--dry-run]
set -euo pipefail
node "$(dirname "$0")/install.mjs" "$@"
