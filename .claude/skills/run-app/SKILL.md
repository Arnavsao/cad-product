---
name: run-app
description: Launch CADO locally — the Angular editor (ng serve on :4200), the NestJS API (:3000), and the Postgres + MinIO containers — or reproduce the production nginx/CSP image. Use when asked to run, start, serve, or screenshot the app, to confirm a change works in the browser, or when the API/DB refuses to start.
---

# Running CADO locally

Node 24 (`.nvmrc`); Node >= 20.19 is the floor. Run `nvm use` first.

## Pick the mode

| Want | Command | URL |
| --- | --- | --- |
| Full stack (web + API + Postgres + MinIO) | `npm run dev` | web http://localhost:4200, API http://localhost:3000 |
| Editor only, no backend | `npm start` | http://localhost:4200 |
| First-time install + DB | `npm run setup` | — |
| API only | `npm run dev:api` (needs `npm run db:up` first) | http://localhost:3000/healthz |

`npm run dev` starts Postgres + MinIO via docker compose, then runs `api` and `web` under `concurrently`. Both are long-running: start them with `run_in_background` and wait for `bundle generation complete` (web) and `Nest application successfully started` (API) before probing.

Editor-only mode works when `supabaseUrl` / `supabaseAnonKey` in `src/environments/environment.ts` are empty: auth guards pass through, the dashboard is unreachable, the editor mounts at `/` (embedded mode).

## Ports and this machine

- The root `.env` (gitignored) may set `POSTGRES_PORT` because a native Postgres already owns 5432. `server/.env` `DATABASE_URL` and `DIRECT_DATABASE_URL` must use the **same port** or Prisma connects to the wrong server and migrations "succeed" against the wrong DB.
- MinIO API :9000, console :9001 (minioadmin / minioadmin). Bucket `drawings` is created by `docker compose run --rm minio-init`.
- `ng serve` proxies `/api` to :3000 via `proxy.conf.json`. The app always calls a relative `/api/v1`.

## Auth without a Supabase project

```bash
npm --prefix server run mint-token -- --write-env   # sets test SUPABASE_* in server/.env, prints a token
curl -s localhost:3000/api/v1/me -H "Authorization: Bearer $TOKEN"
```

Without `SUPABASE_URL` the API answers `503 AUTH_NOT_CONFIGURED` on every authenticated route. That is by design, not a bug.

## Health probes

```bash
curl -fsS localhost:3000/healthz          # API (excluded from the /api/v1 prefix)
curl -fsS localhost:4200/ | head -c 200   # web dev server
docker compose ps                         # postgres + minio should be "healthy"
```

## Reproducing production (CSP)

`ng serve` sends no Content-Security-Policy; nginx does, with no `'unsafe-inline'`. Anything relying on inline script or `onload` works locally and is silently dropped in prod. To see what prod sees:

```bash
docker build -f deploy/azure/Dockerfile.web -t cado-web-local .
docker run --rm -p 8099:80 -e API_ORIGIN=https://<api-fqdn> cado-web-local
# open http://localhost:8099 and look for "Refused to …" in the console
```

Or the compose variant: `npm run docker:build && npm run docker:run` (web on :8080, no API proxy target).

## Common failures

- **API exits at boot with a Zod error**: a required `server/.env` value is missing or malformed. The message names the key. Compare with `server/.env.example`.
- **`P1001` / connection refused**: containers not up (`npm run db:up`) or the port mismatch above.
- **Presigned upload fails in the browser**: MinIO CORS. Re-run `docker compose run --rm minio-init`.
- **Sign-in bounces to localhost in prod**: Supabase redirect allow-list, not code.

Never print or commit `server/.env`; it holds live credentials. Read `server/.env.example` for the key list instead.
