# Codex issue worktrees

Use one terminal session per open GitHub issue:

```bash
./scripts/codex-issue.sh 123
```

The launcher reads the issue with GitHub CLI, fetches `origin/main`, checks declared dependencies, creates or reuses `../cocos-challenge-backend-wt/cocos-challenge-backend-issue-123` on branch `feat/issue-123`, and starts Codex there. It does not push, merge, or create a pull request.

## Prerequisites

- A committed `main` branch and an `origin` remote pointing to the GitHub repository.
- Authenticated GitHub CLI (`gh auth login`).
- `codex` CLI available in `PATH`.

## Issue dependencies

Each issue must contain a `## Dependencies` section with one of these forms:

```md
## Dependencies

- None
```

```md
## Dependencies

- Blocked by: #123 — required API contract
```

For every `Blocked by` issue, the launcher checks that it is closed by a PR merged into `main`, or that a merged PR came from its `feat/issue-N` branch, and that the merge commit is present in fetched `origin/main`. An issue with unresolved dependencies cannot start. The launcher does not infer dependencies from ordinary references elsewhere in an issue.

## Safety and reuse

- The main working tree is not checked out, reset, cleaned, merged, or pushed.
- An existing issue worktree is reused only when it is on the expected branch; local changes are preserved.
- A per-issue lock prevents two launcher sessions from editing the same worktree concurrently.
- An issue must be open. The launcher rejects missing or closed issues.

Preview removal of clean issue worktrees:

```bash
./scripts/clean-worktrees.sh --dry-run
```

Remove them and prune stale Git worktree records:

```bash
./scripts/clean-worktrees.sh
```

Cleanup skips worktrees with local changes or launcher locks, and preserves local branches. If a launcher was forcibly terminated and left a stale lock, confirm that no session is running before removing the reported `.codex-issue-N.lock` directory.
