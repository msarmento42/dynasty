#!/usr/bin/env bash
# Spin up an isolated git worktree for parallel Claude Code / Cowork sessions
# against this repo, so two agents working at the same time (e.g. one on a
# feature branch, one on a manual AGIOS escalation fix) never collide on the
# same working directory or clobber each others uncommitted changes.
#
# Usage:
#   scripts/new-worktree.sh <branch-name>
#
# Creates ../<repo-name>-<branch-name>/ as a sibling directory, on a new
# branch of the same name, checked out from the current HEAD. Open that
# directory as its own Claude Code / Cowork session.
#
# Clean up when done:
#   git worktree remove ../<repo-name>-<branch-name>
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <branch-name>" >&2
  exit 1
fi

BRANCH="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
TARGET="$REPO_ROOT/../${REPO_NAME}-${BRANCH}"

git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$TARGET"
echo
echo "Worktree ready: $TARGET (branch: $BRANCH)"
echo "Open that folder as its own Claude Code / Cowork session."
echo "When finished: git worktree remove '$TARGET'"
