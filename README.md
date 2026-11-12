# Cocos Challenge Backend

NestJS REST API for the Cocos Challenge. This stage exposes liveness, instrument search, and portfolio endpoints; order endpoints are planned in later issues. See [the PRD](docs/PRD.md) and [architecture decisions](docs/ADRs/README.md) for the product and technical contracts.

## Prerequisites

- Node.js 24 and npm 11 (`.nvmrc` selects Node 24 when using nvm).
- Docker and the Docker Compose plugin for the local database.

## Install and run

First create an ignored local `.env` file with a generated password:

```bash
printf 'POSTGRES_USER=cocos\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=cocos\n' "$(openssl rand -hex 24)" > .env
```

The variable names are also listed in [`.env.example`](.env.example). Keep `.env` local. For a host Node process, start PostgreSQL and construct a host-side connection URL from that file:

```bash
docker compose up -d db
set -a; . ./.env; set +a
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${DB_HOST_PORT:-55432}/${POSTGRES_DB}"
npm ci
npm run prisma:migrate:deploy
npm run db:seed
npm run build
npm start
```

`prisma:migrate:deploy` applies pending versioned migrations. `db:seed` loads the three retained sample users, 65 share instruments, 126 historical quotes across July 13–14, 2023, and one FILLED CASH_IN of ARS 1,000,000.00 for account `10002`. It is safe to run again: existing sample rows and the opening transfer are not duplicated. Account `10001`, its orders, and the ARS instrument are excluded. PGR and IRCP have no quotes in the challenge sample. The two quotes with missing open, high, and low use their close for those fields, and prices are stored at two-decimal precision. The original sample is [the challenge SQL](https://github.com/cocoscap/cocos-challenge/blob/main/database.sql).

Immediately after seeding a fresh database, verify the opening balances and movement signs with:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/seed.sql
```

The query prints `10002 | 1000000.00 | 0`, `10003 | 0.00 | 0`, and `10004 | 0.00 | 0` for account number, ARS cash, and shares. It also checks the source row and its positive cash and zero share deltas. To verify BUY, SELL, CASH_IN, and CASH_OUT signs and database constraints using rollback-only fixtures, run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/portfolio-movements.sql
```

The smoke test rolls back its fixture rows. `portfolio_movements` exposes `source_type`, `source_id`, `user_id`, nullable `instrument_id`, `movement_type`, `share_delta`, `cash_delta_ars`, and `datetime` for FILLED trades and transfers.

The server listens on port 3000 by default. Set `PORT` to choose another port. For development with automatic rebuild and restart, run `npm run start:dev` instead of `npm start`. `npm run build` generates Prisma Client before compiling; `npm run prisma:generate` regenerates it after a schema change. Run `npm test` for the HTTP health test.

```bash
curl -i http://localhost:3000/health
```

`GET /health` returns HTTP 200 with `{"status":"ok"}`. It checks that the API process is running; it does not run a database query. The API connects to PostgreSQL during startup, so a failed database connection prevents it from becoming ready. Startup logs use NestJS's JSON console logger and are written to stdout, one JSON record per line. The application registers a global `ValidationPipe` with transformation and strict DTO property checks. API errors use the PRD error envelope.

`GET /instruments?query=pat&page=1&pageSize=20` searches share tickers and names by a trimmed, case-insensitive substring. `query` is required; `page` defaults to 1 and `pageSize` to 20, with a maximum of 100. Invalid parameters return HTTP 400 with `{"error":{"code":"VALIDATION_ERROR","message":"Invalid request parameters"}}`. Results exclude ARS, sort by ticker then ID, and return `data` (`id`, `ticker`, `name`, `type`) plus `pagination` (`page`, `pageSize`, `totalItems`, `totalPages`).

`GET /users/10002/portfolio` returns `userId`, `totalValueARS`, `availableCashARS`, and `positions` with `instrumentId`, `ticker`, `name`, `size`, `marketValueARS`, and `totalReturnPct`. It combines FILLED trade and transfer movements with each held instrument's latest close. A partial sale retains weighted average purchase cost for the remaining shares. Sold-out positions are omitted; an account without movements returns zero cash, zero value, and an empty positions list. ARS amounts and percentages are two-decimal strings rounded half-up, and `totalReturnPct` is `null` for a positive zero-cost position. Invalid user IDs return HTTP 400, unknown users return 404, and a held instrument without a price returns 503.

## Run with Docker Compose

After creating `.env` as above, run:

```bash
docker compose up --build
```

Compose starts PostgreSQL, runs pending Prisma migrations and the idempotent seed in a one-off container, and then starts the API with an internal database URL. Repeating `docker compose up --build` safely replays setup. The API is available at `http://localhost:3000/health`. Set `API_HOST_PORT` to change the host port, or `API_PORT` to change the port inside the container. Compose passes `API_PORT` to the application as `PORT`; both settings default to 3000. The database is exposed only on loopback at port 55432; set `DB_HOST_PORT` to change that port. For example:

```bash
API_HOST_PORT=8080 docker compose up --build
curl -i http://localhost:8080/health
```

The image builds with the npm lockfile on Node.js 24 and generates Prisma Client during the build. The migration container has the Prisma CLI and seed script; the API runtime installs only production dependencies and runs as the non-root `node` user. The Docker health check calls `GET /health`. PostgreSQL data persists in the `postgres_data` volume across `docker compose down` and restarts. Use `docker compose down --volumes` only when intentionally resetting local data. The initial migration creates the six application tables and the `portfolio_movements` view. Portfolio and order endpoints arrive in later implementation stages.
