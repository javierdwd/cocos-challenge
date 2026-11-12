# Cocos Challenge Backend

NestJS REST API baseline for the Cocos Challenge. This stage exposes a liveness endpoint; portfolio, instrument, and order endpoints are planned in later issues. See [the PRD](docs/PRD.md) and [architecture decisions](docs/ADRs/README.md) for the product and technical contracts.

## Prerequisites

- Node.js 24 and npm 11 (`.nvmrc` selects Node 24 when using nvm).

## Install and run

```bash
npm install
npm run build
npm start
```

The server listens on port 3000 by default. Set `PORT` to choose another port. For development with automatic rebuild and restart, run `npm run start:dev` instead of `npm start`. Run `npm test` for the HTTP health test.

```bash
curl -i http://localhost:3000/health
```

`GET /health` returns HTTP 200 with `{"status":"ok"}`. It checks that the API process is running; it does not check a database. Startup logs use NestJS's JSON console logger and are written to stdout, one JSON record per line. The application registers a global `ValidationPipe` with transformation and strict DTO property checks for future request DTOs.

## Run with Docker Compose

Docker and the Docker Compose plugin are required. From a clean checkout, run:

```bash
docker compose up --build
```

The API is available at `http://localhost:3000/health`. Set `API_HOST_PORT` to change the host port, or `API_PORT` to change the port inside the container. Compose passes `API_PORT` to the application as `PORT`; both settings default to 3000. For example:

```bash
API_HOST_PORT=8080 docker compose up --build
curl -i http://localhost:8080/health
```

The image builds with the npm lockfile on Node.js 24, installs only production dependencies in the runtime image, and runs as the non-root `node` user. The Docker health check calls `GET /health`. Stop the service with `docker compose down`. No database is started in this stage.
