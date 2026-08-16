# Database: Flyway migrations, seed data, backup & restore

Flyway is the single source of truth for schema. `src/db/schema/*.ts`
(Drizzle, added in Phase 1) is a hand-written typed query layer over
whatever these migrations create — never run `drizzle-kit generate`/`push`
against this schema.

## Layout

- `migrations/` — versioned migrations (`V1__...sql`, `V2__...sql`, ...). Once
  applied anywhere, a migration file is immutable — new changes always get a
  new `VN__description.sql` file, never an edit to a shipped one.
- `seed/` — `R__seed_dev_data.sql`, a Flyway *repeatable* migration with
  dev-only data (a super_admin login, a sample department/category). Re-run
  freely in local/dev. Never point this at a prod-labeled Flyway invocation.
- `conf/flyway.conf` — shared config; reads connection details from
  `FLYWAY_URL` / `FLYWAY_USER` / `FLYWAY_PASSWORD` env vars so the same file
  works against both the docker-composed Postgres and a natively-installed one.
- `init/01_create_test_db.sh` — Postgres `docker-entrypoint-initdb.d` script
  that creates the separate `inventory_test` database on first container init
  (used by the Vitest integration suite; never shares data with the dev DB).
- `historical/001_initial_schema.sql` — the pre-Flyway Supabase-era schema
  snapshot the migrations above were built from. Superseded, never applied
  to any database; kept only as a historical reference (moved here from a
  confusingly-named root-level `testing/` folder — it was never test code).

## Running migrations

Via Docker Compose (recommended — this is what `app` waits on to start):

```bash
docker compose up flyway        # migrates the dev DB (inventory)
docker compose up flyway-seed   # loads dev seed data (dev/local only)
docker compose up flyway-test   # migrates the test DB (inventory_test)
```

Against a natively-installed local Postgres (requires the Flyway CLI, e.g.
`brew install flyway` on macOS):

```bash
npm run db:migrate   # applies db/migrations
npm run db:seed      # applies db/seed (dev/local only)
npm run db:info      # shows applied/pending migrations
```

## Backup & restore (local/dev)

The `pg_backup` compose service ([prodrigestivill/postgres-backup-local](https://github.com/prodrigestivill/docker-postgres-backup-local))
runs a daily `pg_dump` (plain SQL, gzipped — not the custom `-Fc` format),
keeping daily/weekly/monthly rotations in the `pgbackups` named volume —
deliberately separate from the live `pgdata` volume, so a corrupted live
volume can't also take out the backups. Trigger one immediately (rather
than waiting for the daily schedule) with:

```bash
docker compose exec pg_backup sh /backup.sh
```

**Restore a dump** — verified end-to-end (insert a marker row, back up,
delete the row, restore into a scratch database, confirm the row comes
back) as part of the Postgres/MinIO/JWT migration's Phase 7 regression pass.
The dump is a **plain, non-`--clean` `pg_dump`** — it contains `CREATE
TABLE`/`CREATE TYPE` etc. with no `DROP` statements first, so restoring
into a database that already has this schema fails with "already exists"
errors. Always restore into an empty/fresh database:

```bash
# 1. List available dumps
docker compose exec pg_backup ls /backups/daily

# 2. Stop the app so nothing writes during restore
docker compose stop app

# 3a. To recover in place: drop and recreate the live database first
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE \"$POSTGRES_DB\"; CREATE DATABASE \"$POSTGRES_DB\";"

# 3b. Restore (gunzip the dump straight into psql)
docker compose exec pg_backup sh -c "zcat /backups/daily/inventory-latest.sql.gz" \
  | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# 4. Restart the app
docker compose start app
```

To verify a backup without touching the live database, restore into a
throwaway database instead of step 3a (`CREATE DATABASE inventory_check;`,
restore into that, inspect, then `DROP DATABASE inventory_check;`).

**Off-host copy** (a same-host Docker volume is not disaster-proof by
itself):

```bash
docker run --rm -v inventory-management_pgbackups:/b \
  -v "$(pwd)/local-backups:/dst" alpine cp -r /b/. /dst/
```

Object storage (Cloudinary, see `src/lib/cloudinary.ts`) is a hosted
third-party service, not a local volume — Cloudinary retains uploaded assets
on its own, no separate backup step needed here. Restoring an old Postgres
dump can still leave `product_image.image_url` rows pointing at assets that
were since deleted from Cloudinary (or vice versa) — same dangling-reference
risk as before, just without a volume to restore in tandem.

Not adopted at this stage: WAL archiving / point-in-time recovery
(pgBackRest/WAL-G). That's real operational complexity that only pays off
with production data and sub-daily RPO requirements — neither applies yet
for this local-dev/DIT-focused setup. Revisit when this moves to a real
production deployment (at that point, prefer a managed Postgres with
built-in automated snapshots/PITR over self-hosting this by hand).
