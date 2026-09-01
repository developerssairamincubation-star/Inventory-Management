# Testing strategy

Where this app's testing actually stands, what each remaining layer is *for*,
and the order worth doing them in. Companion to `k6/README.md`, which covers
the performance suite in operational detail.

---

## 1. Where you are today

| Layer | State | Where |
|---|---|---|
| Unit (pure logic) | **Good** — 6 specs on the genuinely tricky bits: JWT, passwords, sessions, SKU sequences, stock math, student-ID decoding | `src/lib/*.test.ts` |
| Integration (API + real Postgres) | **Strong** — 36 route specs, run against the isolated `inventory_test` DB, not mocks | `src/app/api/**/*.test.ts` |
| Cross-cutting policy | **Strong** — `authorization.test.ts` and `stockIntegrity.test.ts` assert invariants across every route rather than per-route | `src/app/api/` |
| Contract / schema | Implicit in the Zod schemas; no generated contract | — |
| Component (React) | **None** | `src/components/` — 12 components, 0 tests |
| E2E / UI flow | **Barely started** — auth only | `e2e/auth.spec.ts` |
| Accessibility | **None** | — |
| Visual regression | **None** | — |
| Performance | **New** — this change | `k6/` |
| Usability (real humans) | **None** | — |
| CI | vitest + tsc + lint + Playwright on PR and push | `.github/workflows/test.yml` |

The shape here is unusual and worth naming: **the API layer is better tested
than most production apps, and the UI layer is untested.** That is the
opposite of the typical gap, and it changes what's worth doing next. You do
not need more API tests. You need tests that prove the browser and the API
agree.

---

## 2. The layers you're missing, and what each is actually for

Every layer answers a different question. Choosing by "we should have more
tests" produces slow suites that catch nothing; choosing by question produces
a small suite that catches real bugs.

### 2.1 E2E / UI flow — *"do the screens and the API agree?"*

**Highest value for this codebase**, because it is the exact seam nothing
currently covers. Playwright is already configured and wired into CI; there is
one spec.

The bugs this layer catches here are specific and likely:

- The client sends `X-CSRF-Token` on mutations. Nothing outside the browser
  proves the client actually does this — the route tests stub `requireUser`
  entirely.
- `authFetch`'s silent refresh-and-retry after the 15-minute access-token
  expiry. A route test cannot see it; only a browser can.
- Barcode scan-to-fetch: a scanner is just a keyboard that types fast and
  hits Enter. Whether the input's `onKeyDown` fires the lookup at the right
  moment is a UI fact.
- The invoice → stock relationship your team treats as the source of truth:
  restocking happens through the Invoice page's upload flow, not the Stock
  List. That rule lives in the UI. If it is only in someone's head, an E2E
  test is where it becomes enforceable.
- Domain isolation *as rendered*: a COE user must not see another COE's
  products on screen. `authorization.test.ts` proves the API scopes it;
  nothing proves the page does not leak it through a cached query.

Six or seven specs are enough:

```
e2e/
  auth.spec.ts            ✅ exists
  products.spec.ts        create → appears in list → detail → edit stock
  lending.spec.ts         scan student ID → scan SKU → issue → return
  invoice.spec.ts         upload → review parsed lines → confirm → stock rises
  transfer.spec.ts        transfer to another COE → history panel updates
  domain-isolation.spec.ts  COE-A user cannot see COE-B inventory
  admin.spec.ts           create user, assign domain, deactivate
```

Practical notes that decide whether this suite is loved or deleted:

- **Log in once via API, reuse storage state.** Do not drive the login form in
  every spec — it is slow and it burns `RULES.loginPerAccount` (12 per email
  per 15 min).
  Playwright's `storageState` plus a `globalSetup` that POSTs `/api/auth/login`
  is the standard fix.
- **Stub Gemini and Cloudinary.** `page.route()` the `parse-pdf` and
  `presign` calls. Real calls make the suite slow, flaky, and billable —
  the same reason `k6/` excludes them.
- **Each spec creates its own data and cleans up.** `fullyParallel: false` is
  currently set, which papers over shared-state coupling; you want specs that
  would pass in parallel even if you never enable it.
- **Never assert on CSS classes or DOM structure.** `getByRole` /
  `getByLabel`, as `auth.spec.ts` already does. This is also what makes the
  accessibility layer nearly free.

### 2.2 Component tests — *"does this widget behave in isolation?"*

Lower value than E2E here, and worth being selective. Most of the 12
components are presentational and a test would just restate the JSX.

Four earn tests, because they hold real logic:

- `TransferStockModal` — the full-vs-partial split rule (transferring
  everything reassigns the product; transferring less splits a new row) is a
  branch users can get wrong.
- `UploadInvoiceModal` — parse → review → confirm, with an editable
  intermediate state.
- `UploadProductsCsvModal` / `UploadStudentsCsvModal` — malformed CSV,
  duplicate rows, partial failure. Cheap to test, painful in production.
- `Pagination` — boundary arithmetic.

Add `@testing-library/react` + `jsdom`; vitest already picks up `*.test.tsx`.
Note this needs a second vitest project, since the current config is
`environment: "node"` for the DB-backed route tests.

### 2.3 Accessibility — *"can everyone use it?"*

Automatable, cheap, and it rides along on the E2E suite you are already
writing. `@axe-core/playwright`, one assertion per page:

```ts
const results = await new AxeBuilder({ page }).analyze()
expect(results.violations).toEqual([])
```

Catches contrast failures, missing form labels, unlabelled icon buttons, and
bad heading order. It will **not** catch whether the app is usable by keyboard
or screen reader — automated a11y tooling finds roughly a third of real
issues. For an app whose primary input device is a **barcode scanner**,
keyboard-only operation is not an accessibility nicety, it is the core
interaction: tab order and focus management on the lending page deserve a
manual pass.

### 2.4 Visual regression — *"did that CSS change break a page?"*

Playwright has it built in (`toHaveScreenshot()`). Genuinely useful for the
printable artefacts, where a layout break is invisible to every other kind of
test and only shows up on paper: `BarcodeLabel`, the invoice PDF preview, the
jsPDF exports.

Everywhere else it is a flakiness tax. Do not screenshot whole dashboards —
the charts and timestamps change every run.

### 2.5 Usability testing — *"can a person who isn't you complete the task?"*

**This is not automatable, and no tool substitutes for it.** It is moderated
research with real users, and it is the layer most likely to change what you
build rather than confirm it works.

For this app, the cheapest version that still works:

1. **Recruit 5 real users** — the lab staff who actually run a COE counter.
   Five finds ~85% of usability problems; the sixth participant mostly repeats
   the first five.
2. **Give tasks, not instructions.** "A student wants to borrow two
   multimeters. Issue them." — never "click Lending, then Add Item."
3. **Watch, and shut up.** Time each task, note every hesitation, every wrong
   click, every question asked out loud. The instinct to help is the thing
   that ruins the session.
4. **Instrument the obvious targets** in this app: time to issue a loan by
   scanner vs. typing; whether people find the transfer feature without being
   told; whether the invoice-upload flow is understood as "this is how you
   restock" (it is the rule, and it is not self-evident from the UI); error
   recovery when a scan fails.
5. **Write down the top 3 problems and fix them.** A report nobody acts on is
   worse than no session, because it feels like progress.

Adjacent things you *can* automate, which are not a substitute:

- **Task-completion instrumentation** — log time from lending-page open to
  successful issue. A p95 that climbs after a redesign is a usability
  regression with a number attached.
- **Error-rate telemetry** — Sentry is already wired up. `VALIDATION_ERROR`
  rates per endpoint are a usability signal: if `student_id_code` 400s a lot,
  the input is not teaching people its format.
- **UX copy review** — every error message the API returns is user-facing
  copy. `"Unrecognized student ID format"` does not tell anyone what the
  format is.

### 2.6 Contract testing — *"do the client and server still agree?"*

Only worth it once something outside this repo consumes the API (a mobile app,
a second frontend, a reporting job). Today client and server ship together and
TypeScript covers the seam. Revisit when that stops being true; the cheap
version is generating an OpenAPI document from the existing Zod schemas.

### 2.7 Security — *"can someone else's data be reached?"*

Partly covered already: `authorization.test.ts` for scoping,
`k6/tests/rate-limit.js` for limits, CSRF, and login enumeration. What is not:

- **Dependency scanning.** `npm audit` / Dependabot in CI. Cheapest security
  win available.
- **Authenticated authorization fuzzing.** Take every route, call it as a
  COE-A user with COE-B ids, assert 404/403 every time. Mostly generatable
  from the route list.
- **Secret hygiene.** `AI_SESSION_HANDOFF.md` holds live production Neon
  credentials, a billable Gemini key, and Cloudinary secrets in plaintext. It
  is git-ignored, which stops the commit but not a backup, a sync client, or a
  file picked up by a tool with filesystem access. Rotating those and moving
  them to a secret manager is worth more than any test in this document.

---

## 3. Order of work

Sequenced by value per hour, not by pyramid orthodoxy.

| # | Work | Why here |
|---|---|---|
| 1 | `k6/tests/smoke.js` in CI | 3 seconds, catches API contract drift, already written |
| 2 | Playwright: lending + products + invoice flows | The real gap. Highest bug-yield per hour in this repo |
| 3 | `@axe-core/playwright` on those specs | Nearly free once #2 exists |
| 4 | Load + stress against a **production build** | Establishes the baseline every later run is compared to |
| 5 | Usability session, 5 users, 3 tasks | Changes what you build, not just what you verify |
| 6 | Component tests for the 4 stateful modals | Fills in behind the E2E specs |
| 7 | Visual regression on barcode/PDF output only | Narrow, high signal |
| 8 | `npm audit` in CI + rotate the handoff credentials | Small, overdue |

---

## 4. Where each suite should run

| Suite | Local | CI (PR) | DIT | Prod |
|---|---|---|---|---|
| vitest (unit + integration) | ✅ | ✅ | ✅ | — |
| Playwright E2E | ✅ | ✅ | ✅ | smoke only |
| axe accessibility | ✅ | ✅ | — | — |
| k6 smoke | ✅ | ✅ | ✅ | — |
| k6 load / stress / spike | ⚠️ dev-mode numbers are meaningless | ❌ shared runners lie | ✅ **the right place** | ❌ never |
| k6 soak | — | ❌ | ✅ nightly | ❌ never |
| k6 rate-limit | ✅ | ❌ leaves 15-min buckets set | ✅ | ❌ never |
| Usability | — | — | ✅ | — |

Two rules worth stating out loud:

**Never load-test production.** `guardTarget()` in `k6/lib/config.js` aborts on
any Neon or Vercel host for exactly this reason.

**A performance number is only meaningful against a fixed environment.** Same
hardware, same dataset size, same build. `npm run dev` fails all three — Next
compiles routes on first request, so a dev-mode p99 is 10–50x reality and
depends on what you compiled last. The `DIT` environment this repo already
deploys to (`.github/workflows/deploy-dit.yml`) is the natural home for the
load suite: real build, real Postgres, nobody's data at risk.
