# Inventory Frontend System Requirements Document (SRD)

## 1) Purpose and Scope
- Web-based inventory management frontend built with Next.js (App Router) for admins and dashboard users.
- Provides product, lending, billing, staff, student, and inventory workflows via REST-like API routes hosted in the same Next.js app.

## 2) Architecture Overview
- **Framework**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 (via @tailwindcss/postcss) with custom globals.css theme tokens.
- **UI Composition**: Layouts under `src/app/(admin)` and `src/app/(auth)` with shared `Navbar`, `Sidebar`, and `ProtectedRoute` components.
- **APIs**: Route handlers in `src/app/api/**` for CRUD on products, items, lending, invoices, staffs, students, stocks, upload, and dashboard stats.
- **Data/Storage**:
  - Supabase (service role + anon) for database access (see `src/lib/supabaseServer.ts`).
  - Firebase (client SDK) for auth/session (see `src/lib/firebase.ts`, `src/lib/auth.ts`).
  - AWS S3 for asset storage/presigned uploads (see `src/lib/s3.ts`).
- **Routing**: Auth gate redirects unauthenticated users to `/login`; admin pages under `/` with `(admin)` segment; dashboard pages under `/dashboard`.

## 3) Runtime Environments and Configuration
- Node.js 20+ recommended (align with Next.js 16 and React 19). 
- Required environment variables (see `.env.local`):
  - Firebase: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`.
  - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose to client bundles).
  - AWS S3: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, optional `AWS_S3_ENDPOINT`.
- Local dev: `npm install`, then `npm run dev`. Build: `npm run build`; start: `npm run start`.
- Images: `next.config.ts` allows remote images from AWS S3 host patterns.

## 4) Security Requirements
- **Secret handling**: Keep `.env.local` out of VCS (`.gitignore` already does). Rotate leaked credentials; use scoped IAM keys for S3 and least-privilege Supabase service role.
- **Auth**: Enforce Firebase auth on client and server. `ProtectedRoute` should guard admin UI; verify that API routes validate auth tokens server-side (Supabase service role should never be reachable from unauthenticated clients).
- **Data access**: Prefer using Supabase RLS with JWT claims; avoid exposing service role to client paths. Ensure upload endpoints issue presigned URLs instead of accepting raw file streams.
- **Transport**: Enforce HTTPS in production; configure CORS on API routes and S3 bucket to only allow required origins and methods.
- **Input validation**: API handlers must validate and sanitize request bodies (quantities, costs, IDs) before DB writes; reject negative/overflow values.
- **Logging and PII**: Avoid logging secrets; redact personal identifiers in client-visible errors.
- **Dependency hygiene**: Keep `@aws-sdk/*`, `firebase`, `@supabase/supabase-js`, Next.js, and React patched; run `npm audit` periodically.

## 5) Functional Requirements (high level)
- Product management: create, list, search, update stock, upload product images.
- Lending workflows: track lending items, statuses (including damaged/lost/partially returned), overdue/low-stock reporting.
- Billing/Invoices: generate next invoice numbers and CRUD invoices.
- User management: staffs and students records.
- Dashboard: aggregate stats (top lent, low stock, overdue) via API routes.

## 6) Non-Functional Requirements
- **Performance**: Dashboard/API endpoints should respond <500ms for typical queries; paginate long lists; debounce search in UI.
- **Reliability**: Handle Supabase/S3/Firebase failures gracefully with user-facing errors and retries where safe (idempotent writes for stock updates).
- **Availability**: Target 99.5% for admin UI; avoid single-region lock-in by allowing configuration of S3 region and Supabase URL.
- **Usability**: Consistent layout; grid/list toggle for products; loading and saving states in UI.
- **Maintainability**: Strict TypeScript enabled; keep API route logic thin and centralized in `src/lib/api.ts` helpers where possible.

## 7) Data and Integrations
- **Supabase**: primary database; ensure SQL migrations in `/backend/sql/*.sql` are applied.
- **Firebase Auth**: client sessions; server should verify ID tokens when performing privileged actions.
- **AWS S3**: asset storage via presigned upload (credentials never sent to browser).

## 8) Deployment Considerations
- Use production-only env file or secret store (Vercel, Azure Key Vault, AWS SSM). Do not bundle `SUPABASE_SERVICE_ROLE_KEY` to client.
- Set `NODE_ENV=production` for builds; configure `NEXT_PUBLIC_*` vars only for data safe to expose.
- Consider CDN for static assets; enforce caching headers for images; disable caching on sensitive API responses.

## 9) Observability and Operations
- Add structured logging in API routes (request id, user id, resource id). Avoid logging secrets or PII.
- Add health check route (lightweight) if deploying behind load balancer.
- Monitor S3 upload errors and Supabase latency; set alarms on auth failures and stock update errors.

## 10) Risks and Open Items
- Service role key leakage risk if used client-side—review API handlers to ensure server-only usage.
- Missing server-side auth guards in some API routes would expose data; audit and enforce token verification.
- Input validation not yet confirmed on all endpoints; add schema validation (e.g., zod) per route.
- Environment secrets currently present in workspace; rotate keys before production deployment.
