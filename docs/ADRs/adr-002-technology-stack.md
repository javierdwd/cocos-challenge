# ADR-002: Technology stack

- Date: 2026-11-12
- Status: Accepted
- Related requirements: [Technical considerations and functional order test](../PRD.md)
- GitHub issue: [#1 — Bootstrap NestJS API with a health endpoint](https://github.com/javierdwd/cocos-challenge/issues/1).

## Context and options

The challenge requires a Node.js REST API, SQL persistence, and a functional order-submission test. We considered Express or NestJS, and direct SQL, Kysely, or Prisma for data access.

## Decision

Use TypeScript and NestJS with feature modules, controllers, services, and DTOs validated through `class-validator` and Nest's `ValidationPipe`. Use PostgreSQL with Prisma 7 for data access. Docker Compose starts both the API and database locally on Node.js 24 LTS, with ESM and npm plus a lockfile; no cloud services are needed. Use a versioned database migration to create the portfolio view from ADR-001. Provide a Bruno collection with example requests; Swagger is not required. Use NestJS's built-in `Logger` with JSON output to stdout; do not add OpenTelemetry or a custom logging module for this challenge. Use Vitest and Supertest for the functional order-submission test against a test PostgreSQL database.

## Rationale and consequences

NestJS provides the requested module structure, while Prisma supplies typed database access and transactions. The portfolio view needs explicit database SQL in a migration. Setup instructions must cover Compose and migrations. The implementation must include the required functional order-submission test.

## Validation

Verify that `docker compose up` starts the API and database, migrations create the view, DTO validation rejects invalid requests, Bruno requests run against the local API, and the functional order test passes.
