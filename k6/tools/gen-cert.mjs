// Writes a self-signed cert into k6/tools/.certs for tls-proxy.mjs.
// Localhost-only, 825 days, never leaves this machine — k6 is told to skip
// verification anyway (--insecure-skip-tls-verify).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.certs')
fs.mkdirSync(certDir, { recursive: true })

execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
  '-keyout', path.join(certDir, 'key.pem'),
  '-out', path.join(certDir, 'cert.pem'),
  '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
], { stdio: 'inherit' })

console.log(`Wrote ${certDir}/{key,cert}.pem`)
