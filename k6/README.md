# Performance suite (k6)

Load, stress, spike, soak, breakpoint and rate-limit tests that drive the real
API through the same flows the UI does.

```
k6/
  lib/       config, auth/session handling, metrics, data generators, shared scenario
  flows/     one module per business flow (browse, lending, stock, invoice)
  tests/     one file per test type — these differ ONLY in load shape
  seed/      SQL to create the account pool and to clean up afterwards
```

The split matters: every test in `tests/` runs the *same* traffic mix from
`lib/scenario.js`. A load run and a spike run are only comparable if the work
is literally the same code, so the load shape is the only variable.

---

## 1. Before your first run

### Install

```bash
brew install k6
```

### Start a target

```bash
docker compose up -d postgres flyway flyway-seed
npm run dev          # http://localhost:4000
```

> **`npm run dev` is not a valid performance target.** Next.js compiles routes
> on first request and skips every production optimisation — a dev-mode p99 is
> 10–50x the real number and moves around depending on what you compiled last.
> Use it to prove the *scripts* work (`smoke`), never to produce numbers you
> quote. For real numbers:
>
> ```bash
> npm run build && npm run start     # or: docker compose up -d app
> ```

### A production build needs TLS in front

`src/lib/cookies.ts` sets every auth cookie with `secure: isProd()`, and
`npm run start` sets `NODE_ENV=production`. A Secure cookie is only ever sent
back over HTTPS — by a browser and by k6's cookie jar alike. So a production
build on plain `http://localhost:4000` logs in successfully and then answers
**401 to everything after it**.

That is the app being correct. It just means "production build" and "plain
HTTP" cannot be combined. Terminate TLS in front of it:

```bash
node k6/tools/gen-cert.mjs          # once — self-signed, localhost only
node k6/tools/tls-proxy.mjs         # https://localhost:4443 -> :4000
BASE_URL=https://localhost:4443 k6 run --insecure-skip-tls-verify k6/tests/load.js
```

`sharedSetup()` probes `GET /api/auth/me` after logging in and aborts with
this explanation if the session does not persist, so you get a clear message
rather than a run full of silent 401s that looks impressively fast.

### Seed the account pool

```bash
psql "$DATABASE_URL" -v users=20 -f k6/seed/load-users.sql
```

This creates 20 accounts (`k6.load0@loadtest.local` … `k6.load19@…`, password
`LoadTest123!`), a `K6 Load Test COE` domain, a `K6 Load Test Dept` with code
`KX`, and a category.

**Why a pool and not one account.** `POST /api/auth/login` enforces
`RULES.loginPerAccount` — 12 logins per email per 15 minutes
(`src/lib/rateLimit.ts`). Each k6 VU logs in once, so past ~10 VUs per account
the run starts failing at the login step and measures nothing.

> **Rule of thumb: `PERF_USER_COUNT >= VUs / 10`.**

**Why a dedicated COE.** Authorization is domain-scoped
(`src/lib/authz.ts`): a user sees the inventory of whoever shares their COE.
Putting the load accounts in their own domain means the suite drives a
realistic non-`super_admin` scope, and its rows stay separable from real data.

---

## 2. Running

Always start with smoke. It is three seconds and it catches the failure mode
that ruins load runs — a flow that silently 403s on CSRF still produces a
beautiful-looking report.

```bash
k6 run k6/tests/smoke.js                                    # read-only
PERF_ALLOW_WRITES=true k6 run k6/tests/smoke.js               # all flows
```

Then, in the order you should actually run them:

```bash
# LOAD — expected peak, held. These are the numbers you quote.
PERF_USER_COUNT=20 PERF_ALLOW_WRITES=true PERF_VUS=50 PERF_DURATION=10m \
  k6 run k6/tests/load.js

# STRESS — step past peak until something gives, then recover.
PERF_USER_COUNT=40 PERF_ALLOW_WRITES=true PERF_STEP=50 PERF_STEPS=5 \
  k6 run k6/tests/stress.js

# SPIKE — calm, sudden burst, calm. Recovery is the finding.
PERF_USER_COUNT=40 PERF_ALLOW_WRITES=true PERF_BASELINE=10 PERF_PEAK=300 \
  k6 run k6/tests/spike.js

# BREAKPOINT — capacity in req/s (open model). Aborts at the SLO.
PERF_USER_COUNT=20 PERF_MAX_RPS=300 k6 run k6/tests/breakpoint.js

# SOAK — hours. Leaks, token refresh, pool exhaustion.
PERF_USER_COUNT=20 PERF_ALLOW_WRITES=true PERF_SOAK_DURATION=2h \
  k6 run k6/tests/soak.js

# RATE LIMIT — proves the protections fire. Run LAST.
k6 run k6/tests/rate-limit.js
```

### Clean up

```bash
psql "$DATABASE_URL" -f k6/seed/cleanup.sql                       # all k6 rows
psql "$DATABASE_URL" -v run_id="'rmta67tgz'" -f k6/seed/cleanup.sql  # one run
psql "$DATABASE_URL" -f k6/seed/drop-users.sql                    # retire the accounts
```

Every row the suite creates is name-prefixed (`k6-…`, `K6-…`,
`K6 Student …`), and `cleanup.sql` keys off exactly those prefixes in FK
order. The local Postgres here is a persistent dev database with real
accumulated data — nothing else can match.

---

## 3. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:4000` | Target. |
| `PERF_ADMIN_EMAIL` / `PERF_ADMIN_PASSWORD` | dev seed account | Used when `PERF_USER_COUNT=0`. |
| `PERF_USER_COUNT` | `0` | Size of the seeded account pool. `0` = admin only. |
| `PERF_USER_PASSWORD` | `LoadTest123!` | Must match the hash in `seed/load-users.sql`. |
| `PERF_ALLOW_WRITES` | `false` | Enables the create/lend/restock flows. |
| `PERF_ALLOW_REMOTE` | `false` | Required for any non-localhost `BASE_URL`. |
| `PERF_SPOOF_CLIENT_IP` | `true` | One synthetic source IP per VU (see below). |
| `PERF_HOT_PRODUCTS` | `5` | Products the lending flow contends on. |
| `PERF_THINK_MIN` / `PERF_THINK_MAX` | `1` / `4` | Think time, seconds. |
| `PERF_MIX_*` | 55/15/15/8/7 | Traffic mix weights. |
| `PERF_RUN_ID` | auto | Tags created rows; also the `cleanup.sql -v run_id`. |

**Credentials are never committed.** Pass them in the environment. The
defaults are the local dev bootstrap account documented in
`db/seed/R__seed_dev_data.sql`, which is not a secret.

---

## 4. The three things that make or break a run here

### 4.1 Rate limiting will silently become the thing you measure

`src/lib/rateLimit.ts` enforces, **per client IP, per path**:

| Rule | Limit |
|---|---|
| `read` (GET/HEAD) | 600 / min |
| `mutation` (POST/PUT/PATCH/DELETE) | 120 / min |
| `login` | 8 / 15 min |
| `loginPerAccount` | 12 / 15 min |
| `expensive` (`parse-pdf`, `presign`) | 20 / hour |

From one machine, everything above ~10 VUs trips these instantly, and the
result describes the limiter rather than the app.

So each VU presents a distinct `X-Forwarded-For` (`10.x.x.x`, derived from its
VU id). `clientIp()` takes the leftmost entry when `TRUSTED_PROXY_DEPTH` is
unset, so the app sees N clients. It is a throttling signal only — the app
never authorizes on it — so this cannot grant a VU anything.

Behind a real proxy that appends its own entry, set `TRUSTED_PROXY_DEPTH` on
the app to match, or the spoof is ignored.

**The `rate_limited` metric is a threshold on every test: any 429 fails the
run.** That is deliberate. A run with 429s in it is not a slow result, it is an
invalid one.

#### Option 2: turn the limiter off entirely

IP spoofing keeps the limiter in the request path, which is the more faithful
measurement. But it stops working the moment something in front rewrites
`X-Forwarded-For`, and it still costs a `Map` lookup per request. When you want
the app's raw ceiling — or when a proxy is collapsing every VU onto one bucket —
disable it on the **server** instead:

```bash
# app side
PGPOOL_MAX=25 RATE_LIMIT_DISABLED=true npm run start

# k6 side — spoofing is now pointless, so turn it off too
PERF_SPOOF_CLIENT_IP=false k6 run k6/tests/load.js
```

`RATE_LIMIT_DISABLED=true` short-circuits `rateLimit()` for every rule at once
— per-IP, per-account login, and the `expensive` cap. The app logs
`RATE LIMITING IS DISABLED` at **error** level on the first bypass, so it can
never be on quietly.

It is deliberately not gated on `NODE_ENV`: a meaningful load test runs against
a production build, so a `NODE_ENV` check would disable the flag exactly where
it is needed. That puts the responsibility on you — it belongs in a throwaway
load-test environment's env file and nowhere else. With it set,
`/api/auth/login` has no brute-force protection and the metered Gemini endpoint
has no spend cap.

Note this also disables the thing `tests/rate-limit.js` exists to verify, so
that suite must run with the flag **off**.

`tests/rate-limit.js` does the opposite — one fixed source IP, asserting the
limits actually fire.

### 4.2 Auth is stateful and the tests have to play along

Mirrors `src/lib/authFetch` on the client, because the server enforces all of
it:

- **Cookies**: `access_token` (httpOnly, 15 min), `refresh_token` (httpOnly,
  path `/api/auth`, 30 days), `session_hint`, `csrf_token`.
- **CSRF**: every mutating request echoes the `csrf_token` cookie back as
  `X-CSRF-Token`, compared in constant time by `csrfPassed()`. Miss it and you
  get 403 before the request ever touches the database — the fastest, most
  convincing, most useless load test you will ever run.
- **Refresh**: a 401 triggers one `POST /api/auth/refresh` and one retry. Only
  the soak run crosses the 15-minute boundary, so it is the only run that
  really exercises this — and refresh tokens **rotate**, with reuse detection
  that revokes every session for a user. Watch `token_refreshes` (should
  climb) and `auth_failures` (must stay 0).
- **Cookie jar**: an explicit per-VU `http.CookieJar()`, not k6's default,
  which is reset between iterations. A session that re-logged-in every
  iteration would burn the login budget in seconds.

### 4.3 Write flows only ever touch fixtures they own

Lending decrements stock; restocking increments it. Against a persistent dev
database, a load test that lends real inventory corrupts real data.

So `sharedSetup()` creates its own `k6-…-fixture-N` products (quantity
1,000,000, so a long run cannot lend them to zero) and the write flows draw
**only** from that fixture pool. Read flows may touch anything the account can
see, which is realistic and harmless.

### What is deliberately not covered

- `POST /api/invoices/parse-pdf` — ships a PDF to a metered Gemini endpoint.
  Load-testing it spends real money and proves nothing about this app.
- `POST /api/upload/presign` — signs against real Cloudinary, same reasoning.

To cover them, stub the provider behind an env flag first and load-test the
stub. What you want to know is your own handler's cost, not Google's.

### Safety rails

`guardTarget()` runs in every `setup()` and aborts on any URL containing
`neon.tech`, `vercel.app`, or `vercel.sh` — the production hosts recorded in
this repo's handoff notes. Any other non-localhost target needs
`PERF_ALLOW_REMOTE=true`. `seed/load-users.sql` refuses to run against a
database not named `inventory` / `inventory_test` / `inventory_loadtest`,
because it creates known-password accounts.

---

## 5. Reading the results

Custom metrics beyond k6's built-ins:

| Metric | Read it as |
|---|---|
| `flow_duration{flow:…}` | End-to-end time for one *business action*. This is what a user feels; `http_req_duration` is not. |
| `flow_success{flow:…}` | Did the whole action complete, not just the last request. |
| `rate_limited` | Non-zero ⇒ the run is invalid. |
| `token_refreshes` | Should climb steadily in a soak, be ~0 elsewhere. |
| `auth_failures` | Must be 0. Anything else is a session dying mid-run. |
| `server_errors` | 5xx only, separated from timeouts in `http_req_failed`. |
| `rows_created{table:…}` | Reconcile against `cleanup.sql`. |

Per-endpoint thresholds are in `lib/config.js` rather than one global p95, so
a slow `/api/lending` cannot hide behind fast `/api/health` calls.

For anything longer than a few minutes the summary is not enough — you need
the time series, because "p95 was 1.2s" hides "p95 was 200ms until minute 6".

```bash
docker run -d -p 3000:3000 -p 4040:4040 grafana/k6-grafana:latest
k6 run --out experimental-prometheus-rw k6/tests/stress.js
# or, no infrastructure:
k6 run --out json=results.json k6/tests/stress.js
```

### Data volume dominates everything else

Measured on this repo, identical load profile (100 VUs, 60s ramp, 60s hold),
production build, only the dataset changed:

| | 24 products, ~0 orders | 5,900 products / 51,600 orders (~148k rows) |
|---|---|---|
| Throughput | 221 req/s | **16.5 req/s** |
| Median | 150 ms | **3.60 s** |
| p95 | 455 ms | 9.74 s |
| `dashboard_stats` p99 | 519 ms | 10.10 s |
| `lending_list` p99 | 516 ms | 12.79 s |
| `product_detail` p99 | 760 ms | 13.75 s |
| `/api/health` | 11.8 ms | **11.3 ms** |

`/api/health` is unchanged, which is what makes this conclusive: the machine
was fine, the queries were not. Roughly one year of a busy COE's history costs
a **13x throughput collapse**, and every interaction goes from "instant" to
"several seconds".

Seed that dataset with `k6/seed/perf-dataset.sql` and remove it with
`k6/seed/perf-dataset-drop.sql`. **Do not quote a load-test result from this
suite without saying what dataset it ran against** — it is by far the largest
variable, larger than pool size, concurrency, or build mode.

### Measured on this repo

A controlled A/B on a production build (100 VUs, 0.1–0.5s think time, 75s hold,
limiter off, database cleaned to an identical state before each run):

| | `PGPOOL_MAX=10` | `PGPOOL_MAX=25` |
|---|---|---|
| Throughput | 240 req/s | **253 req/s** |
| Median | 165 ms | **127 ms** |
| p95 | 461 ms | **419 ms** |
| Peak DB connections | 12 | 26 |

The first attempt at this comparison showed 25 as *worse*. That was an
artefact of running the two configurations back to back without cleaning up:
the second run started on ~4,000 rows the first had written, on a machine that
had already been under load for two minutes. Every endpoint in that run was
55-65% slower at p95 — the unbounded reads (`dashboard_stats`, `lending_list`,
`invoices_list`) *and* the bounded writes (`lending_create`) alike. A uniform
shift like that does not identify its own cause: accumulated data and a warm,
busy machine both produce it, and one run per condition cannot separate them.

The lesson is methodological, and it applies to every run you do here:
**reset the database and let the machine settle between runs, or the
comparison is worthless.** Cleaning between runs and reversing the order is
what made the numbers above mean anything — and even then, treat single-digit
differences as noise.

Note also that the two runs above still carried the `lpad` product-code bug
(fixed in `src/lib/idSequences.ts`), so each had a few hundred requests that
failed cheaply instead of doing work. Failures inflate throughput. A clean
post-fix run at `PGPOOL_MAX=25` measured 237 req/s with a p95 of 440 ms and
one error in 18,192 requests — slower on paper than the buggy 253 req/s,
because it was actually doing the work.

### Where this app is expected to give out, in order

1. **`PGPOOL_MAX` (default 10, `src/db/client.ts`).** Requests queue for a
   connection long before Postgres itself is busy. Usually the first wall, and
   it is a config change, not a code change. Confirm it: watch
   `SELECT count(*) FROM pg_stat_activity` flatline at 10 while p95 climbs.
2. **`GET /api/dashboard/stats` and `GET /api/lending`.** Both load their
   entire result set into Node and reduce it in JavaScript — `stats` fetches
   every product and every lending order in scope; `lending` has no `LIMIT` at
   all. Cost grows with the catalogue, not with the page. They burn event-loop
   time every other request is waiting on. `GET /api/invoices` is the same
   shape.
3. **`PG_STATEMENT_TIMEOUT_MS` (15s).** Once queries queue past it, requests
   start failing rather than merely slowing.
4. **Rate-limit store memory** in a long soak: one `Map` entry per key,
   swept once a minute.

A useful first experiment is to re-run `load.js` with `PGPOOL_MAX=25` and
compare. If p95 improves and Postgres is idle, you found your bottleneck in
one variable.

---

## 6. Sizing, honestly

VUs are concurrent **users**, not requests/sec. With 1–4s think time each VU
produces roughly 0.3–0.5 business actions/sec, and one action is several HTTP
requests. In the validation run on this repo, **30 VUs ≈ 38 req/s ≈ 10
actions/s**.

Pick your load target from reality, not from a round number: peak concurrent
staff × 1.5. For a COE inventory app that is likely 20–50, not 5,000. A stress
test at 500 VUs against an app whose real peak is 30 tells you nothing you can
act on.

`load.js`, `stress.js`, `spike.js` and `soak.js` use `ramping-vus` — a
**closed** model, correct for simulating users with think time.
`breakpoint.js` uses `ramping-arrival-rate` — an **open** model, correct for
finding capacity, because a closed model backs off exactly when the app slows,
which is when you want it not to. If `breakpoint.js` reports
`dropped_iterations`, k6 ran out of VUs and the result is about k6: raise
`PERF_PREALLOC_VUS`.
