import { defineConfig, devices } from "@playwright/test";

// E2E smoke suite runs against the full docker-composed stack (app + postgres
// + mailpit, plus real Cloudinary credentials in .env). Start the stack first
// (`docker compose up -d`), then `npm run test:e2e` — this config does not
// manage the stack's lifecycle.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
