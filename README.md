# Inventory Management — COE

Next.js 16 (App Router) + React 19 + TypeScript inventory system for COE
(Center of Excellence) domains: products, stock, lending, invoices, students,
and admin. Postgres via Drizzle ORM, with the schema owned by Flyway
migrations. Auth is JWT in httpOnly cookies.

| | |
|---|---|
| **Runs on** | http://localhost:4000 (not 3000) |
| **Node** | 20 (CI and the Docker image both pin 20) |
| **Database** | Postgres 16, schema owned by Flyway |
| **Object storage** | Cloudinary |
| **Architecture notes** | [SRD.md](SRD.md) — read this first, it's the source of truth |
| **Database detail** | [db/README.md](db/README.md) |
| **Test strategy** | [TESTING_STRATEGY.md](TESTING_STRATEGY.md) |
| **Performance suite** | [k6/README.md](k6/README.md) |

---

## 1. Prerequisites

- **Docker Desktop** — runs Postgres and the Flyway migration jobs
- **Node 20** and npm
- **psql** (optional) — for the data-reset commands below.
  macOS: comes with [Postgres.app](https://postgresapp.com/), or `brew install libpq`
- **Flyway CLI** (optional) — only if you want to run migrations *without*
  Docker. `brew install flyway`

You do not need a local Postgres install; the compose stack provides one.

---

## 2. Local setup, from nothing

```bash
git clone https://github.com/developerssairamincubation-star/Inventory-Management.git
cd Inventory-Management
cp .env.example .env       # then fill it in — see section 3
npm install
```

Bring up the database and apply the full schema:

```bash
docker compose up -d postgres      # Postgres 16 on localhost:5433
docker compose up flyway           # applies db/migrations (V1 … V31)
docker compose up flyway-seed      # dev-only seed: admin user, one department, one category
```

`flyway` and `flyway-seed` are **one-shot** containers. They run, apply their
work, and exit 0 — that is success, not a crash.

Start the app:

```bash
npm run dev                        # http://localhost:4000
```

Sign in with the seeded account:

```
email:    admin@inventory.local
password: ChangeMe123!
```

That account comes from `db/seed/R__seed_dev_data.sql` and is a local
bootstrap, not a secret. **Change it in any shared or long-lived
environment.**

### Verify the stack is healthy

```bash
curl -s http://localhost:4000/api/health
```

```json
{ "status": "ok", "database": "ok", "latencyMs": 2 }
```

A `503` with `"database": "unreachable"` means the app is up but Postgres
isn't — check `docker compose ps`.

---

## 3. Environment configuration

Copy `.env.example` to `.env` and fill it in. **`.env` is git-ignored and must
stay that way** — it holds live credentials.

| Group | Vars | Needed for |
|---|---|---|
| Postgres | `POSTGRES_*`, `DATABASE_URL`, `DATABASE_TEST_URL`, `FLYWAY_*` | Everything |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_PEPPER` | Everything |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_FOLDER` | Image and invoice-PDF upload |
| Object-storage flush | `CLOUDINARY_UPLOAD_FOLDER` must be set explicitly | `scripts/flush-object-storage.mjs` (§6) |
| Gemini | `GEMINI_API_KEY` | Invoice PDF scanning (billable) |
| Tuning | `PGPOOL_MAX`, `PG_STATEMENT_TIMEOUT_MS`, `LOG_LEVEL`, `TRUSTED_PROXY_DEPTH` | Optional |
| Sentry | `SENTRY_*` | Optional |

Generate the two auth secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### What each environment can reach

Worth knowing before you touch anything:

- **Postgres is fully isolated per environment.** `npm run dev` reads
  `DATABASE_URL`, which points at your local container. No application code
  reads any `NEON_*` variable, so local development cannot reach the hosted
  database even if those URLs are present in your `.env`.
- **Cloudinary is one shared account across every environment.** Environments
  are separated only by `CLOUDINARY_UPLOAD_FOLDER` (`dev`, `dit`, `production`
  …), and the folder allowlist in `src/lib/cloudinary.ts` prevents an upload
  being signed outside it. Same account, same API keys, same billing.
  To take local completely offline from it, leave the three `CLOUDINARY_*`
  vars unset — uploads then fail with a clear error and everything else works.
- **Gemini is live and metered.** Each invoice scan is a real, billable API
  call. Leave `GEMINI_API_KEY` unset and the route returns a clean
  `501 NOT_CONFIGURED` instead.

---

## 4. Running the application

### Development

```bash
npm run dev            # http://localhost:4000, hot reload
```

Dev mode compiles routes on first request. It is fine for development and
useless for measuring performance — see [k6/README.md](k6/README.md).

### Production build, locally

```bash
npm run build
npm run start          # http://localhost:4000
```

Note: `npm run start` sets `NODE_ENV=production`, which makes every auth
cookie `Secure`. A Secure cookie is only ever sent back over HTTPS, so a
production build served over plain `http://localhost:4000` will sign you in
and then reject every subsequent request with a 401. That is correct
behaviour, not a bug. To exercise a production build locally you need TLS in
front of it — `k6/tools/tls-proxy.mjs` does this for the load suite.

### Full stack in Docker

```bash
docker compose up -d --build       # postgres + flyway + app
```

The `app` service waits on `flyway` completing successfully, so it can never
boot against an unmigrated schema. It serves on port 4000 and carries a
`HEALTHCHECK` that calls `/api/health`.

### Deployed environments

- **DIT** — deploys from the `development` branch via
  `.github/workflows/deploy-dit.yml` onto a self-hosted runner using this
  same compose stack. The deploy job depends on the test workflow, so a red
  suite blocks the release.
- **Vercel** — set the same environment variables in the project settings,
  with `DATABASE_URL` pointing at the pooled Postgres endpoint. On serverless,
  set `PGPOOL_MAX` **low** (1–5): the pool is per process, so N instances
  multiply it, and the platform's own pooler is doing the real pooling.

---

## 5. Migrations

**Flyway owns the schema. Drizzle does not.** `src/db/schema/*.ts` is a
hand-written typed query layer over whatever the migrations create — never run
`drizzle-kit generate` or `drizzle-kit push` against this database.

Migrations live in `db/migrations/` as `V<n>__description.sql`. Once a
migration has been applied anywhere, **that file is immutable** — a change
always gets a new `V<n+1>__…sql`, never an edit to a shipped file. Flyway
records a checksum and will refuse to run if a shipped file changes.

### Migrating from scratch

This is what a brand-new environment needs, in order:

```bash
docker compose up -d postgres      # 1. database up
docker compose up flyway           # 2. schema: V1 → latest
docker compose up flyway-seed      # 3. dev seed data (LOCAL/DEV ONLY)
docker compose up flyway-test      # 4. the inventory_test DB, for vitest
```

Step 3 is dev-only. Never point `flyway-seed` at a production database — it
creates a known-password super_admin.

Step 4 targets a separate `inventory_test` database, created on first
container init by `db/init/01_create_test_db.sh`. The Vitest suite runs
against it so tests never touch your dev data.

### Without Docker

Requires the Flyway CLI and a reachable Postgres. Connection details come from
`FLYWAY_URL` / `FLYWAY_USER` / `FLYWAY_PASSWORD`.

```bash
npm run db:migrate        # apply db/migrations
npm run db:seed           # apply db/seed  (dev/local only)
npm run db:migrate:test   # apply db/migrations to $FLYWAY_URL_TEST
npm run db:info           # what's applied, what's pending
```

### Adding a migration

1. Create `db/migrations/V<next>__short_description.sql`.
2. Apply it: `docker compose up flyway`.
3. Update the Drizzle types in `src/db/schema/` by hand to match.
4. Migrate the test DB too: `docker compose up flyway-test`.
5. `npm test` and `npx tsc --noEmit`.

### Migrating a deployed environment

Migrations do **not** run automatically on Vercel. Point Flyway at the target
database and run it deliberately:

```bash
docker run --rm -v "$(pwd)/db/migrations:/flyway/sql" flyway/flyway:10-alpine \
  -url="jdbc:postgresql://<host>/<db>?sslmode=require" \
  -user=<user> -password=<password> \
  -connectRetries=10 migrate
```

Use the **direct** (non-pooled) connection URL for migrations — poolers can
interfere with DDL and advisory locks. Take a backup first.

### Checking status

```bash
npm run db:info                    # with the Flyway CLI
docker compose run --rm flyway info
```

```bash
psql "$DATABASE_URL" -c "select version, description, success from flyway_schema_history order by installed_rank desc limit 10;"
```

---

## 6. Clearing and resetting data

Three levels, least to most destructive. **Take a backup first** — all three
are irreversible.

```bash
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" inventory-management-postgres-1 \
  pg_dump -U "$POSTGRES_USER" -d inventory --no-owner > backup-$(date +%Y%m%d-%H%M%S).sql
```

### Level 1 — refresh the seed only

`R__seed_dev_data.sql` is a Flyway *repeatable* migration: it re-applies
whenever its checksum changes, and is written to be safe to re-run.

```bash
docker compose up flyway-seed
```

### Level 2 — wipe the data, keep the container

Drops and recreates both databases, then replays every migration from V1.
This is the "fresh start" path.

```bash
set -a; . ./.env; set +a
# Stop the app first — open connections block DROP DATABASE.
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" inventory-management-postgres-1 \
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname IN ('inventory','inventory_test') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS inventory;
DROP DATABASE IF EXISTS inventory_test;
CREATE DATABASE inventory OWNER $POSTGRES_USER;
CREATE DATABASE inventory_test OWNER $POSTGRES_USER;
SQL

docker compose up flyway
docker compose up flyway-seed
docker compose up flyway-test
```

Note `docker exec -i` — without `-i` the heredoc never reaches psql and the
commands silently do nothing.

### Level 3 — destroy the volume

Removes the Postgres data volume entirely, so `db/init/` re-runs on next
start and `inventory_test` is recreated from scratch.

```bash
docker compose down -v
docker compose up -d postgres
docker compose up flyway flyway-seed flyway-test
```

`-v` also removes the `pgbackups` volume and every backup in it.

### Level 4 — flush object storage too

Everything above only clears Postgres. Uploaded files live in Cloudinary and
survive every one of those steps, so a "clean" database still has orphaned
images and invoice PDFs sitting in the bucket.

> **This is the dangerous one.** There is a single Cloudinary account for local
> dev *and* every hosted environment. They are separated only by the root
> folder in `CLOUDINARY_UPLOAD_FOLDER`, and `production/` is a sibling folder
> in that same account. There is no account-level boundary and Cloudinary
> deletions are not recoverable.

`scripts/flush-object-storage.mjs` deletes every asset under one
environment's root folder (`<root>/products` and `<root>/invoices`). It is
**dry run by default**:

```bash
node scripts/flush-object-storage.mjs           # lists what it would delete
node scripts/flush-object-storage.mjs --yes     # actually deletes
```

```
  cloud     <your-cloud>
  folder    dev/
  mode      dry run (nothing will be removed)

  dev/products/  —  12 asset(s), 4.1 MB
  dev/invoices/  —  3 asset(s), 890 KB

  15 asset(s), 5.0 MB would be deleted.
  Re-run with --yes to actually delete them.
```

Its guards, in order:

1. Refuses to run if `CLOUDINARY_UPLOAD_FOLDER` is unset. `src/lib/cloudinary.ts`
   falls back to `inventory` when uploading; that fallback is fine for writing
   and unacceptable for deleting, so there is no fallback here.
2. Refuses a folder matching `prod|live|main|release` unless you pass
   `--i-know`.
3. Deletes nothing without `--yes`.
4. Prints the cloud name and folder before doing anything, so you can see
   which account you are pointed at.

**Always run the dry run first and read the folder line.**

### Full flush — database and files together

Do both, in this order. Files first: if the database is already empty you have
lost the URLs that tell you which assets belonged to this environment.

```bash
# 1. See what will go
node scripts/flush-object-storage.mjs

# 2. Delete the files
node scripts/flush-object-storage.mjs --yes

# 3. Back up, then wipe and rebuild the database (Level 2 above)
#    …drop/create, then:
docker compose up flyway
docker compose up flyway-seed
docker compose up flyway-test
```

Doing only one side leaves you with dangling URLs (`product_image.image_url`,
`invoice_documents.file_url` pointing at deleted files) or with orphaned files
nothing references and no way to identify them later.

### What you cannot delete

`stock_ledger` is **append-only**, enforced by the `trg_stock_ledger_no_update`
trigger — `DELETE` and `UPDATE` both raise. This is deliberate: it is the
stock audit trail. Correct a mistake by appending a compensating entry, not by
editing history. The levels above work because dropping the database removes
the trigger along with the table.

### Clearing performance-test data

The k6 suite namespaces every row it writes, so it can be removed without
touching real data:

```bash
psql "$DATABASE_URL" -f k6/seed/cleanup.sql            # per-run rows
psql "$DATABASE_URL" -f k6/seed/perf-dataset-drop.sql  # the synthetic bulk dataset
psql "$DATABASE_URL" -f k6/seed/drop-users.sql         # retire the load-test accounts
```

---

## 7. Tests

```bash
npm test                  # vitest — unit + API integration, against inventory_test
npm run test:watch
npm run test:e2e          # playwright, needs the stack running
npm run lint
npx tsc --noEmit
```

The Vitest suite talks to a **real Postgres** (`inventory_test`), not mocks —
run `docker compose up flyway-test` at least once before the first run.

Load, stress, spike and soak testing needs [k6](https://k6.io)
(`brew install k6`) and has its own guide — [k6/README.md](k6/README.md) —
including why a dev server is not a valid target and how the rate limiter
interferes. Shortcuts:

```bash
npm run perf:seed      # create the load-test account pool
npm run perf:smoke     # 3s sanity check — run this first, every time
npm run perf:load      # expected peak, held
npm run perf:clean     # remove the rows a run created
```

---

## 8. Troubleshooting

**`flyway` fails with "Detected applied migration not resolved locally: seed dev data".**
The `flyway` and `flyway-seed` services once shared one history table while
scanning different directories. Repair Flyway's bookkeeping — this never
touches real data:

```bash
docker run --rm --network inventory-management_default \
  -v "$(pwd)/db/migrations:/flyway/sql" flyway/flyway:10-alpine \
  -url=jdbc:postgresql://postgres:5432/inventory \
  -user="$POSTGRES_USER" -password="$POSTGRES_PASSWORD" \
  -connectRetries=10 repair
```

**Signed in, then immediately 401 on every request.** You're running a
production build over plain HTTP. See section 4.

**`DROP DATABASE` says the database is being accessed by other users.** Stop
`npm run dev` and any open `psql` session, then re-run — the
`pg_terminate_backend` line above handles the rest.

**Port 4000 already in use.**

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

**Uploads fail with "Cloudinary is not configured".** The three
`CLOUDINARY_*` vars are unset. That is the expected result — set them, or
leave them unset if you aren't testing uploads.

**`npm run lint` is not clean on `src/app/(admin)/products/page.tsx`.**
Long-standing `no-explicit-any` warnings, unrelated to any recent change.
