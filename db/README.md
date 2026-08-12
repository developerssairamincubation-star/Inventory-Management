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

The `pg_backup` compose service runs `pg_dump -Fc` daily, keeping 7 daily +
4 weekly dumps in the `pgbackups` named volume — deliberately separate from
the live `pgdata` volume, so a corrupted live volume can't also take out the
backups.

**Restore a dump:**

```bash
# 1. List available dumps
docker compose exec pg_backup ls /backups/inventory

# 2. Stop the app so nothing writes during restore
docker compose stop app

# 3. Restore (drops/recreates conflicting objects, safe on a fresh or
#    existing target database)
docker compose exec -T postgres pg_restore \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < /path/to/inventory-<timestamp>.dump

# 4. Restart the app
docker compose start app
```

**Off-host copy** (a same-host Docker volume is not disaster-proof by
itself):

```bash
docker run --rm -v inventory-management_pgbackups:/b \
  -v "$(pwd)/local-backups:/dst" alpine cp -r /b/. /dst/
```

MinIO's data volume (`miniodata`) should be backed up the same way — either
`mc mirror` to a second target or a periodic tarball of the volume — on the
same schedule as the Postgres dump, since `product_image.image_url` rows in
Postgres reference MinIO object keys; restoring one without the other at the
same point in time leaves dangling references.

Not adopted at this stage: WAL archiving / point-in-time recovery
(pgBackRest/WAL-G). That's real operational complexity that only pays off
with production data and sub-daily RPO requirements — neither applies yet
for this local-dev/DIT-focused setup. Revisit when this moves to a real
production deployment (at that point, prefer a managed Postgres with
built-in automated snapshots/PITR over self-hosting this by hand).
