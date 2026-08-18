#!/bin/sh
# CodeGraph index sync — refresh the knowledge-graph index before committing.
# Fails open: never blocks git. `codegraph sync -q` is documented "for git hooks".
set -u
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"

# No CodeGraph index in this project -> nothing to sync, skip silently.
[ -d "$repo_root/.codegraph" ] || exit 0

if command -v codegraph >/dev/null 2>&1; then
  if codegraph sync -q "$repo_root" >/dev/null 2>&1; then
    echo "codegraph: index synced"
  else
    echo "codegraph: warning - sync failed (index may be stale); run 'codegraph sync' manually" >&2
  fi
else
  echo "codegraph: not found on PATH - skipping index sync" >&2
fi
exit 0