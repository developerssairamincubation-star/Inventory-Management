import { test, expect } from "@playwright/test";

// Uses the dev-seeded super_admin from db/seed/R__seed_dev_data.sql.
const SEEDED_EMAIL = "admin@inventory.local";
const SEEDED_PASSWORD = "ChangeMe123!";

test.describe("auth: login -> protected page -> logout", () => {
  test("redirects unauthenticated visitors away from a protected page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("logs in, reaches the dashboard, and logs out back to /login", async ({ page }) => {
    await page.goto("/login");

    await page.getByPlaceholder("Email").fill(SEEDED_EMAIL);
    await page.getByPlaceholder("Password").fill(SEEDED_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();

    await expect(page).toHaveURL(/\/dashboard/);

    // Cookies were actually set (httpOnly ones aren't readable from JS, but
    // Playwright's context can still inspect them).
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "access_token")).toBeTruthy();
    expect(cookies.find((c) => c.name === "refresh_token")).toBeTruthy();

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/login/);

    // Protected pages are inaccessible again after logout.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows an error toast on wrong credentials and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(SEEDED_EMAIL);
    await page.getByPlaceholder("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Login" }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
