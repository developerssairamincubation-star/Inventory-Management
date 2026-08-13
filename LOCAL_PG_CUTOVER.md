# Local Postgres Cutover — completed

This document originally analyzed what would need to change for the app to
run against local Postgres/MinIO/JWT instead of Supabase/AWS/Firebase. That
migration has since been completed on the `feature/postgres-minio-jwt-migration`
branch. This file is kept only as historical context for the "why" behind
some decisions; it no longer describes the current state of the app.

For the current setup:

- Schema & migrations: `db/migrations/` (Flyway), documented in `db/README.md`.
- Data access: Drizzle ORM, `src/db/schema/*.ts` + `src/db/client.ts`.
- Auth: JWT in httpOnly cookies, `src/lib/authMiddleware.ts` + `src/app/api/auth/*`.
- Object storage: MinIO, `src/lib/s3.ts` + `src/app/api/upload/presign/route.ts`.
- Local dev stack: `docker-compose.yml` (`postgres`, `flyway`, `minio`, `mailpit`, `pg_backup`).

The blockers this document identified were all addressed during the
migration: the `items` dead routes were deleted, the `mentor` vs
`mentor_staff_id` field-name bug was fixed, the dead `ACTIVE` status filter
was removed, the missing `issued_by_user_id` index was added, and the
Supabase client dependency was fully replaced with Drizzle across every
route.
