# Inventory Frontend System Requirements Document (SRD)

## 1) Purpose and Scope
- Web-based inventory management app built with Next.js (App Router) for admins and dashboard users.
- Provides product, lending, billing, staff, student, and inventory workflows via REST-like API routes hosted in the same Next.js app.

## 2) Architecture Overview
- **Framework**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 (via @tailwindcss/postcss) with custom globals.css theme tokens.
- **UI Composition**: Layouts under `src/app/(admin)` and `src/app/(auth)` with shared `Navbar`, `Sidebar`, and `ProtectedRoute` components.
- **APIs**: Route handlers in `src/app/api/**` for CRUD on products, lending, invoices, staffs, students, stocks, upload, auth, and dashboard stats.
- **Data/Storage**:
  - Local PostgreSQL, schema versioned by Flyway (`db/migrations/`), accessed via Drizzle ORM (`src/db/schema/*.ts`, `src/db/client.ts`).
  - JWT (httpOnly cookies) for auth/session, bcrypt-hashed passwords (`src/lib/authMiddleware.ts`, `src/lib/jwt.ts`, `src/lib/passwords.ts`, `src/lib/sessions.ts`).
  - Local MinIO (S3-compatible) for asset storage via presigned direct uploads (`src/lib/s3.ts`, `src/app/api/upload/presign/route.ts`).
  - Local Mailpit (SMTP) for password-reset email in dev (`src/lib/mailer.ts`).
- **Routing**: `middleware.ts` does edge-level auth gating (redirects unauthenticated page requests before client JS runs); `ProtectedRoute` is a client-side backstop; admin pages under `(admin)`, dashboard pages under `/dashboard`, auth pages under `(auth)`.

## 3) Runtime Environments and Configuration
- Node.js 20+ recommended (align with Next.js 16 and React 19).
- Local dev infra: `docker compose up -d postgres flyway flyway-seed minio minio-init mailpit` (see `docker-compose.yml`, `db/README.md`), then `npm run dev`.
- Required environment variables (see `.env.example`):
  - Postgres: `DATABASE_URL`, `DATABASE_TEST_URL`, `POSTGRES_*`, `FLYWAY_*`.
  - MinIO/S3 client: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT`.
  - Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_PEPPER`.
  - Mail: `SMTP_HOST`, `SMTP_PORT`, optional `SMTP_FROM`.
- Build: `npm run build`; start: `npm run start`.
- Images: `next.config.ts` allows remote images from the local MinIO host.

## 4) Security Requirements
- **Secret handling**: Keep `.env` out of VCS (`.gitignore` already does; `.env.example` is the committed template). Rotate any credentials that were ever exposed in plaintext.
- **Auth**: JWT access token (15 min) + refresh token (30 days, rotated on use, reuse triggers full session revocation) in httpOnly cookies; CSRF protected via double-submit cookie (`csrf_token` + `X-CSRF-Token` header) enforced in `getAuthUser()`. `middleware.ts` gates pages at the edge; every API route additionally verifies server-side via `src/lib/authMiddleware.ts`.
- **Data access**: Ownership filtering (`user_id`/`issued_by_user_id`) is enforced in application code per route, not via Postgres RLS — see the schema design notes in the migration plan for the rationale. Ensure upload endpoints issue presigned URLs instead of accepting raw file streams (done — `/api/upload/presign`).
- **Transport**: Enforce HTTPS in production; set cookie `Secure` flag in production (`src/lib/cookies.ts` already branches on `NODE_ENV`); configure CORS on MinIO to only allow required origins.
- **Input validation**: API handlers must validate and sanitize request bodies (quantities, costs, IDs) before DB writes; reject negative/overflow values.
- **Logging and PII**: Avoid logging secrets; redact personal identifiers in client-visible errors.
- **Dependency hygiene**: Keep `@aws-sdk/*`, `drizzle-orm`, `jose`, `bcryptjs`, Next.js, and React patched; run `npm audit` periodically.

## 5) Functional Requirements (high level)
- Product management: create, list, search, update stock, upload product images.
- Lending workflows: track lending items, statuses (including damaged/lost/partially returned), overdue/low-stock reporting.
- Billing/Invoices: generate next invoice numbers and CRUD invoices.
- User management: staffs and students records; admin user management with role-based access.
- Auth: email/password login, forgot/reset password, session refresh, logout.
- Dashboard: aggregate stats (top lent, low stock, overdue) via API routes.

## 6) Non-Functional Requirements
- **Performance**: Dashboard/API endpoints should respond <500ms for typical queries; paginate long lists; debounce search in UI.
- **Reliability**: Handle Postgres/MinIO/SMTP failures gracefully with user-facing errors and retries where safe (idempotent writes for stock updates); multi-table writes use real DB transactions (`db.transaction`) instead of manual rollback.
- **Availability**: Target 99.5% for admin UI.
- **Usability**: Consistent layout; grid/list toggle for products; loading and saving states in UI.
- **Maintainability**: Strict TypeScript enabled; keep API route logic thin and centralized in `src/lib/api/*` helpers where possible.

## 7) Data and Integrations
- **PostgreSQL**: primary database; schema is Flyway-managed (`db/migrations/`), never hand-edited in the running DB.
- **JWT auth**: bcrypt-hashed passwords, httpOnly-cookie tokens; server verifies signature+expiry (edge) and DB state (`is_active`, role) on every API request.
- **MinIO**: asset storage via presigned upload (credentials never sent to browser).
- **Mailpit/SMTP**: password-reset email delivery.

## 8) Deployment Considerations
- Use production-only env file or secret store. Never bundle `JWT_ACCESS_SECRET`/`JWT_REFRESH_PEPPER`/DB or MinIO credentials into the client.
- Set `NODE_ENV=production` for builds.
- Consider CDN for static assets; enforce caching headers for images; disable caching on sensitive API responses.
- See `db/README.md` for the backup/restore runbook (Postgres `pg_dump` + MinIO mirror, daily, separate volume from live data).

## 9) Observability and Operations
- Add structured logging in API routes (request id, user id, resource id). Avoid logging secrets or PII.
- Add health check route (lightweight) if deploying behind load balancer.
- Monitor MinIO upload errors and Postgres latency; set alarms on auth failures and stock update errors.

## 10) Risks and Open Items
- Row-level ownership filtering is application-enforced only (no Postgres RLS) — every new route touching `products`/`lending_order`/`purchase_invoice` must remember the ownership filter.
- Input validation not yet confirmed on all endpoints; add schema validation (e.g., zod) per route.
- Local dev SMTP (Mailpit) is not wired for any real deployment target — a real SMTP provider must be configured before password-reset email works outside local dev.
