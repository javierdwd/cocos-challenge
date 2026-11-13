# Cocos Challenge Backend

NestJS REST API for the Cocos Challenge. It exposes liveness, instrument search, portfolio, order submission, and order cancellation endpoints. See [the PRD](docs/PRD.md) and [architecture decisions](docs/ADRs/README.md) for the product and technical contracts.

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

`prisma:migrate:deploy` applies pending versioned migrations. `db:seed` loads all four sample users, 65 share instruments, 126 historical quotes across July 13–14, 2023, eight historical orders for account `10001`, and its original CASH_IN and CASH_OUT transfers. It excludes only the inconsistent FILLED sale of 30 BMA shares and the ARS instrument. Account `10002` (user ID `2`) also receives a FILLED CASH_IN of ARS 1,000,000.00 for local order examples. Rerunning the seed does not duplicate sample rows. PGR and IRCP have no quotes in the challenge sample. The two quotes with missing open, high, and low use their close for those fields, and prices are stored at two-decimal precision. The original sample is [the challenge SQL](https://github.com/cocoscap/cocos-challenge/blob/main/database.sql).

Immediately after seeding a fresh database, verify the opening balances and movement signs with:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/seed.sql
```

The query prints `10001 | 707100.00 | 560`, `10002 | 1000000.00 | 0`, `10003 | 0.00 | 0`, and `10004 | 0.00 | 0` for account number, ARS cash, and total shares. It also checks that account `10001` has 40 PAMP, 20 BMA, and 500 METR shares, and that the invalid sale is absent. To verify BUY, SELL, CASH_IN, and CASH_OUT signs and database constraints using rollback-only fixtures, run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/portfolio-movements.sql
```

The smoke test rolls back its fixture rows. `portfolio_movements` exposes `source_type`, `source_id`, `user_id`, nullable `instrument_id`, `movement_type`, `share_delta`, `cash_delta_ars`, and `datetime` for FILLED trades and transfers.

## Tests

From a clean checkout with Node.js 24, npm 11, and Docker running:

```bash
npm ci
npm test
```

`npm test` runs the unit tests and the PostgreSQL functional API suite. Run `npm run test:unit` or `npm run test:functional` separately when needed. The functional command starts an isolated PostgreSQL 17 container from `compose.test.yaml` with a generated password and an automatically assigned loopback port, applies the Prisma migrations, runs Vitest and Supertest against the real NestJS app, then removes the test container and database. It does not read `.env`, seed the application database, or change the normal Compose stack. The suite seeds the dedicated `cocos_test` database twice, verifies the populated sample portfolio and seed idempotence, then creates isolated users, instruments, prices, and opening cash for order cases. A guard prevents the functional tests from clearing a database with a different name.

The server listens on port 3000 by default. Set `PORT` to choose another port. For development with automatic rebuild and restart, run `npm run start:dev` instead of `npm start`. `npm run build` generates Prisma Client before compiling; `npm run prisma:generate` regenerates it after a schema change.

```bash
curl -i http://localhost:3000/health
```

`GET /health` returns HTTP 200 with `{"status":"ok"}`. It checks that the API process is running; it does not run a database query. The API connects to PostgreSQL during startup, so a failed database connection prevents it from becoming ready. Startup logs use NestJS's JSON console logger and are written to stdout, one JSON record per line. The application registers a global `ValidationPipe` with transformation and strict DTO property checks. API errors use the PRD error envelope.

`GET /instruments?query=pat&page=1&pageSize=20` searches share tickers and names by a trimmed, case-insensitive substring. `query` is required; `page` defaults to 1 and `pageSize` to 20, with a maximum of 100. Invalid parameters return HTTP 400 with `{"error":{"code":"VALIDATION_ERROR","message":"Invalid request parameters"}}`. Results exclude ARS, sort by ticker then ID, and return `data` (`id`, `ticker`, `name`, `type`) plus `pagination` (`page`, `pageSize`, `totalItems`, `totalPages`).

`GET /users/1/portfolio` returns `userId`, `totalValueARS`, `availableCashARS`, and `positions` with `instrumentId`, `ticker`, `name`, `size`, `marketValueARS`, and `totalReturnPct`. On a fresh seed, user ID `1` (account `10001`) has ARS 707,100.00 cash, three positions (40 PAMP, 20 BMA, and 500 METR), and ARS 888,940.00 total value. `GET /users/2/portfolio` starts with ARS 1,000,000.00 cash and no positions. The path takes the database user ID. The endpoint combines FILLED trade and transfer movements with each held instrument's latest close. A partial sale retains weighted average purchase cost for the remaining shares. Sold-out positions are omitted; an account without movements returns zero cash, zero value, and an empty positions list. ARS amounts and percentages are two-decimal strings rounded half-up, and `totalReturnPct` is `null` for a positive zero-cost position. Invalid user IDs return HTTP 400, unknown users return 404, and a held instrument without a price returns 503.

`POST /orders` requires an `Idempotency-Key` header and `userId`, `instrumentId`, `side` (`BUY` or `SELL`), `type` (`MARKET` or `LIMIT`), and exactly one of `size` or `amountARS`. LIMIT orders also require `limitPriceARS`; MARKET orders use the latest close and must omit the limit price. Monetary inputs are positive decimal strings with at most two fractional digits. Successful MARKET orders fill immediately; LIMIT orders remain NEW without reserving cash or shares. Both return HTTP 201 with an `order` object. Insufficient cash or shares creates a REJECTED order and returns HTTP 422 with `error` and `order`. Malformed requests return 400, unknown users or instruments 404, and unavailable MARKET prices 503 without creating an order. Reusing the same key and equivalent payload replays the original status and JSON body; changing the payload returns 409. A concurrent request that times out on the user lock returns a retryable 409 and can be retried with the same key. Keys persist for the database lifetime.

`POST /orders/:orderId/cancel` requires a body containing `userId`. It returns HTTP 200 with the updated `order` when that user's order is NEW. Missing or other-user orders return 404; FILLED, REJECTED, and already CANCELLED orders return 409. Only one concurrent cancellation can succeed. Replaying the original `POST /orders` with its `Idempotency-Key` still returns the stored submission response.

The API has no authentication. A caller-supplied `userId` is only a challenge input, not proof of identity. Cash transfers are seeded data only; account `10001` has a CASH_IN and a CASH_OUT, while account `10002` has a CASH_IN. There is no transfer endpoint. The seed's July 2023 close prices are static local fixtures, not live market data. NEW LIMIT orders do not reserve cash or shares, and there is no matching process to fill them. Only FILLED movements affect the portfolio. These assumptions are recorded in [ADR-004](docs/ADRs/adr-004-sample-portfolio-seed.md) and [ADR-003](docs/ADRs/adr-003-order-semantics.md).

## Local request examples

Open the [`bruno` collection](bruno/bruno.json) in Bruno and select its `local` environment. It targets `http://localhost:3000` and uses seeded user ID `1` (account `10001`) and instrument ID `31` (BMA, which has a quote). Change `baseUrl` in [`local.bru`](bruno/environments/local.bru) if you changed `API_HOST_PORT`. Run the numbered collection in one sequence on a freshly seeded database: health, search, the populated portfolio, MARKET buy and same-key retry, MARKET sell, LIMIT buy and cancellation, then an insufficient-cash rejection. The buy key is a temporary Bruno runtime variable. `pendingOrderId` defaults to `6`, the seeded NEW BMA order on a fresh database, so the cancellation example can also run by itself. Submitting the LIMIT buy first replaces that default with the new order ID for the current Bruno session. Cancelling an order twice returns HTTP 409.

Each new-order example generates a fresh UUID for `Idempotency-Key` on every send. The retry example deliberately reuses the key and identical payload from the preceding MARKET buy; run it only after that buy. Keep the original key when retrying an uncertain submission, and generate a new key for a distinct order. Running the examples again creates new orders and changes the portfolio; reset the local database only when you intentionally want the seeded starting state.

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

The image builds with the npm lockfile on Node.js 24 and generates Prisma Client during the build. The migration container has the Prisma CLI and seed script; the API runtime installs only production dependencies and runs as the non-root `node` user. The Docker health check calls `GET /health`. PostgreSQL data persists in the `postgres_data` volume across `docker compose down` and restarts. Use `docker compose down --volumes` only when intentionally resetting local data. The initial migration creates the six application tables and the `portfolio_movements` view.
