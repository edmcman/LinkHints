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
    trace: "on",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        // extensions need to be loaded in headed mode
        headless: false,
      },
    },
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // use Playwright's bundled Chromium (no channel specified)
        // extensions need to be loaded in headed mode
        headless: false,
      },
    },
  ],
};

export default config;
