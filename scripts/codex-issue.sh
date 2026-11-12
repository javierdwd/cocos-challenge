#!/usr/bin/env bash

# Start one isolated Codex session for an open GitHub issue.
# The session runs in a sibling Git worktree and never alters the caller's
# working tree.

set -euo pipefail

readonly DEFAULT_BASE_BRANCH="main"

usage() {
  cat <<'EOF'
Usage: ./scripts/codex-issue.sh <issue-number>

Creates or safely reuses a sibling Git worktree for an open GitHub issue,
then starts Codex in that worktree. A second active session for the same issue
is refused.

Example:
  ./scripts/codex-issue.sh 123
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

worktree_for_branch() {
  local expected_ref="$1"

  # Worktree porcelain is designed for scripts. Keep the whole path after the
  # "worktree " prefix so paths containing spaces remain valid.
  git worktree list --porcelain | awk -v expected_ref="$expected_ref" '
    /^worktree / { path = substr($0, 10); next }
    $0 == "branch " expected_ref { print path; exit }
  '
}

dependency_numbers() {
  # Read only the standard section so ordinary issue references elsewhere in
  # the body do not accidentally become execution gates.
  local line in_dependencies=false remainder
  local -a dependencies=()

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^#{1,6}[[:space:]]+Dependencies[[:space:]]*$ ]]; then
      in_dependencies=true
      continue
    fi

    if [[ "$in_dependencies" == true && "$line" =~ ^#{1,6}[[:space:]] ]]; then
      break
    fi

    if [[ "$in_dependencies" == true && "$line" =~ ^[[:space:]]*[-*][[:space:]]+Blocked[[:space:]]+by:[[:space:]]* ]]; then
      remainder="$line"
      while [[ "$remainder" =~ \#([1-9][0-9]*) ]]; do
        dependencies+=("${BASH_REMATCH[1]}")
        remainder="${remainder#*"${BASH_REMATCH[0]}"}"
      done
    fi
  done <<< "$issue_body"

  if [[ ${#dependencies[@]} -gt 0 ]]; then
    printf '%s\n' "${dependencies[@]}" | sort -nu
  fi
}

assert_dependencies_merged() {
  local dependency_number dependency_state merge_commits merge_commit
  local -a blockers=()

  if ! grep -Eq '^#{1,6}[[:space:]]+Dependencies[[:space:]]*$' <<< "$issue_body"; then
    fail "Issue #$issue_number has no ## Dependencies section. Add '- None' or its explicit Blocked by issues before starting Codex."
  fi

  while IFS= read -r dependency_number; do
    [[ -n "$dependency_number" ]] || continue

    dependency_state="$(gh issue view "$dependency_number" --repo "$github_repo" --json state --jq .state)" \
      || fail "Could not read dependency #$dependency_number in $github_repo."
    if [[ "$dependency_state" != "CLOSED" ]]; then
      blockers+=("#$dependency_number is $dependency_state")
      continue
    fi

    # A closed issue alone is not sufficient: require a PR that closed the
    # issue, targeted main, and whose merge commit is now in origin/main.
    merge_commits="$(gh api graphql \
      -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { closedByPullRequestsReferences(first: 100) { nodes { baseRefName mergedAt mergeCommit { oid } } } } } }' \
      -F owner="$github_owner" \
      -F name="$github_name" \
      -F number="$dependency_number" \
      --jq '.data.repository.issue.closedByPullRequestsReferences.nodes[] | select(.baseRefName == "main" and .mergedAt != null and .mergeCommit.oid != null) | .mergeCommit.oid')" \
      || fail "Could not inspect the closing pull requests for dependency #$dependency_number."

    # GitHub only lists a PR as a closing PR when it closes the issue itself.
    # An issue may instead be closed manually after its implementation PR was
    # merged. In this repo, issue work branches use feat/issue-N, so also
    # recognize a merged PR from that exact branch.
    if [[ -z "$merge_commits" ]]; then
      merge_commits="$(gh api graphql \
        -f query='query($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { pullRequests(first: 100, states: MERGED, headRefName: $head) { nodes { baseRefName mergedAt mergeCommit { oid } } } } }' \
        -F owner="$github_owner" \
        -F name="$github_name" \
        -F head="feat/issue-$dependency_number" \
        --jq '.data.repository.pullRequests.nodes[] | select(.baseRefName == "main" and .mergedAt != null and .mergeCommit.oid != null) | .mergeCommit.oid')" \
        || fail "Could not inspect merged issue branches for dependency #$dependency_number."
    fi

    local dependency_is_in_main=false
    while IFS= read -r merge_commit; do
      [[ -n "$merge_commit" ]] || continue
      if git merge-base --is-ancestor "$merge_commit" "origin/${DEFAULT_BASE_BRANCH}"; then
        dependency_is_in_main=true
        break
      fi
    done <<< "$merge_commits"

    if [[ "$dependency_is_in_main" != true ]]; then
      blockers+=("#$dependency_number is closed but has no closing PR merged into origin/${DEFAULT_BASE_BRANCH}")
    fi
  done < <(dependency_numbers)

  if [[ ${#blockers[@]} -gt 0 ]]; then
    printf 'Cannot start Codex for issue #%s: unresolved dependencies:\n' "$issue_number" >&2
    printf '  - %s\n' "${blockers[@]}" >&2
    fail "Merge every Blocked by issue into ${DEFAULT_BASE_BRANCH} before starting this issue."
  fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ $# -eq 1 ]] || {
  usage >&2
  exit 1
}

issue_number="$1"
[[ "$issue_number" =~ ^[1-9][0-9]*$ ]] || fail "Issue number must be a positive integer."

require_command git
require_command gh
require_command codex

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Run this command from inside a Git worktree."
repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
worktree_base="$(dirname "$repo_root")/${repo_name}-wt"

git remote get-url origin >/dev/null 2>&1 || fail "The repository has no origin remote."

if ! gh auth status >/dev/null 2>&1; then
  fail "GitHub CLI is not authenticated. Run: gh auth login"
fi

github_repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
  || fail "Could not determine the GitHub repository through gh."
github_owner="${github_repo%%/*}"
github_name="${github_repo#*/}"

issue_state="$(gh issue view "$issue_number" --repo "$github_repo" --json state --jq .state 2>/dev/null)" \
  || fail "Could not find issue #$issue_number in $github_repo."
[[ "$issue_state" == "OPEN" ]] || fail "Issue #$issue_number is $issue_state; only open issues can be started."

# Serialize launches per issue. Reusing a worktree is useful for a later
# session, but two simultaneous Codex processes must not edit it together.
mkdir -p "$worktree_base"
lock_dir="${worktree_base}/.codex-issue-${issue_number}.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  if [[ -r "${lock_dir}/pid" ]]; then
    lock_pid="$(<"${lock_dir}/pid")"
    if [[ "$lock_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
      fail "Issue #$issue_number already has an active launcher (PID $lock_pid). Close that Codex session before starting another."
    fi
  fi
  fail "Issue #$issue_number has a stale or incomplete launcher lock at $lock_dir. Remove that lock directory after confirming no session is running, then retry."
fi
printf '%s\n' "$$" > "${lock_dir}/pid"
trap 'rm -f "${lock_dir}/pid"; rmdir "$lock_dir" 2>/dev/null || true' EXIT

issue_title="$(gh issue view "$issue_number" --repo "$github_repo" --json title --jq .title)"
issue_body="$(gh issue view "$issue_number" --repo "$github_repo" --json body --jq .body)"
issue_url="$(gh issue view "$issue_number" --repo "$github_repo" --json url --jq .url)"

printf 'Updating origin/%s...\n' "$DEFAULT_BASE_BRANCH"
git fetch --no-tags origin "+refs/heads/${DEFAULT_BASE_BRANCH}:refs/remotes/origin/${DEFAULT_BASE_BRANCH}"

assert_dependencies_merged

branch_name="feat/issue-${issue_number}"
branch_ref="refs/heads/${branch_name}"
worktree_path="${worktree_base}/${repo_name}-issue-${issue_number}"

if [[ -e "$worktree_path" ]]; then
  [[ -d "$worktree_path" ]] || fail "Worktree path exists but is not a directory: $worktree_path"
  git -C "$worktree_path" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || fail "Worktree path exists but is not a Git worktree: $worktree_path"

  existing_branch="$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD 2>/dev/null)" \
    || fail "Existing worktree is detached; refusing to reuse it: $worktree_path"
  [[ "$existing_branch" == "$branch_name" ]] \
    || fail "Existing worktree uses branch '$existing_branch', expected '$branch_name': $worktree_path"

  printf 'Reusing existing worktree: %s\n' "$worktree_path"
else
  mkdir -p "$worktree_base"

  if git show-ref --verify --quiet "$branch_ref"; then
    attached_path="$(worktree_for_branch "$branch_ref")"
    [[ -z "$attached_path" ]] \
      || fail "Branch '$branch_name' is already checked out in: $attached_path"

    printf 'Creating worktree from existing branch %s...\n' "$branch_name"
    git worktree add "$worktree_path" "$branch_name"
  else
    printf 'Creating branch %s from origin/%s...\n' "$branch_name" "$DEFAULT_BASE_BRANCH"
    git worktree add -b "$branch_name" "$worktree_path" "origin/${DEFAULT_BASE_BRANCH}"
  fi
fi

prompt="$(cat <<EOF
Work exclusively inside this worktree: $worktree_path

Issue #$issue_number: $issue_title
URL: $issue_url

Issue description:
$issue_body

Execution gate: do not begin implementation unless every issue listed under the Dependencies section as Blocked by has been merged and is present in main. The launcher has checked this before starting; if a dependency later becomes unavailable or the issue body is ambiguous, stop and report the blocker.

Follow docs/CODEX-ISSUE-WORKFLOW.md and AGENTS.md:
1. Check prerequisites, acceptance criteria, project conventions, and dependency status.
2. Briefly explain the issue's problem and planned changes to the user before coding. Ask for clarification only when an unresolved detail blocks correct implementation.
3. Implement the issue's requirements and acceptance criteria within this worktree. Add or update tests when appropriate and run relevant checks.
4. Keep code, comments, identifiers, and folder and file names in English.

Do not push, merge, create pull requests, or make changes outside this worktree. When finished, summarize the modified files, checks performed, and any blockers or limitations.
EOF
)"

printf 'Starting Codex in: %s\n' "$worktree_path"
codex -C "$worktree_path" "$prompt"
