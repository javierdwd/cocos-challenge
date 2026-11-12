# Cocos Challenge Backend

NestJS REST API baseline for the Cocos Challenge. This stage exposes a liveness endpoint and connects to PostgreSQL; portfolio, instrument, and order endpoints are planned in later issues. See [the PRD](docs/PRD.md) and [architecture decisions](docs/ADRs/README.md) for the product and technical contracts.

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
npm run build
npm start
```

The server listens on port 3000 by default. Set `PORT` to choose another port. For development with automatic rebuild and restart, run `npm run start:dev` instead of `npm start`. `npm run build` generates Prisma Client before compiling; `npm run prisma:generate` regenerates it after a schema change. Run `npm test` for the HTTP health test.

```bash
curl -i http://localhost:3000/health
```

`GET /health` returns HTTP 200 with `{"status":"ok"}`. It checks that the API process is running; it does not run a database query. The API connects to PostgreSQL during startup, so a failed database connection prevents it from becoming ready. Startup logs use NestJS's JSON console logger and are written to stdout, one JSON record per line. The application registers a global `ValidationPipe` with transformation and strict DTO property checks for future request DTOs.

## Run with Docker Compose

After creating `.env` as above, run:

```bash
docker compose up --build
```

Compose starts PostgreSQL, waits for its health check, and then starts the API with an internal database URL. The API is available at `http://localhost:3000/health`. Set `API_HOST_PORT` to change the host port, or `API_PORT` to change the port inside the container. Compose passes `API_PORT` to the application as `PORT`; both settings default to 3000. The database is exposed only on loopback at port 55432; set `DB_HOST_PORT` to change that port. For example:

```bash
API_HOST_PORT=8080 docker compose up --build
curl -i http://localhost:8080/health
```

The image builds with the npm lockfile on Node.js 24, generates Prisma Client during the build, installs only production dependencies in the runtime image, and runs as the non-root `node` user. The Docker health check calls `GET /health`. PostgreSQL data persists in the `postgres_data` volume across `docker compose down` and restarts. Use `docker compose down --volumes` only when intentionally resetting local data. This stage configures the database connection and Prisma Client; application tables, migrations, and seed data will arrive in later implementation stages.
