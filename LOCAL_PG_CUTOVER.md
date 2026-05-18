# Local Postgres Cutover Guide

This document summarizes what must change in this project if you want the app to work against a locally running PostgreSQL database instead of the current Supabase-backed setup.

## Short verdict

The base schema in [testing/001_initial_schema.sql](testing/001_initial_schema.sql) is close to the app's current data model, but the project is not ready for a direct switch to plain PostgreSQL yet.

Two separate things need to be true for the cutover to work:

1. The database schema must match what the code expects.
2. The application must stop depending on Supabase client behavior if the backend is no longer Supabase.

Right now, the schema is mostly present, but the code still depends on Supabase client semantics, nested relation selects, and Firebase-backed auth logic.

## What is already covered by the schema

The snapshot in [testing/001_initial_schema.sql](testing/001_initial_schema.sql) already contains the main tables and views used by the app:

- [users](testing/001_initial_schema.sql#L58)
- [departments](testing/001_initial_schema.sql#L49)
- [students](testing/001_initial_schema.sql#L87)
- [staffs](testing/001_initial_schema.sql#L101)
- [category](testing/001_initial_schema.sql#L120)
- [products](testing/001_initial_schema.sql#L126)
- [product_image](testing/001_initial_schema.sql#L147)
- [stocks](testing/001_initial_schema.sql#L162)
- [lending_order](testing/001_initial_schema.sql#L181)
- [lending_item](testing/001_initial_schema.sql#L205)
- [purchase_invoice](testing/001_initial_schema.sql#L229)
- [purchase_invoice_item](testing/001_initial_schema.sql#L245)
- [invoice_documents](testing/001_initial_schema.sql#L261)
- [notifications](testing/001_initial_schema.sql#L277)
- [vw_low_stock](testing/001_initial_schema.sql#L289)
- [vw_top_lending_products](testing/001_initial_schema.sql#L300)

That means the core business schema is not the main issue.

## Hard blockers

### 1. The app still uses Supabase as the database client

The DB seam is [src/lib/supabaseServer.ts](src/lib/supabaseServer.ts#L1). It creates a Supabase client from `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Why this blocks a plain local PostgreSQL cutover:

- A raw Postgres database does not speak the Supabase client API.
- Many routes use `.select(...)`, nested relation expansion, `.single()`, `.maybeSingle()`, `.in()`, `.eq()`, and chained PostgREST-style queries.
- The code assumes Supabase error/result behavior everywhere.

Method to fix:

1. Choose a local data-access layer that can talk to Postgres directly, such as `pg`, Prisma, Drizzle, or a repository wrapper around SQL queries.
2. Replace the `getSupabaseAdmin()` implementation with that layer.
3. Rewrite each API route to use the new query method instead of Supabase client calls.

If you do not want to rewrite the app layer, the easier path is to run a local Supabase stack instead of plain Postgres.

### 2. The `items` API expects a table that does not exist in the schema snapshot

These routes use an `items` table:

- [src/app/api/items/route.ts](src/app/api/items/route.ts#L6)
- [src/app/api/items/[id]/route.ts](src/app/api/items/[id]/route.ts#L7)

The file [testing/001_initial_schema.sql](testing/001_initial_schema.sql) does not define `CREATE TABLE items`.

Why this blocks cutover:

- Fresh local databases will fail those routes immediately.
- If production data currently uses a different table name, the route is pointing at the wrong model.

Method to fix:

1. Decide whether `items` is a legacy endpoint or a real table you still need.
2. If it is real, add the missing `items` table to the schema and seed/migrate it.
3. If it is legacy, remove or redirect those routes so they use the actual canonical table.

### 3. Lending update writes the wrong field name for mentor

The schema uses `mentor_staff_id` in [testing/001_initial_schema.sql](testing/001_initial_schema.sql#L187), and most code paths read that column.

But the update handler writes:

- [src/app/api/lending/[id]/route.ts](src/app/api/lending/[id]/route.ts#L144)

That code assigns `orderUpdate.mentor = mentor`, which does not match the schema.

Why this matters:

- Mentor changes will not persist to the right column.
- The update logic will behave inconsistently during local testing.

Method to fix:

1. Replace the update key with `mentor_staff_id`.
2. Make sure all create/update/read paths use the same field name.
3. Verify the UI still displays mentor names by joining against `staffs`.

### 4. Dashboard stats expects an `ACTIVE` lending status that is not in the enum snapshot

The dashboard stats route includes `ACTIVE` in its active-status list:

- [src/app/api/dashboard/stats/route.ts](src/app/api/dashboard/stats/route.ts#L64)

But the enum in [testing/001_initial_schema.sql](testing/001_initial_schema.sql#L33) does not include `ACTIVE` in `lending_order_status`.

Why this matters:

- If the app or existing data ever uses `ACTIVE`, a strict local schema will not match.
- Reporting logic may count statuses differently from the actual database values.

Method to fix:

1. Decide whether `ACTIVE` is a real business status or a leftover application alias.
2. If it is real, add it to the enum and migrate existing data accordingly.
3. If it is not real, remove it from the application status lists and normalize the logic to the enum values already in the schema.

### 5. Firebase auth is still part of the user flow

Auth is not just database-based. The app does both of these:

- Looks up users by `firebase_uid` in [src/lib/authMiddleware.ts](src/lib/authMiddleware.ts#L22)
- Creates Firebase accounts before inserting users in [src/app/api/admin/users/route.ts](src/app/api/admin/users/route.ts#L44)

Why this matters:

- A local Postgres database alone does not replace the auth flow.
- If Firebase is removed, login, session validation, and admin user creation all need a new implementation.

Method to fix:

1. Decide whether Firebase stays or goes.
2. If Firebase stays, keep the `users` table shape and seeded admin rows intact.
3. If Firebase goes, replace token verification, user lookup, and admin user creation with a local auth strategy.

## Schema gaps or operational risks

### 1. `pgcrypto` must be enabled locally

The schema uses `gen_random_uuid()` and explicitly enables `pgcrypto` in [testing/001_initial_schema.sql](testing/001_initial_schema.sql#L13).

Method to fix:

1. Enable the extension in the local Postgres database.
2. Confirm UUID inserts work before loading application data.

### 2. The ownership filter should be indexed

Many routes filter by `issued_by_user_id`, especially:

- [src/app/api/lending/route.ts](src/app/api/lending/route.ts#L31)
- [src/app/api/lending/[id]/route.ts](src/app/api/lending/[id]/route.ts#L21)
- [src/app/api/dashboard/stats/route.ts](src/app/api/dashboard/stats/route.ts#L51)
- [src/app/api/dashboard/overdue/route.ts](src/app/api/dashboard/overdue/route.ts#L18)
- [src/app/api/dashboard/top-lent/route.ts](src/app/api/dashboard/top-lent/route.ts#L28)

The base schema has indexes on `lending_order.status` and `lending_order.created_at` in [testing/001_initial_schema.sql](testing/001_initial_schema.sql#L202) and [testing/001_initial_schema.sql](testing/001_initial_schema.sql#L203), but not on `issued_by_user_id`.

Why this matters:

- Correctness is fine.
- Performance will degrade as the dataset grows.

Method to fix:

1. Add an index on `lending_order(issued_by_user_id)`.
2. If the app grows, consider indexing other high-frequency filter columns as well.

### 3. Sequential code generation is race-prone

The app generates identifiers by reading the last row and incrementing:

- Product codes in [src/app/api/products/route.ts](src/app/api/products/route.ts#L79)
- Invoice numbers in [src/app/api/invoices/next-number/route.ts](src/app/api/invoices/next-number/route.ts#L10)

Why this matters:

- Two concurrent requests can generate the same next number.
- This will show up more clearly on a local database with real concurrent testing.

Method to fix:

1. Move the counter into the database, using a sequence, locked counter row, or generated column strategy.
2. Stop relying on “read last row and increment” for unique business identifiers.

## Tables and routes that already line up reasonably well

The following areas look structurally aligned with the schema snapshot:

- Product CRUD and product images, because `products`, `product_image`, and `stocks` all exist.
- Invoice CRUD, because `purchase_invoice` and `purchase_invoice_item` both exist.
- Lending base entities, because `lending_order` and `lending_item` both exist.
- Department, students, and staffs workflows, because the tables are present.

That said, those areas still depend on Supabase query semantics, so schema presence alone is not enough.

## Recommended migration path

### Option A: lowest-risk path

Run a local Supabase stack instead of replacing Supabase at the application layer.

Why this is easiest:

- The code can keep using the existing Supabase client API.
- Nested relations and current query patterns keep working.
- You mainly need to ensure the schema and local env vars match.

### Option B: true plain PostgreSQL path

If you really want a direct local Postgres backend, the project needs a data-layer rewrite.

Recommended sequence:

1. Finalize schema parity.
2. Add the missing `items` table or remove the legacy routes.
3. Fix the mentor field bug.
4. Decide on `ACTIVE` status handling.
5. Add the missing `issued_by_user_id` index.
6. Replace Supabase client usage with a direct Postgres access layer.
7. Replace or refactor auth so it no longer depends on Supabase assumptions.

## Practical verification checklist

Before you cut over, verify all of these against the local database:

1. `pgcrypto` is enabled.
2. Every table used by the app exists.
3. Every column used by the app exists and has the same name.
4. Every enum value used by the app exists in the database.
5. The `items` routes are either removed or backed by a real table.
6. `mentor_staff_id` is used consistently everywhere.
7. Auth still works with the chosen local setup.
8. High-frequency filters such as `issued_by_user_id` have supporting indexes.
9. The code no longer depends on Supabase client query behavior if Supabase is removed.

## Bottom line

The schema file is a good starting point, but the current project is not yet a clean local-Postgres app.

What is wrong today is not just missing DDL. The bigger issues are:

- The app still depends on Supabase client behavior.
- There is at least one missing table reference (`items`).
- There is at least one wrong column write (`mentor` vs `mentor_staff_id`).
- One status value in code does not match the enum snapshot (`ACTIVE`).
- Auth is still tied to Firebase plus the `users` table.

If you want, the next step is to turn this into a concrete task list ordered by file and priority so you can edit the project in the safest sequence.