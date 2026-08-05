import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: {
    // Must be a trustworthy origin (localhost) or Chrome ignores the
    // COOP/COEP headers the static-origin route attaches, breaking
    // crossOriginIsolated (SAB / synthesis). Requests are intercepted via
    // context.route — no real server binds this origin.
    baseURL: "http://localhost",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
});
