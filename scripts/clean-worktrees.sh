#!/usr/bin/env bash

# Remove unused issue worktrees created by codex-issue.sh and prune stale Git
# worktree records. Local branches are preserved.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/clean-worktrees.sh [--dry-run]

Remove clean issue worktrees from the sibling <repo>-wt directory, then run
git worktree prune. Worktrees with local changes or launcher locks are skipped.
Use --dry-run to preview the worktrees that would be removed.
EOF
}

case "${1:-}" in
  "") ;;
  --dry-run) dry_run=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }
dry_run="${dry_run:-false}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." && pwd -P)"
[[ -d "${repo_root}/.git" ]] || {
  printf 'Error: run the script from a copy in the main worktree.\n' >&2
  exit 1
}

repo_name="$(basename -- "$repo_root")"
worktree_base="$(dirname -- "$repo_root")/${repo_name}-wt"
worktrees="$(git -C "$repo_root" worktree list --porcelain)"
removed=0
skipped=0

process_worktree() {
  local issue_number lock_dir

  [[ -n "$record_path" ]] || return 0
  case "$record_path" in
    "${worktree_base}/${repo_name}-issue-"*) ;;
    *) return 0 ;;
  esac

  issue_number="${record_path#"${worktree_base}/${repo_name}-issue-"}"
  [[ "$issue_number" =~ ^[1-9][0-9]*$ ]] || return 0
  [[ "$record_branch" == "refs/heads/feat/issue-${issue_number}" ]] || return 0

  # A missing directory is handled by prune, without touching the filesystem.
  [[ -d "$record_path" && ! -L "$record_path" ]] || return 0
  lock_dir="${worktree_base}/.codex-issue-${issue_number}.lock"
  if [[ "$record_locked" == true || -e "$lock_dir" ]]; then
    printf 'Skipped (locked): %s\n' "$record_path"
    skipped=$((skipped + 1))
    return 0
  fi

  if [[ -n "$(git -C "$record_path" status --porcelain --untracked-files=all)" ]]; then
    printf 'Skipped (local changes): %s\n' "$record_path"
    skipped=$((skipped + 1))
    return 0
  fi

  if [[ "$dry_run" == true ]]; then
    printf 'Would remove: %s\n' "$record_path"
  elif git -C "$repo_root" worktree remove "$record_path"; then
    printf 'Removed: %s\n' "$record_path"
  else
    printf 'Skipped (Git could not remove): %s\n' "$record_path" >&2
    skipped=$((skipped + 1))
    return 0
  fi
  removed=$((removed + 1))
}

record_path=""
record_branch=""
record_locked=false
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    "worktree "*)
      process_worktree
      record_path="${line#worktree }"
      record_branch=""
      record_locked=false
      ;;
    "branch "*) record_branch="${line#branch }" ;;
    locked|"locked "*) record_locked=true ;;
  esac
done <<< "$worktrees"
process_worktree

if [[ "$dry_run" == true ]]; then
  printf 'Dry run: %s worktree(s) could be removed; %s skipped. Git metadata was not pruned.\n' "$removed" "$skipped"
else
  git -C "$repo_root" worktree prune
  printf 'Pruned stale Git worktree records. Removed %s worktree(s); skipped %s.\n' "$removed" "$skipped"
  if [[ -d "$worktree_base" ]]; then
    rmdir "$worktree_base" 2>/dev/null || true
  fi
fi
