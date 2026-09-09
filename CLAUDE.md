# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Governing document

**`README-arquitectura-hibrida-gratuita.md` is the authoritative architecture and working-methodology spec for this project.** Read it before proposing or making any non-trivial change. It defines:

- The target hybrid architecture (Cloudflare Pages/DNS/Tunnel + Supabase Postgres/Auth in the cloud; everything else — Nginx, API, Redis, MinIO, Worker, PotreeConverter — self-hosted on the user's NAS via Docker).
- Hard constraints: LAS/LAZ files must never leave MinIO on the NAS (never in Supabase/cloud storage); don't replace MinIO/Redis/Potree without technical justification; don't introduce paid cloud services without justifying cost/necessity/free alternative first (section 27); secrets never committed to git.
- A strict phase-gated methodology (section 25): explain objective → explain architecture → show files to modify → implement → test → verify → document → **wait for user confirmation before moving to the next phase**. Don't implement an entire phase's worth of changes speculatively; don't continue past a failure without fixing it first.

Treat commits already on `main` as evidence a phase is done — check current code/`docker-compose.yml` state before assuming a phase from that README is still pending (Supabase auth, presigned uploads, and upload cleanup are already implemented as of the last update to this file).

## Mantener PROGRESO.md al dia

`PROGRESO.md` registra el objetivo del proyecto y el historial de que se
implemento, incluyendo pasos de infraestructura (cuentas/dashboards) que no
dejan rastro en git. **Cada vez que se implemente una funcionalidad nueva,
hay que agregarle una entrada** (fecha + que se hizo) antes de dar el cambio
por terminado. No es un archivo opcional de documentacion — es lo que le
permite a una sesion futura de Claude Code saber que ya existe sin releer
todo el historial de git.

## Subagentes de rol

Este repo define 4 subagentes en `.claude/agents/`, cada uno con su propio alcance de herramientas y obligados a seguir la metodologia por fases de `README-arquitectura-hibrida-gratuita.md`:

- **`arquitectura`** — decisiones de diseno, limites entre NAS/cloud, evaluacion de costos. Solo lectura; produce un plan, no implementa.
- **`seguridad`** — auth/autorizacion, CORS, puertos expuestos, secretos, rate limiting. Reporta hallazgos y propone fixes.
- **`pruebas`** — disena y ejecuta verificacion manual (no hay suite de tests automatizada en este repo).
- **`desarrollo`** — el unico con permiso amplio de escritura; implementa lo ya aprobado por los otros roles.

Invocalos con la herramienta Agent (`subagent_type` = el nombre de arriba) cuando el trabajo calce claramente con uno de estos roles, en vez de resolverlo todo en una sola conversacion sin separacion de responsabilidades.

## Commands

There is no build tool, bundler, linter, or automated test suite in this repo (no root `package.json`; `backend/package.json` and `worker/package.json` have no `scripts`). Verification is manual, per the phase methodology above.

```bash
# One-time: clone Potree and PotreeConverter source into vendor/ (gitignored,
# required before any docker build; Dockerfiles copy from here instead of
# cloning inside the build so the build doesn't depend on container network).
./fetch-sources.sh

# Build and start the full stack (redis, minio, api, worker, frontend)
docker compose up -d --build

# Scale conversion throughput horizontally (each worker processes one job at
# a time; PotreeConverter itself is multi-threaded, so don't raise per-worker
# concurrency instead of container count)
docker compose up -d --scale worker=3

# Tail logs for one service
docker compose logs -f worker

# Bring up the Cloudflare Tunnel sidecar (only needed on the NAS, opt-in via
# profile so a plain `docker compose up -d` never starts it)
docker compose --profile cloudflare up -d

# Build the frontend the same way Cloudflare's Worker deploy does (useful to
# reproduce a Cloudflare build failure locally). Needs SUPABASE_URL,
# SUPABASE_ANON_KEY, API_BASE_URL in the environment; writes frontend/public/config.js
# (gitignored) and frontend/dist/ (gitignored) as a side effect.
cd frontend && bash build-pages.sh
```

## Architecture

### Services and data flow

Five things run in Docker on the user's NAS (`docker-compose.yml`): `redis`, `minio`, `api`, `worker`, `frontend` (Nginx). Job metadata lives in **Supabase-managed Postgres**, not a local container — `DATABASE_URL` in `.env` must be the Supabase *pooler* connection string (the API/worker open many short-lived connections; the direct connection string will exhaust Supabase's connection limit).

```
browser --(login)--> Supabase Auth (JWT)
browser --(fetch, Bearer JWT)--> nginx --(proxy /api/)--> api --(verify JWT via Supabase JWKS)--> ...
api --(job row)--> Supabase Postgres
api --(enqueue)--> redis (BullMQ queue "conversion")
worker <--(dequeue)-- redis
worker --(download)--> minio bucket raw-las
worker --(PotreeConverter)--> local scratch dir
worker --(upload octree)--> minio bucket pointclouds
worker --(job status)--> Supabase Postgres directly (bypasses the API)
browser --(Potree viewer)--> nginx --(proxy /pointclouds/)--> minio bucket pointclouds
```

Auth (`backend/src/auth.js`) verifies Supabase JWTs against the project's **public JWKS** (`jose`'s `createRemoteJWKSet`), not a shared HS256 secret — Supabase's newer projects sign with ES256. Every job row is scoped to `user_id`; `backend/src/db.js` always filters by it so one user can't read or complete another's job even by guessing a UUID.

### Upload path: presigned direct-to-MinIO

Large files must not round-trip through the API. The flow (`backend/src/routes/uploads.js`, `frontend/public/index.html`):

1. Browser `POST /api/uploads/presign` → API creates the job row (status `uploading`) and returns a MinIO presigned PUT URL.
2. Browser `PUT`s the file straight to that URL (through Nginx's `/raw-las/` proxy, which forwards without rewriting `Host` so the SigV4 signature stays valid).
3. Browser `POST /api/uploads/:jobId/complete` → API `statObject`s MinIO to confirm the upload landed, then enqueues the BullMQ conversion job.

`backend/src/cleanup.js` runs on API startup and sweeps jobs still stuck in `uploading` past `STALE_UPLOAD_MINUTES` (default 90, i.e. past the presigned URL's expiry) — marks them `failed` and removes any partial object in `raw-las`.

### Frontend has two separate deploy targets that share one codebase

`frontend/public/` (`index.html`, `viewer.html`, `config.js`) and `frontend/vendor/potree` (gitignored, cloned by `fetch-sources.sh`) serve **both**:

- **NAS/Docker** (`frontend/Dockerfile` + `frontend/nginx.conf`): builds Potree, bundles it with `public/` into one Nginx image that also reverse-proxies `/api/`, `/pointclouds/`, `/raw-las/` to the `api`/`minio` containers. Same origin as the API, so `frontend/public/config.js`'s `API_BASE_URL` is left empty and `index.html`/`viewer.html` use relative paths.
- **Cloudflare** (`frontend/build-pages.sh` + `frontend/wrangler.jsonc`): deployed as a Cloudflare Worker with static assets (Git-connected "Workers Builds", not classic Pages — hence a `*.workers.dev`/custom domain, and a committed `wrangler.jsonc` is required for `wrangler deploy` to know the assets directory and Worker name). The build script clones+compiles `vendor/potree` fresh (nothing under `vendor/` is in git) and **generates `public/config.js` from Cloudflare's build-time environment variables** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_BASE_URL`) before assembling `frontend/dist/`. Those three env vars live only in the Cloudflare project's dashboard settings — **not** in this repo's `.env`/`.env.example`, which only configures the NAS-side `docker-compose.yml` stack.

Because the Cloudflare-hosted frontend is a different origin than the NAS API, `backend/src/routes/uploads.js` prefixes presigned URLs with `BACKEND_PUBLIC_URL` (the NAS's Cloudflare Tunnel hostname) when set, and the API's CORS (`backend/src/index.js`, `cors({ origin: allowedOrigins })`) reads allowed origins from `FRONTEND_URL` (comma-separated). Both are empty/localhost by default so the NAS-origin deployment is unaffected.

### Exposing the NAS without opening ports

`docker-compose.yml`'s `cloudflared` service (profile `cloudflare`, opt-in) runs Cloudflare Tunnel using `CLOUDFLARE_TUNNEL_TOKEN`. Its Public Hostname is configured in the Cloudflare dashboard (not in this repo) to point at `http://frontend:80` — i.e. straight at the same Nginx container the NAS deployment already uses, so no proxy rules need to be duplicated for the tunneled path.

### Worker specifics

`worker/Dockerfile` compiles `PotreeConverter` from source (`vendor/PotreeConverter`, also from `fetch-sources.sh`) with `cmake`/`make` at image build time — not npm. `worker/src/worker.js` downloads the raw file to `SCRATCH_DIR`, shells out to the compiled `PotreeConverter` binary (`-m poisson` sampling), uploads the resulting directory tree to the `pointclouds` bucket, and updates the job row directly in Postgres (it has its own `pg` pool; it does not call back into the API).
