# Postgres / MinIO / JWT Migration — Summary

**Branch:** `feature/postgres-minio-jwt-migration` (21 commits ahead of `development`, not yet pushed or opened as a PR)
**Plan:** [`smooth-churning-bentley.md`](https://claude.ai) — originally saved to `~/.claude/plans/`, reproduced in spirit below.

## What this was

The app was originally on Supabase (Postgres via PostgREST), Firebase Auth, and AWS S3. This migration replaces all three with a fully self-hosted local stack, while keeping every feature behaving the same way it did before:

| Before | After |
|---|---|
| Supabase (PostgREST client) | Local PostgreSQL, schema versioned with **Flyway**, queried via **Drizzle ORM** |
| Firebase Auth | **JWT** in httpOnly cookies (bcrypt passwords, refresh-token rotation with reuse detection) |
| AWS S3 | **MinIO**, with presigned direct-to-browser uploads |
| — | Local **Mailpit** for password-reset email |

One correction to the original ask: the app was **already** Next.js 16 / React 19 (App Router) — there was no React→Next.js migration to do. All the work went into the three backend swaps, plus a cleanup and optimization pass.

## How to see this branch in VS Code

1. Open the Source Control panel (or click the branch name in the bottom-left status bar).
2. Select `feature/postgres-minio-jwt-migration` from the branch list, or run in the integrated terminal:
   ```bash
   git checkout feature/postgres-minio-jwt-migration
   ```
3. VS Code will reload the files to match that branch. If you were on `development`, you'll see this file, `db/`, `src/app/api/auth/`, `middleware.ts`, and everything else described below appear.

The branch hasn't been pushed to GitHub yet, so it's local-only until you say to push it.

## How to run it locally

```bash
docker compose up -d postgres minio mailpit
docker compose up flyway flyway-seed flyway-test minio-init
npm install
npm run dev
```

Log in at `http://localhost:4000/login` with the seeded account:
- **Email:** `admin@inventory.local`
- **Password:** `ChangeMe123!` (change this before using the environment for anything beyond your own local testing)

Run tests: `npm test` (Vitest, 120 tests) and `npm run test:e2e` (Playwright, needs the app running).

## Phase-by-phase breakdown

**Phase 0 — Local infra.** Added `postgres`, `flyway`, `minio`, `mailpit`, `pg_backup` services to `docker-compose.yml`. Wrote the target schema as 11 versioned Flyway migrations (`db/migrations/`) derived from the project's existing schema snapshot (now `db/historical/001_initial_schema.sql`), with fixes baked in: `TIMESTAMP` → `TIMESTAMPTZ` everywhere, the `sessions` table extended for refresh-token storage, a new `id_sequences` table for atomic product/invoice numbering, and the missing `issued_by_user_id`/`user_id`/`borrower_*` indexes. Set up Vitest + Playwright + a GitHub Actions test workflow.

**Phase 1 — Drizzle + auth primitives.** Hand-written Drizzle schema mirroring the Flyway migrations (`src/db/schema/*.ts`), a pooled `pg.Pool` client (`src/db/client.ts`), and the JWT/bcrypt/session-rotation building blocks (`src/lib/jwt.ts`, `passwords.ts`, `sessions.ts`) — deliberately not wired into any route yet, so the app kept working on Firebase/Supabase until the full cutover in Phase 4.

**Phase 2 — Route conversion.** All 28 business-logic API routes converted from the Supabase client to Drizzle, domain by domain (categories/departments → students/staffs → products/stocks → lending → invoices → dashboard → admin/users). Multi-table writes now use real `db.transaction()`s instead of manual insert-then-rollback. Deleted the dead `items/*` routes. Fixed two real pre-existing bugs along the way:
- `lending/[id]` PUT was writing to a column called `mentor` that doesn't exist (should be `mentor_staff_id`) — mentor reassignment silently never saved.
- `dashboard/stats` filtered for a lending status `'ACTIVE'` that isn't a real enum value — a dead, no-op filter.

**Phase 3 — MinIO.** Swapped AWS S3 credentials for MinIO (the S3 client code already supported a custom endpoint, so this was mostly config). Replaced the server-buffered upload endpoint with a presigned direct-to-MinIO flow (`/api/upload/presign` + a shared `src/lib/uploadClient.ts` helper used by all 4 frontend upload call sites) — the Next.js server no longer buffers file bytes. Wired up the previously-dead `deleteFromS3` call so deleting a product also deletes its image.

**Phase 4 — Auth cutover.** New `/api/auth/{login,logout,refresh,forgot-password,reset-password}` routes, `middleware.ts` for edge-level page protection, `authMiddleware.ts` internals swapped from Firebase+Supabase to jose+Drizzle (same exported API, so none of the 28 routes needed to change). `UserContext.tsx` rewritten to use cookies instead of the Firebase SDK, with silent refresh-and-retry on token expiry. Deleted `firebase.ts`, `firebaseAdmin.ts`, `supabaseServer.ts`, and the already-empty `auth.ts`; removed the `firebase`/`firebase-admin`/`@supabase/supabase-js` packages. Found and fixed a real bug during this phase's own E2E testing: after login, nothing told `UserContext` to re-fetch the user profile (Firebase used to do this automatically), so the dashboard bounced straight back to the login page — fixed by explicitly refetching before navigating.

**Phase 5 — Cleanup.** Removed the now-dead Firebase/Supabase build args and env vars from the `Dockerfile`, `docker-compose.yml`, and the DIT deploy GitHub Actions workflow. Deleted the old incremental Supabase SQL scripts (`backend/sql/`). Rewrote `SRD.md` and `LOCAL_PG_CUTOVER.md` to describe the actual current architecture instead of the old one.

**Phase 6 — Optimization.** `next.config.ts` now sets `output: "standalone"`, and the `Dockerfile`'s runner stage copies the traced standalone build instead of the full `node_modules` — smaller image, faster cold start. This surfaced a real bug: the Drizzle client threw immediately at import time if `DATABASE_URL` was unset, which crashed `next build` itself (it imports every route module during its page-data-collection step) — fixed by making that lazy, matching how the old Supabase client was deliberately lazy for the same reason. Introduced TanStack Query and converted the dashboard's four independent data fetches to cached, deduped `useQuery` hooks.

**Phase 7 — Full regression.** Tore down all local containers and volumes (`docker compose down -v`) and rebuilt everything from scratch, purely from committed files, to prove a new developer's setup actually works — then ran the full Vitest + Playwright suites against that clean environment. Manually clicked through every main page in a real browser, which caught one more real bug: the products list endpoint was missing its stock-quantity join (fixed, and the test that should have caught it was strengthened). Verified the complete realistic auth lifecycle — an admin creates a user with a password through the UI, and that user immediately logs in with it through the real JWT flow. Executed the backup/restore runbook for real (not just documented it): inserted a marker row, triggered a backup, deleted the row, restored into a scratch database, confirmed the row came back — which also caught a documentation bug (the backup image produces plain gzipped SQL, not the custom `pg_dump -Fc` format the docs originally described).

## Testing

- **120 Vitest tests** — unit tests for the JWT/bcrypt/session primitives, and integration tests for every route that hit a real local Postgres (`inventory_test` database, isolated from the dev database), including real email delivery verification via Mailpit's API and a real presigned-upload round trip through MinIO.
- **3 Playwright E2E tests** (`e2e/auth.spec.ts`) — unauthenticated redirect, full login → dashboard → logout → redirect cycle, wrong-password error display — run against the actual app and real infrastructure.

## Known follow-ups (not done, intentionally out of scope or flagged for you)

- **Branch not pushed / no PR yet** — you asked to review locally first.
- **Rotate the AWS/Firebase credentials** that were sitting in plaintext in `.env` before this migration — they're unused now but should be invalidated on the provider side.
- **GitHub Secrets for the DIT deploy workflow** — `.github/workflows/deploy-dit.yml` now expects `POSTGRES_*`, `MINIO_*`, `JWT_*`, `SMTP_*` secrets that don't exist in the repo yet. This only matters once/if this branch merges into `development` and the workflow actually runs.
- **Real SMTP for any non-local deployment** — Mailpit is local-dev-only; a real provider needs to be configured before password-reset email works anywhere else.
- Full details of every design decision (schema, Drizzle/Flyway split, cookie/CSRF design, backup strategy) are in the individual commit messages on this branch — each phase's commit has a detailed explanation of what changed and why.
