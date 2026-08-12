# E2E smoke tests

Playwright specs land here starting in Phase 4 (auth cutover) — login/logout,
protected-page access, product/lending/invoice flows through the real UI
against the full docker-composed stack.

Run: `docker compose up -d` then `npm run test:e2e`.
