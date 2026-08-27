// Minimal TLS terminator for load-testing a PRODUCTION build locally.
//
// Why this exists:
//   src/lib/cookies.ts sets every auth cookie with `secure: isProd()`, and
//   `npm run start` sets NODE_ENV=production. A Secure cookie is only ever
//   sent back over HTTPS — by a browser and by k6's cookie jar alike. So a
//   production build served on plain http://localhost:4000 authenticates
//   once and then answers 401 to everything, because the client is holding
//   cookies it is not allowed to send.
//
//   That is the app behaving correctly. It just means "production build" and
//   "plain HTTP" cannot be combined, and a load test needs TLS in front.
//
// Usage:
//   node k6/tools/gen-cert.mjs                 # once — writes a self-signed cert
//   npm run build && npm run start             # app on :4000
//   node k6/tools/tls-proxy.mjs                # https://localhost:4443 -> :4000
//   BASE_URL=https://localhost:4443 k6 run --insecure-skip-tls-verify k6/tests/load.js
//
// This is a test fixture, not a production ingress: no HTTP/2, no keep-alive
// tuning, no buffering limits. It exists to make the cookie flags realistic.
// For a real deployment put Caddy/nginx/a load balancer here instead.

import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const certDir = path.join(here, '.certs')
const LISTEN = Number(process.env.TLS_PROXY_PORT || 4443)
const TARGET_PORT = Number(process.env.TLS_PROXY_TARGET_PORT || 4000)
const TARGET_HOST = process.env.TLS_PROXY_TARGET_HOST || '127.0.0.1'

if (!fs.existsSync(path.join(certDir, 'cert.pem'))) {
  console.error(`No certificate at ${certDir}. Run: node k6/tools/gen-cert.mjs`)
  process.exit(1)
}

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
  },
  (req, res) => {
    const headers = { ...req.headers }

    // Append rather than replace. src/lib/rateLimit.ts clientIp() reads the
    // LEFTMOST entry by default, so k6's per-VU synthetic IP must stay first
    // — replacing it here would collapse every VU onto one bucket and the
    // rate limiter would fire in the middle of the run.
    headers['x-forwarded-for'] = headers['x-forwarded-for']
      ? `${headers['x-forwarded-for']}, 127.0.0.1`
      : '127.0.0.1'
    headers['x-forwarded-proto'] = 'https'

    const upstream = http.request(
      { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers)
        upRes.pipe(res)
      },
    )

    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(`upstream error: ${err.message}`)
    })

    req.pipe(upstream)
  },
)

// Leave server.maxConnections UNSET — it is unlimited by default, and setting
// it to 0 does not mean "unlimited", it means "accept zero connections" and
// the proxy silently refuses every handshake.
server.keepAliveTimeout = 65_000
server.headersTimeout = 70_000

server.listen(LISTEN, () => {
  console.log(`TLS proxy: https://localhost:${LISTEN} -> http://${TARGET_HOST}:${TARGET_PORT}`)
  console.log(`Run k6 with: BASE_URL=https://localhost:${LISTEN} k6 run --insecure-skip-tls-verify ...`)
})
