import type { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
  testDir: "tests",
  timeout: 60_000,
  retries: 2,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        // Extension loading requires a headed browser; test commands use Xvfb.
        headless: false,
      },
    },
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // use Playwright's bundled Chromium (no channel specified)
        // Extension loading requires a headed browser; test commands use Xvfb.
        headless: false,
      },
    },
  ],
};

export default config;
