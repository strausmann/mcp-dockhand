#!/usr/bin/env bash
# sync-upstream.sh — detect new upstream releases and rebase the hardened
# branch onto them. Designed to be called by CI (Jenkinsfile) or by hand.
#
# Subcommands:
#   detect            Print the newest upstream release tag if the hardened
#                     branch is not yet based on it; print nothing if up to
#                     date. Exit 0 either way (CI branches on the output).
#   sync <tag>        Fast-forward the mirror branch to upstream and rebase
#                     the hardened branch onto <tag>. Fails closed (rebase
#                     aborted, branch untouched) on unresolved conflicts.
#   verify            npm ci + audit + build + test.
#
# Environment overrides:
#   UPSTREAM_REMOTE (upstream)  ORIGIN_REMOTE (origin)
#   UPSTREAM_BRANCH (main)      MIRROR_BRANCH (main)
#   HARDENED_BRANCH (hardened)  TAG_GLOB (v*)
#
# Exit codes: 0 ok / nothing to do, 1 usage or precondition failure,
#             3 rebase conflict needing a human (branch left untouched).

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
ORIGIN_REMOTE="${ORIGIN_REMOTE:-origin}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
MIRROR_BRANCH="${MIRROR_BRANCH:-main}"
HARDENED_BRANCH="${HARDENED_BRANCH:-hardened}"
TAG_GLOB="${TAG_GLOB:-v*}"

log() { echo "[sync-upstream] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_remote() {
  git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1 \
    || die "remote '$UPSTREAM_REMOTE' is not configured (git remote add $UPSTREAM_REMOTE <url>)"
}

require_clean_worktree() {
  git update-index -q --refresh
  git diff-index --quiet HEAD -- \
    || die "worktree has uncommitted changes; refusing to sync"
}

fetch_upstream() {
  git fetch "$UPSTREAM_REMOTE" --tags --prune --quiet
}

latest_upstream_tag() {
  # Highest semver-ish tag matching TAG_GLOB. The fork must not create its
  # own tags matching this glob (use hardened-* for fork tags).
  git tag --list "$TAG_GLOB" --sort=-v:refname | head -n1
}

cmd_detect() {
  require_remote
  fetch_upstream
  local tag
  tag="$(latest_upstream_tag)"
  [ -n "$tag" ] || { log "no tags matching '$TAG_GLOB' found"; exit 0; }
  if git merge-base --is-ancestor "refs/tags/$tag" "refs/heads/$HARDENED_BRANCH" 2>/dev/null; then
    log "up to date: $HARDENED_BRANCH already contains $tag"
    exit 0
  fi
  echo "$tag"   # the only stdout this subcommand produces
}

cmd_sync() {
  local tag="${1:-}"
  [ -n "$tag" ] || die "usage: $0 sync <tag>"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null || die "tag '$tag' not found (run detect first)"

  require_remote
  require_clean_worktree

  # rerere is the only sanctioned automatic conflict resolution: it replays
  # resolutions a human made once. Never add -X ours/-X theirs here.
  git config rerere.enabled true
  git config rerere.autoUpdate true

  log "fast-forwarding mirror '$MIRROR_BRANCH' to $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  git checkout -q "$MIRROR_BRANCH"
  git merge --ff-only "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" \
    || die "mirror branch '$MIRROR_BRANCH' has diverged from upstream — it must stay pristine. Investigate manually."

  log "rebasing '$HARDENED_BRANCH' onto $tag"
  git checkout -q "$HARDENED_BRANCH"
  local prev_head
  prev_head="$(git rev-parse HEAD)"

  if ! git rebase "refs/tags/$tag"; then
    # The rebase stopped. If rerere (autoUpdate) resolved and staged every
    # conflicted file, continue; repeat for subsequent commits. Any hunk
    # rerere could not resolve => fail closed.
    local rounds=0
    while [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; do
      rounds=$((rounds + 1))
      if [ "$rounds" -gt 100 ]; then
        git rebase --abort
        die "rebase exceeded 100 continuation rounds; aborted (branch untouched)"
      fi
      if git ls-files --unmerged | grep -q .; then
        log "unresolved conflict rerere could not replay:"
        git diff --name-only --diff-filter=U >&2
        git rebase --abort
        log "rebase aborted; '$HARDENED_BRANCH' left at $prev_head"
        exit 3
      fi
      # All conflicts staged by rerere — continue non-interactively.
      GIT_EDITOR=true git rebase --continue || true
    done
  fi

  log "rebase complete: $HARDENED_BRANCH is now $(git rev-parse --short HEAD) on top of $tag"
}

cmd_verify() {
  [ -f package.json ] || die "no package.json here"
  npm ci
  npm audit --audit-level=high
  npm run build --if-present
  npm test --if-present
  log "verify passed"
}

case "${1:-}" in
  detect) shift; cmd_detect "$@" ;;
  sync)   shift; cmd_sync "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  *) sed -n '2,20p' "$0" >&2; exit 1 ;;
esac
