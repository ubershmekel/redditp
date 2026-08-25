const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/playwright",
  timeout: 30 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      // The extension spec injects content.js directly, so the same suite also
      // covers the Firefox add-on build. Site specs stay Chromium-only.
      name: "firefox",
      testMatch: /browser-extension\.spec\.js/,
      use: {
        ...devices["Desktop Firefox"],
      },
    },
  ],
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
    timeout: 30 * 1000,
  },
});
