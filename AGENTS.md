# Repository guide

## Project context

- This repository is for the Cocos Challenge Backend REST API.
- Read [docs/PRD.md](docs/PRD.md) for requirements and [docs/ADRs/README.md](docs/ADRs/README.md) for architecture decisions. Use GitHub issues to track implementation work.
- Use [docs/CODEX-ISSUE-WORKFLOW.md](docs/CODEX-ISSUE-WORKFLOW.md) when starting work from a GitHub issue.
- The challenge brief in [docs/PRD.md](docs/PRD.md) is the current product source. Use its table descriptions as the proposed data model.

## Language convention

- **All code, comments, identifiers, and folder and file names must be in English.** This applies to future work throughout the repository.
- Write new technical documentation in English for consistency. User-facing conversation can follow the user's language.

## Working agreements

- Keep product requirements, assumptions, and accepted technical decisions distinct.
- Document consequential design choices in an ADR, including any changes to the proposed schema in the PRD and their justification.
- Keep issues and documentation aligned with implemented behavior.
- Make small, reviewable changes and run checks appropriate to the affected code. A functional test of order submission is required.
- Do not introduce authentication solely for this challenge; the PRD records it as out of scope.
- Do not commit secrets or sensitive data.

## Repository roles

- `project-manager`: scope, priorities, and documentation consistency.
- `engineering-leader`: architecture choices and ADRs.
- `senior-developer`: implementation and verification.

Use the role that fits the task. Direct user instructions take precedence over role guidance.
